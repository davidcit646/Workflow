#!/usr/bin/env python3

import json
import traceback
import sys
import sqlite3
import tempfile
import hashlib
from urllib.parse import parse_qs, urlparse

from datetime import datetime, timedelta, timezone
from pathlib import Path

from workflow import (
    APP_DATA_DIR,
    ARCHIVE_DIR_NAME,
    BRANCH_OPTIONS,
    CODE_MAPS,
    CSV_EXPORT_FIELDS,
    EXPORTS_DIR_NAME,
    STATUS_FIELDS,
    TRACKER_DIR_NAME,
    WEEKDAY_NAMES,
    SecurityManager,
    _hash_password,
    _verify_password,
    ensure_dirs,
    sanitize_filename,
)


DATA_DIR = Path(APP_DATA_DIR)


CACHE_TTL_SECONDS = 15 * 60


def _cache_temp_dir() -> Path:
    root = Path(tempfile.gettempdir()) / "WorkflowCache"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _temp_cache_path(key: str) -> Path:
    # Don't leak cache keys to the filesystem; always hash.
    return _cache_temp_dir() / f"{_sha256_hex(key)}.json"


def _temp_cache_get_json(key: str) -> object | None:
    path = _temp_cache_path(key)
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass
        return None
    if not isinstance(raw, dict):
        return None
    expires_at = raw.get("expires_at")
    if not isinstance(expires_at, (int, float)):
        return None
    if expires_at < datetime.now(timezone.utc).timestamp():
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass
        return None
    return raw.get("value")


def _temp_cache_set_json(key: str, value: object, ttl_seconds: int = CACHE_TTL_SECONDS) -> None:
    path = _temp_cache_path(key)
    payload = {
        "expires_at": datetime.now(timezone.utc).timestamp() + float(ttl_seconds),
        "value": value,
    }
    try:
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    except Exception:
        return


def _secure_cache_init(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cache_secure (
            key TEXT PRIMARY KEY,
            expires_at TEXT NOT NULL,
            value_enc BLOB NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_cache_secure_expires ON cache_secure(expires_at)")
    conn.commit()


def _secure_cache_cleanup(conn: sqlite3.Connection) -> None:
    # Best-effort cleanup.
    try:
        now = _utc_now()
        conn.execute("DELETE FROM cache_secure WHERE expires_at <= ?", (now,))
        conn.commit()
    except Exception:
        pass


def _secure_cache_get_json(conn: sqlite3.Connection, password: str, key: str) -> object | None:
    _secure_cache_init(conn)
    _secure_cache_cleanup(conn)
    row = conn.execute(
        "SELECT expires_at, value_enc FROM cache_secure WHERE key=?",
        (key,),
    ).fetchone()
    if not row:
        return None
    expires_at = row["expires_at"]
    if isinstance(expires_at, str) and expires_at <= _utc_now():
        try:
            conn.execute("DELETE FROM cache_secure WHERE key=?", (key,))
            conn.commit()
        except Exception:
            pass
        return None
    security = SecurityManager(password)
    decoded = _decrypt_json_blob(security, bytes(row["value_enc"]))
    return decoded


def _secure_cache_set_json(conn: sqlite3.Connection, password: str, key: str, value: object, ttl_seconds: int = CACHE_TTL_SECONDS) -> None:
    _secure_cache_init(conn)
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=int(ttl_seconds))).strftime("%Y-%m-%d %H:%M:%S")
    security = SecurityManager(password)
    value_enc = _encrypt_json_blob(security, value)
    conn.execute(
        """
        INSERT INTO cache_secure(key, expires_at, value_enc)
        VALUES(?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            expires_at=excluded.expires_at,
            value_enc=excluded.value_enc
        """,
        (key, expires_at, value_enc),
    )
    conn.commit()


def _db_path() -> Path:
    return DATA_DIR / "workflow.db"


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _db_connect() -> sqlite3.Connection:
    ensure_dirs(str(DATA_DIR))
    conn = sqlite3.connect(str(_db_path()))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _db_init(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS people (
            uid TEXT PRIMARY KEY,
            name TEXT,
            branch TEXT,
            removed INTEGER NOT NULL DEFAULT 0,
            payload_enc BLOB NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_people_removed ON people(removed);
        CREATE INDEX IF NOT EXISTS idx_people_name ON people(name);
        CREATE INDEX IF NOT EXISTS idx_people_branch ON people(branch);

        CREATE TABLE IF NOT EXISTS artifacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            mime TEXT,
            payload_enc BLOB NOT NULL,
            UNIQUE(kind, name)
        );

        CREATE INDEX IF NOT EXISTS idx_artifacts_kind_created ON artifacts(kind, created_at);

        CREATE TABLE IF NOT EXISTS weekly_tracker (
            week_start TEXT PRIMARY KEY,
            week_end TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            payload_enc BLOB NOT NULL
        );

        CREATE TABLE IF NOT EXISTS todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            completed INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            completed_at TEXT
        );
        """
    )
    _secure_cache_init(conn)
    conn.commit()


def _with_db(password: str, func):
    with _db_connect() as conn:
        _db_init(conn)
        _db_migrate_if_needed(conn, password)
        return func(conn)


def _meta_get(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None


def _meta_set(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )
    conn.commit()


def _upsert_artifact(conn: sqlite3.Connection, *, kind: str, name: str, created_at: str, payload_enc: bytes, mime: str | None = None) -> None:
    conn.execute(
        """
        INSERT INTO artifacts(kind, name, created_at, mime, payload_enc)
        VALUES(?, ?, ?, ?, ?)
        ON CONFLICT(kind, name) DO UPDATE SET
            payload_enc=excluded.payload_enc
        """,
        (kind, name, created_at, mime, payload_enc),
    )


def _encrypt_json_blob(security: SecurityManager, obj: object) -> bytes:
    payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    encrypted = security.encrypt_bytes(payload)
    if not encrypted:
        raise RuntimeError("Failed to encrypt payload")
    return encrypted


def _decrypt_json_blob(security: SecurityManager, encrypted: bytes) -> object:
    plain = security.decrypt_bytes(encrypted)
    if plain is None:
        raise PermissionError("Unable to decrypt data. Check password.")
    return json.loads(plain.decode("utf-8"))


def _db_migrate_if_needed(conn: sqlite3.Connection, password: str) -> None:
    version = _meta_get(conn, "schema_version")
    if version is not None:
        return

    security = SecurityManager(password)
    now = _utc_now()

    # 1) Migrate people from legacy encrypted JSON file.
    enc_path = _enc_file_path()
    try:
        legacy_path = Path(enc_path)
        if legacy_path.exists():
            decrypted = security.decrypt(str(legacy_path))
            if decrypted:
                people = json.loads(decrypted)
                if isinstance(people, list):
                    for p in people:
                        if not isinstance(p, dict):
                            continue
                        uid = _normalize_text(p.get("uid"))
                        if not uid:
                            continue
                        name = _normalize_text(p.get("Name"))
                        branch = _normalize_text(p.get("Branch"))
                        removed = 1 if _is_removed(p) else 0
                        payload_enc = _encrypt_json_blob(security, p)
                        conn.execute(
                            """
                            INSERT INTO people(uid, name, branch, removed, payload_enc, updated_at)
                            VALUES(?, ?, ?, ?, ?, ?)
                            ON CONFLICT(uid) DO UPDATE SET
                                name=excluded.name,
                                branch=excluded.branch,
                                removed=excluded.removed,
                                payload_enc=excluded.payload_enc,
                                updated_at=excluded.updated_at
                            """,
                            (uid, name, branch, removed, payload_enc, now),
                        )
                    conn.commit()
    except Exception:
        # Best-effort migration.
        pass

    # 2) Migrate archives (zip files) and exports (csv/txt/json) into artifacts.
    try:
        archive_dir = DATA_DIR / ARCHIVE_DIR_NAME
        if archive_dir.exists():
            for p in archive_dir.iterdir():
                if not p.is_file() or p.suffix.lower() != ".zip":
                    continue
                data = p.read_bytes()
                payload_enc = security.encrypt_bytes(data)
                if not payload_enc:
                    continue
                _upsert_artifact(
                    conn,
                    kind="archive",
                    name=p.name,
                    created_at=now,
                    payload_enc=payload_enc,
                    mime="application/zip",
                )
            conn.commit()
    except Exception:
        pass

    try:
        exports_dir = DATA_DIR / EXPORTS_DIR_NAME
        if exports_dir.exists():
            for p in exports_dir.iterdir():
                if not p.is_file() or p.suffix.lower() not in {".csv", ".txt", ".json"}:
                    continue
                data = p.read_bytes()
                payload_enc = security.encrypt_bytes(data)
                if not payload_enc:
                    continue
                mime = "text/csv" if p.suffix.lower() == ".csv" else "text/plain"
                if p.suffix.lower() == ".json":
                    mime = "application/json"
                _upsert_artifact(
                    conn,
                    kind="export",
                    name=p.name,
                    created_at=now,
                    payload_enc=payload_enc,
                    mime=mime,
                )
            conn.commit()
    except Exception:
        pass

    # 3) Migrate weekly tracker files.
    try:
        tracker_dir = DATA_DIR / TRACKER_DIR_NAME
        if tracker_dir.exists():
            for p in tracker_dir.iterdir():
                if not p.is_file() or p.suffix.lower() != ".json":
                    continue
                try:
                    raw = json.loads(p.read_text(encoding="utf-8"))
                except Exception:
                    continue
                payload_enc = _encrypt_json_blob(security, raw)
                name = p.stem
                # Try to infer week_start/week_end from filename: Week_YYYY-MM-DD_to_YYYY-MM-DD
                week_start = ""
                week_end = ""
                if name.startswith("Week_") and "_to_" in name:
                    try:
                        rest = name[len("Week_") :]
                        week_start, week_end = rest.split("_to_", 1)
                    except Exception:
                        week_start = name
                        week_end = name
                else:
                    week_start = name
                    week_end = name
                conn.execute(
                    """
                    INSERT INTO weekly_tracker(week_start, week_end, updated_at, payload_enc)
                    VALUES(?, ?, ?, ?)
                    ON CONFLICT(week_start) DO UPDATE SET
                        week_end=excluded.week_end,
                        updated_at=excluded.updated_at,
                        payload_enc=excluded.payload_enc
                    """,
                    (week_start, week_end, now, payload_enc),
                )
            conn.commit()
    except Exception:
        pass

    _meta_set(conn, "schema_version", "1")


def _read_stdin_json() -> dict:
    raw = sys.stdin.read()
    if not raw:
        return {}
    return json.loads(raw)


def _response(ok: bool, status: int, data=None, error: str | None = None, context: dict | None = None):
    payload = {"ok": ok, "status": status}
    if error is not None:
        payload["error"] = error
    if data is not None:
        payload["data"] = data
    if context is not None:
        payload["context"] = context
    return payload


def _parse_request(req: dict):
    method = (req.get("method") or "GET").upper()
    url = req.get("url") or req.get("path") or "/"
    parsed = urlparse(url)
    path = parsed.path or "/"
    query = parse_qs(parsed.query or "")
    body = req.get("body")
    return method, path, query, body


def _auth_file_path():
    import os

    return os.path.join(APP_DATA_DIR, "prog_auth.json")


def _enc_file_path():
    import os

    return os.path.join(APP_DATA_DIR, "workflow_data.json.enc")


def _get_current_week() -> tuple[datetime.date, datetime.date]:
    today = datetime.now().date()
    weekday = today.weekday()
    if weekday >= 4:
        days_since_friday = weekday - 4
        week_start = today - timedelta(days=days_since_friday)
    else:
        days_since_friday = weekday + 3
        week_start = today - timedelta(days=days_since_friday)
    week_end = week_start + timedelta(days=6)
    return week_start, week_end


def _week_filename(week_start: datetime.date, week_end: datetime.date) -> Path:
    tracker_dir = DATA_DIR / TRACKER_DIR_NAME
    ensure_dirs(str(tracker_dir))
    start_str = week_start.strftime("%Y-%m-%d")
    end_str = week_end.strftime("%Y-%m-%d")
    filename = f"Week_{start_str}_to_{end_str}.json"
    return tracker_dir / filename


def _load_week_data(week_start: datetime.date, week_end: datetime.date) -> dict:
    week_start_str = week_start.strftime("%Y-%m-%d")
    with _db_connect() as conn:
        _db_init(conn)
        row = conn.execute(
            "SELECT payload_enc FROM weekly_tracker WHERE week_start=?",
            (week_start_str,),
        ).fetchone()
        if not row:
            return {"metadata": {}, "entries": {}}
        # Weekly tracker is encrypted with the program password.
        # The caller is expected to have authenticated and set active_password.
        return {"metadata": {}, "entries": {"_enc": bytes(row["payload_enc"])}}


def _save_week_data(week_start: datetime.date, week_end: datetime.date, entries: dict) -> dict:
    payload = {
        "metadata": {
            "week_start": week_start.strftime("%Y-%m-%d"),
            "week_end": week_end.strftime("%Y-%m-%d"),
            "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        },
        "entries": entries,
    }
    return payload


def _load_auth():
    import os

    path = _auth_file_path()
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def _save_auth(auth_payload: dict):
    import os

    ensure_dirs(APP_DATA_DIR)
    path = _auth_file_path()
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(auth_payload, handle, indent=2)
    try:
        os.chmod(path, 0o600)
    except Exception:
        pass


def _require_password(active_password: str | None):
    if not active_password:
        raise PermissionError("Not authenticated")
    return active_password


def _load_people(password: str):
    security = SecurityManager(password)
    def _load(conn: sqlite3.Connection):
        rows = conn.execute(
            "SELECT payload_enc FROM people ORDER BY COALESCE(name, '') ASC"
        ).fetchall()
        out: list[dict] = []
        for row in rows:
            person = _decrypt_json_blob(security, bytes(row["payload_enc"]))
            if isinstance(person, dict):
                out.append(person)
        return out

    return _with_db(password, _load)


def _save_people(people: list, password: str):
    security = SecurityManager(password)
    now = _utc_now()
    def _save(conn: sqlite3.Connection):
        for p in people:
            if not isinstance(p, dict):
                continue
            uid = _normalize_text(p.get("uid"))
            if not uid:
                continue
            name = _normalize_text(p.get("Name"))
            branch = _normalize_text(p.get("Branch"))
            removed = 1 if _is_removed(p) else 0
            payload_enc = _encrypt_json_blob(security, p)
            conn.execute(
                """
                INSERT INTO people(uid, name, branch, removed, payload_enc, updated_at)
                VALUES(?, ?, ?, ?, ?, ?)
                ON CONFLICT(uid) DO UPDATE SET
                    name=excluded.name,
                    branch=excluded.branch,
                    removed=excluded.removed,
                    payload_enc=excluded.payload_enc,
                    updated_at=excluded.updated_at
                """,
                (uid, name, branch, removed, payload_enc, now),
            )
        conn.commit()

    _with_db(password, _save)


def _normalize_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return ""
    return str(value).strip()


def _matches_search(person: dict, search: str) -> bool:
    if not search:
        return True
    haystack = " ".join(
        _normalize_text(person.get(key))
        for key in ("Name", "Employee ID", "ICIMS ID", "Manager Name", "Job Location")
    ).lower()
    return search.lower() in haystack


def _matches_branch(person: dict, branch: str) -> bool:
    if not branch or branch.lower() == "all":
        return True
    return _normalize_text(person.get("Branch")).lower() == branch.lower()


def _is_removed(person: dict) -> bool:
    value = person.get("Removed")
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in {"true", "1", "yes", "removed"}


def _is_scheduled(person: dict) -> bool:
    if _normalize_text(person.get("NEO Scheduled Date")):
        return True
    scheduled = _normalize_text(person.get("Scheduled")).lower()
    return scheduled in {"yes", "true", "1", "scheduled"}


def _column_for(person: dict) -> str:
    if not _is_scheduled(person):
        return "not-scheduled"
    if _normalize_text(person.get("Onboarding Status")).lower() == "in progress":
        return "in-progress"
    return "neo-scheduled"


def _status_badge(status: str) -> str:
    text = (status or "").lower()
    if text.startswith("neo:") or text.startswith("neo"):
        return "success"
    if "clear" in text or "clr" in text:
        return "success"
    if "required" in text or "pending" in text or "submit" in text:
        return "warning"
    if "none" in text or not text:
        return "danger"
    return "warning"


def _pick_status(person: dict) -> str:
    try:
        if _is_scheduled(person):
            neo = (person.get("NEO Scheduled Date") or "").strip()
            if neo:
                return f"NEO: {neo}"
    except Exception:
        pass

    for key in ("CORI Status", "NH GC Status", "ME GC Status", "DOD Clearance"):
        value = _normalize_text(person.get(key))
        if not value:
            continue
        if value.lower() in {"none", "cleared", "clr", "submitted", "sub"}:
            continue
        return value
    return ""


def _pick_date(person: dict) -> str:
    for key in (
        "NEO Scheduled Date",
        "Background Completion Date",
        "ME GC Sent Date",
        "CORI Submit Date",
        "NH GC Expiration Date",
    ):
        value = _normalize_text(person.get(key))
        if value:
            return value
    return "No date"


def _pick_manager(person: dict) -> str:
    value = _normalize_text(person.get("Manager Name"))
    if value:
        return value
    value = _normalize_text(person.get("Job Location"))
    return value or "Unassigned"


def _build_columns(people: list) -> dict:
    import uuid

    columns = {"not-scheduled": [], "neo-scheduled": [], "in-progress": []}
    for person in people:
        if not isinstance(person, dict):
            continue
        uid = _normalize_text(person.get("uid")) or str(uuid.uuid4())
        person["uid"] = uid
        name = _normalize_text(person.get("Name")) or "Unnamed"
        status = _pick_status(person)
        columns[_column_for(person)].append(
            {
                "uid": uid,
                "name": name,
                "status": status,
                "job": _normalize_text(person.get("Job Name") or person.get("Job Location")),
                "manager": _pick_manager(person),
                "date": _pick_date(person),
                "badge": _status_badge(status),
            }
        )
    return columns


def handle(payload: dict) -> dict:
    req = payload.get("request") or {}
    ctx = payload.get("context") or {}
    active_password = ctx.get("activePassword")

    try:
        method, path, query, body = _parse_request(req)

        if path == "/api/auth/status" and method == "GET":
            configured = _load_auth() is not None
            authenticated = bool(active_password)
            return _response(True, 200, {"configured": configured, "authenticated": authenticated}, context={"activePassword": active_password})

        if path == "/api/auth/setup" and method == "POST":
            if _load_auth() is not None:
                return _response(False, 400, error="Already configured.")
            password = (body or {}).get("password") if isinstance(body, dict) else None
            if not password:
                return _response(False, 400, error="Password is required.")
            auth_payload = _hash_password(password)
            _save_auth(auth_payload)
            active_password = password
            return _response(True, 200, {"status": "ok"}, context={"activePassword": active_password})

        if path == "/api/auth/login" and method == "POST":
            auth_payload = _load_auth()
            if auth_payload is None:
                return _response(False, 400, error="Not configured.")
            password = (body or {}).get("password") if isinstance(body, dict) else None
            if not password:
                return _response(False, 400, error="Password is required.")
            ok = _verify_password(password, auth_payload["salt"], auth_payload["iterations"], auth_payload["key"])
            if not ok:
                return _response(False, 401, error="Invalid password.")
            active_password = password
            return _response(True, 200, {"status": "ok"}, context={"activePassword": active_password})

        if path == "/api/auth/change" and method == "POST":
            auth_payload = _load_auth()
            if auth_payload is None:
                return _response(False, 400, error="Not configured.")
            current = (body or {}).get("current") if isinstance(body, dict) else None
            new_pw = (body or {}).get("new") if isinstance(body, dict) else None
            if not current or not new_pw:
                return _response(False, 400, error="Current and new password are required.")
            ok = _verify_password(current, auth_payload["salt"], auth_payload["iterations"], auth_payload["key"])
            if not ok:
                return _response(False, 401, error="Invalid password.")
            _save_auth(_hash_password(new_pw))
            active_password = new_pw
            return _response(True, 200, {"status": "ok"}, context={"activePassword": active_password})

        if path == "/api/schema" and method == "GET":
            password = _require_password(active_password)
            # Schema is non-sensitive; cache in OS temp dir.
            cached = _temp_cache_get_json("schema:v1")
            if isinstance(cached, dict) and cached.get("fields"):
                return _response(True, 200, cached, context={"activePassword": active_password})
            fields = list(CSV_EXPORT_FIELDS)
            extra_fields = [
                "Notes",
                "Shirt Size",
                "Pants Size",
                "Boots",
                "Licensing Info",
                "ID Type",
                "ID Type Other",
                "State Abbreviation",
                "License Number",
                "Expiration Date",
                "Date of Birth",
                "Social Security Number",
                "BG Check Date",
                "BG Check Status",
                "CORI Date",
                "NHGC Status",
                "NHGC Expiration Date",
                "NHGC ID Number",
                "Maine GC Status",
                "ME GC Date",
                "Emergency Contact Name",
                "Emergency Contact Relationship",
                "Emergency Contact Phone",
                "EC First Name",
                "EC Last Name",
                "EC Relationship",
                "EC Phone Number",
                "Other ID",
                "State",
                "ID No.",
                "Exp.",
                "DOB",
                "Social",
            ]
            for field in extra_fields:
                if field not in fields:
                    fields.append(field)
            schema = {
                "fields": fields,
                "status_fields": STATUS_FIELDS,
                "code_maps": CODE_MAPS,
                "branches": BRANCH_OPTIONS,
            }
            _temp_cache_set_json("schema:v1", schema)
            return _response(True, 200, schema, context={"activePassword": active_password})

        if path == "/api/people" and method == "GET":
            password = _require_password(active_password)
            people = _load_people(password)
            search = (query.get("search") or [""])[0]
            branch = (query.get("branch") or [""])[0]
            filtered = [p for p in people if isinstance(p, dict) and (not _is_removed(p)) and _matches_search(p, search) and _matches_branch(p, branch)]
            columns = _build_columns(filtered)
            summary = {key: len(value) for key, value in columns.items()}
            summary["total"] = sum(summary.values())
            return _response(True, 200, {"people": filtered, "columns": columns, "summary": summary}, context={"activePassword": active_password})

        if path == "/api/archive/list" and method == "GET":
            password = _require_password(active_password)
            def _list_archives(conn: sqlite3.Connection):
                rows = conn.execute(
                    "SELECT name FROM artifacts WHERE kind='archive' ORDER BY created_at DESC"
                ).fetchall()
                return [row["name"] for row in rows]

            files = _with_db(password, _list_archives)
            return _response(True, 200, {"archives": files}, context={"activePassword": active_password})

        if path.startswith("/api/archive/") and method == "POST":
            password = _require_password(active_password)
            suffix = path[len("/api/archive/") :]
            # Create archive for a person uid: POST /api/archive/{uid}
            if "/" not in suffix:
                uid = suffix
                if not isinstance(body, dict):
                    return _response(False, 400, error="Invalid payload.")
                archive_password = body.get("archive_password")
                if not archive_password:
                    return _response(False, 400, error="Archive password is required.")

                people = _load_people(password)
                person = None
                for p in people:
                    if isinstance(p, dict) and _normalize_text(p.get("uid")) == uid:
                        person = p
                        break
                if not person:
                    return _response(False, 404, error="Person not found.")

                name = _normalize_text(person.get("Name"))
                neo = _normalize_text(person.get("NEO Scheduled Date"))
                if not name or not neo:
                    return _response(False, 400, error="Name and NEO Scheduled Date must be set before archiving.")

                # Build a deterministic archive filename.
                safe_name = sanitize_filename(name) or "Unnamed"
                safe_neo = sanitize_filename(neo) or "NoDate"
                archive_name = f"{safe_neo} - {safe_name}.zip"

                # Create an encrypted zip in-memory.
                try:
                    import io
                    import pyzipper

                    buf = io.BytesIO()
                    with pyzipper.AESZipFile(
                        buf,
                        "w",
                        compression=pyzipper.ZIP_DEFLATED,
                        encryption=pyzipper.WZ_AES,
                    ) as zf:
                        zf.setpassword(str(archive_password).encode("utf-8"))

                        # Primary human-readable dump used by the UI preview.
                        lines: list[str] = []
                        for key, label in getattr(sys.modules.get("workflow"), "ARCHIVE_SECTIONS", {}).items() if sys.modules.get("workflow") else []:
                            _ = key
                            _ = label
                        # Use the ARCHIVE_SECTIONS mapping from workflow.py if available.
                        try:
                            from workflow import ARCHIVE_SECTIONS
                        except Exception:
                            ARCHIVE_SECTIONS = {}

                        if ARCHIVE_SECTIONS:
                            for section_key, section_title in ARCHIVE_SECTIONS.items():
                                lines.append(f"== {section_title} ==")
                                # For now, dump all fields; later we can map by section.
                                # Keeping behavior stable is the priority.
                                for k in sorted(person.keys()):
                                    if k == "uid":
                                        continue
                                    v = person.get(k)
                                    if v is None or v is False:
                                        continue
                                    text = str(v).strip()
                                    if not text:
                                        continue
                                    lines.append(f"{k}: {text}")
                                lines.append("")
                        else:
                            for k in sorted(person.keys()):
                                if k == "uid":
                                    continue
                                v = person.get(k)
                                if v is None or v is False:
                                    continue
                                text = str(v).strip()
                                if not text:
                                    continue
                                lines.append(f"{k}: {text}")

                        zf.writestr("archive.txt", "\n".join(lines))
                        zf.writestr("candidate.json", json.dumps(person, ensure_ascii=False, indent=2))

                    zip_bytes = buf.getvalue()
                except Exception as exc:
                    return _response(False, 500, error=f"Unable to create archive: {exc}")

                security = SecurityManager(password)
                payload_enc = security.encrypt_bytes(zip_bytes)
                if not payload_enc:
                    return _response(False, 500, error="Unable to encrypt archive.")

                def _save_archive(conn: sqlite3.Connection):
                    _upsert_artifact(
                        conn,
                        kind="archive",
                        name=archive_name,
                        created_at=_utc_now(),
                        payload_enc=payload_enc,
                        mime="application/zip",
                    )
                    conn.commit()

                _with_db(password, _save_archive)

                # Mark the person as removed after archiving.
                try:
                    for p in people:
                        if isinstance(p, dict) and _normalize_text(p.get("uid")) == uid:
                            p["Removed"] = True
                            break
                    _save_people(people, password)
                except Exception:
                    pass

                return _response(True, 200, {"status": "ok", "archive": archive_name}, context={"activePassword": active_password})

            # Archive operations by archive name:
            # POST /api/archive/{name}/contents
            # POST /api/archive/{name}/file
            parts = suffix.split("/", 1)
            archive_name = parts[0]
            op = parts[1] if len(parts) > 1 else ""
            if op not in {"contents", "file"}:
                return _response(False, 404, error=f"Unknown route: {method} {path}")
            if not isinstance(body, dict):
                return _response(False, 400, error="Invalid payload.")
            archive_password = body.get("archive_password")
            if not archive_password:
                return _response(False, 400, error="Archive password is required.")

            # Cache key should not store raw archive password. Use sha256.
            pw_hash = _sha256_hex(str(archive_password))

            with _db_connect() as conn:
                _db_init(conn)
                _db_migrate_if_needed(conn, password)

                # Sensitive cache is stored in DB encrypted.
                cache_key = None
                if op == "contents":
                    cache_key = f"archive:contents:{archive_name}:pw:{pw_hash}"
                elif op == "file":
                    internal_path = body.get("internal_path")
                    if internal_path:
                        cache_key = f"archive:file:{archive_name}:{internal_path}:pw:{pw_hash}"

                if cache_key:
                    cached = _secure_cache_get_json(conn, password, cache_key)
                    if isinstance(cached, dict):
                        return _response(True, 200, cached, context={"activePassword": active_password})

                row = conn.execute(
                    "SELECT payload_enc FROM artifacts WHERE kind='archive' AND name=?",
                    (archive_name,),
                ).fetchone()
                if not row:
                    return _response(False, 404, error="Archive not found.")
                security = SecurityManager(password)
                zip_bytes = security.decrypt_bytes(bytes(row["payload_enc"]))
                if zip_bytes is None:
                    return _response(False, 401, error="Unable to decrypt archive. Check program password.")

            try:
                import io
                import pyzipper

                with pyzipper.AESZipFile(io.BytesIO(zip_bytes), "r") as zf:
                    zf.setpassword(str(archive_password).encode("utf-8"))
                    if op == "contents":
                        files = [n for n in zf.namelist() if not n.endswith("/")]
                        payload_out = {"files": files}
                        if cache_key:
                            _secure_cache_set_json(conn, password, cache_key, payload_out)
                        return _response(True, 200, payload_out, context={"activePassword": active_password})

                    internal_path = body.get("internal_path")
                    if not internal_path:
                        return _response(False, 400, error="internal_path is required.")
                    data = zf.read(internal_path)
                    # Return text for .txt/.json; otherwise return base64 wrapper.
                    if str(internal_path).lower().endswith((".txt", ".json", ".csv")):
                        text = data.decode("utf-8", errors="replace")
                        payload_out = {"content": text}
                        if cache_key:
                            _secure_cache_set_json(conn, password, cache_key, payload_out)
                        return _response(True, 200, payload_out, context={"activePassword": active_password})

                    import base64

                    b64 = base64.b64encode(data).decode("ascii")
                    payload_out = {"base64": b64}
                    if cache_key:
                        _secure_cache_set_json(conn, password, cache_key, payload_out)
                    return _response(True, 200, payload_out, context={"activePassword": active_password})
            except RuntimeError:
                return _response(False, 401, error="Invalid archive password.")
            except KeyError:
                return _response(False, 404, error="File not found in archive.")
            except Exception:
                return _response(False, 500, error="Unable to read archive.")

        if path == "/api/weekly/current" and method == "GET":
            password = _require_password(active_password)
            week_start, week_end = _get_current_week()
            with _db_connect() as conn:
                _db_init(conn)
                _db_migrate_if_needed(conn, password)
                week_start_str = week_start.strftime("%Y-%m-%d")
                row = conn.execute(
                    "SELECT payload_enc FROM weekly_tracker WHERE week_start=?",
                    (week_start_str,),
                ).fetchone()
                if not row:
                    data = {"metadata": {}, "entries": {}}
                else:
                    security = SecurityManager(password)
                    decoded = _decrypt_json_blob(security, bytes(row["payload_enc"]))
                    data = decoded if isinstance(decoded, dict) else {"metadata": {}, "entries": {}}

            entries = data.get("entries", {}) if isinstance(data, dict) else {}
            normalized: dict[str, dict] = {}
            for day in WEEKDAY_NAMES:
                day_data = entries.get(day, {}) if isinstance(entries, dict) else {}
                if not isinstance(day_data, dict):
                    day_data = {"content": day_data, "start": "", "end": ""}
                normalized[day] = {
                    "content": day_data.get("content", ""),
                    "start": day_data.get("start", ""),
                    "end": day_data.get("end", ""),
                }
            return _response(True, 200, {
                "week_start": week_start.strftime("%Y-%m-%d"),
                "week_end": week_end.strftime("%Y-%m-%d"),
                "entries": normalized,
            }, context={"activePassword": active_password})

        if path == "/api/weekly/current" and method == "POST":
            password = _require_password(active_password)
            if not isinstance(body, dict) or not isinstance(body.get("entries"), dict):
                return _response(False, 400, error="Invalid payload.")
            week_start, week_end = _get_current_week()
            incoming = body.get("entries")
            cleaned: dict[str, dict] = {}
            for day in WEEKDAY_NAMES:
                info = incoming.get(day, {}) if isinstance(incoming, dict) else {}
                if not isinstance(info, dict):
                    info = {"content": str(info), "start": "", "end": ""}
                cleaned[day] = {
                    "content": info.get("content", ""),
                    "start": info.get("start", ""),
                    "end": info.get("end", ""),
                }

            saved = _save_week_data(week_start, week_end, cleaned)
            security = SecurityManager(password)
            payload_enc = _encrypt_json_blob(security, saved)
            with _db_connect() as conn:
                _db_init(conn)
                _db_migrate_if_needed(conn, password)
                conn.execute(
                    """
                    INSERT INTO weekly_tracker(week_start, week_end, updated_at, payload_enc)
                    VALUES(?, ?, ?, ?)
                    ON CONFLICT(week_start) DO UPDATE SET
                        week_end=excluded.week_end,
                        updated_at=excluded.updated_at,
                        payload_enc=excluded.payload_enc
                    """,
                    (
                        week_start.strftime("%Y-%m-%d"),
                        week_end.strftime("%Y-%m-%d"),
                        _utc_now(),
                        payload_enc,
                    ),
                )
                conn.commit()
            return _response(True, 200, saved, context={"activePassword": active_password})

        if path == "/api/exports/list" and method == "GET":
            password = _require_password(active_password)
            def _list_exports(conn: sqlite3.Connection):
                rows = conn.execute(
                    "SELECT name FROM artifacts WHERE kind='export' ORDER BY created_at DESC"
                ).fetchall()
                return [row["name"] for row in rows]

            files = _with_db(password, _list_exports)
            return _response(True, 200, {"files": files}, context={"activePassword": active_password})

        if path == "/api/exports/preview" and method == "GET":
            password = _require_password(active_password)
            name = (query.get("name") or [""])[0]
            limit_str = (query.get("limit") or ["20"])[0]
            try:
                limit = int(limit_str)
            except ValueError:
                limit = 20
            limit = max(1, min(limit, 200))
            if not name:
                return _response(False, 400, error="File name is required.")
            if not name.lower().endswith(".csv"):
                return _response(False, 400, error="Preview only available for CSV files.")
            with _db_connect() as conn:
                _db_init(conn)
                _db_migrate_if_needed(conn, password)

                # Exports are sensitive (often contain names). Cache in DB encrypted.
                cache_key = f"export:preview:{name}:limit:{limit}"
                cached = _secure_cache_get_json(conn, password, cache_key)
                if isinstance(cached, dict) and cached.get("headers") is not None:
                    return _response(True, 200, cached, context={"activePassword": active_password})

                row = conn.execute(
                    "SELECT payload_enc FROM artifacts WHERE kind='export' AND name=?",
                    (name,),
                ).fetchone()
                if not row:
                    return _response(False, 404, error="File not found.")

                security = SecurityManager(password)
                plain = security.decrypt_bytes(bytes(row["payload_enc"]))
                if plain is None:
                    return _response(False, 401, error="Unable to decrypt export. Check password.")

            try:
                import csv
                import io

                text_stream = io.StringIO(plain.decode("utf-8", errors="replace"))
                reader = csv.reader(text_stream)
                headers = next(reader, [])
                rows = []
                for _, csv_row in zip(range(limit), reader):
                    rows.append(csv_row)
            except Exception:
                return _response(False, 500, error="Unable to parse CSV.")

            payload_out = {"headers": headers, "rows": rows, "limit": limit}
            try:
                with _db_connect() as conn:
                    _db_init(conn)
                    _db_migrate_if_needed(conn, password)
                    _secure_cache_set_json(conn, password, cache_key, payload_out)
            except Exception:
                pass

            return _response(True, 200, payload_out, context={"activePassword": active_password})

        if path == "/api/exports/delete" and method == "DELETE":
            password = _require_password(active_password)
            name = (query.get("name") or [""])[0]
            if not name:
                return _response(False, 400, error="File name is required.")
            def _delete_export(conn: sqlite3.Connection):
                cur = conn.execute(
                    "DELETE FROM artifacts WHERE kind='export' AND name=?",
                    (name,),
                )
                conn.commit()
                return cur.rowcount

            deleted = _with_db(password, _delete_export)
            if deleted == 0:
                return _response(False, 404, error="File not found.")
            return _response(True, 200, {"status": "ok"}, context={"activePassword": active_password})

        if path == "/api/removed" and method == "GET":
            password = _require_password(active_password)
            people = _load_people(password)
            removed = [
                {"uid": p.get("uid"), "name": _normalize_text(p.get("Name")) or "Unnamed"}
                for p in people
                if isinstance(p, dict) and _is_removed(p)
            ]
            removed.sort(key=lambda item: (item.get("name") or "").lower())
            return _response(True, 200, {"removed": removed}, context={"activePassword": active_password})

        if path == "/api/people" and method == "POST":
            import uuid

            password = _require_password(active_password)
            if not isinstance(body, dict):
                return _response(False, 400, error="Invalid payload.")
            people = _load_people(password)
            person = {key: value for key, value in body.items()}
            person["uid"] = str(uuid.uuid4())
            people.append(person)
            _save_people(people, password)
            return _response(True, 200, {"person": person}, context={"activePassword": active_password})

        # ---- TODO LIST ENDPOINTS ----
        if path == "/api/todos" and method == "GET":
            password = _require_password(active_password)
            with _db_connect() as conn:
                _db_init(conn)
                _db_migrate_if_needed(conn, password)
                rows = conn.execute(
                    "SELECT id, text, completed, created_at, completed_at FROM todos ORDER BY completed ASC, id DESC"
                ).fetchall()
                todos = [
                    {"id": row["id"], "text": row["text"], "completed": bool(row["completed"]),
                     "created_at": row["created_at"], "completed_at": row["completed_at"]}
                    for row in rows
                ]
            return _response(True, 200, {"todos": todos}, context={"activePassword": active_password})

        if path == "/api/todos" and method == "POST":
            password = _require_password(active_password)
            if not isinstance(body, dict) or not body.get("text", "").strip():
                return _response(False, 400, error="Todo text is required.")
            text = body["text"].strip()
            now = _utc_now()
            with _db_connect() as conn:
                _db_init(conn)
                _db_migrate_if_needed(conn, password)
                cur = conn.execute(
                    "INSERT INTO todos(text, completed, created_at) VALUES(?, 0, ?)",
                    (text, now),
                )
                conn.commit()
                todo_id = cur.lastrowid
            return _response(True, 200, {"todo": {"id": todo_id, "text": text, "completed": False, "created_at": now, "completed_at": None}}, context={"activePassword": active_password})

        if path.startswith("/api/todos/") and method == "PUT":
            password = _require_password(active_password)
            suffix = path[len("/api/todos/"):]
            # PUT /api/todos/{id}/complete
            parts = suffix.split("/", 1)
            todo_id_str = parts[0]
            op = parts[1] if len(parts) > 1 else ""
            if op == "complete":
                try:
                    todo_id = int(todo_id_str)
                except ValueError:
                    return _response(False, 400, error="Invalid todo ID.")
                now = _utc_now()
                with _db_connect() as conn:
                    _db_init(conn)
                    _db_migrate_if_needed(conn, password)
                    row = conn.execute("SELECT id, text FROM todos WHERE id=?", (todo_id,)).fetchone()
                    if not row:
                        return _response(False, 404, error="Todo not found.")
                    todo_text = row["text"]
                    conn.execute(
                        "UPDATE todos SET completed=1, completed_at=? WHERE id=?",
                        (now, todo_id),
                    )
                    conn.commit()

                    # Append completed todo to current day in weekly tracker
                    week_start, week_end = _get_current_week()
                    week_start_str = week_start.strftime("%Y-%m-%d")
                    wt_row = conn.execute(
                        "SELECT payload_enc FROM weekly_tracker WHERE week_start=?",
                        (week_start_str,),
                    ).fetchone()
                    if wt_row:
                        security = SecurityManager(password)
                        decoded = _decrypt_json_blob(security, bytes(wt_row["payload_enc"]))
                        wt_data = decoded if isinstance(decoded, dict) else {"metadata": {}, "entries": {}}
                    else:
                        wt_data = {"metadata": {}, "entries": {}}

                    # Determine today's day name
                    today = datetime.now().date()
                    day_name = today.strftime("%A")
                    entries = wt_data.get("entries", {})
                    if not isinstance(entries, dict):
                        entries = {}
                    day_data = entries.get(day_name, {})
                    if not isinstance(day_data, dict):
                        day_data = {"content": str(day_data), "start": "", "end": ""}
                    existing_content = day_data.get("content", "")
                    # Append the completed todo text
                    append_line = f"[TODO] {todo_text}"
                    if existing_content.strip():
                        day_data["content"] = existing_content.rstrip("\n") + "\n" + append_line
                    else:
                        day_data["content"] = append_line
                    entries[day_name] = day_data
                    wt_data["entries"] = entries
                    wt_data["metadata"] = wt_data.get("metadata", {})
                    wt_data["metadata"]["week_start"] = week_start_str
                    wt_data["metadata"]["week_end"] = week_end.strftime("%Y-%m-%d")
                    wt_data["metadata"]["updated_at"] = now

                    security = SecurityManager(password)
                    payload_enc = _encrypt_json_blob(security, wt_data)
                    conn.execute(
                        """
                        INSERT INTO weekly_tracker(week_start, week_end, updated_at, payload_enc)
                        VALUES(?, ?, ?, ?)
                        ON CONFLICT(week_start) DO UPDATE SET
                            week_end=excluded.week_end,
                            updated_at=excluded.updated_at,
                            payload_enc=excluded.payload_enc
                        """,
                        (week_start_str, week_end.strftime("%Y-%m-%d"), now, payload_enc),
                    )
                    conn.commit()

                return _response(True, 200, {"status": "ok", "appended_to": day_name}, context={"activePassword": active_password})
            return _response(False, 404, error=f"Unknown route: {method} {path}")

        if path.startswith("/api/todos/") and method == "DELETE":
            password = _require_password(active_password)
            todo_id_str = path[len("/api/todos/"):]
            try:
                todo_id = int(todo_id_str)
            except ValueError:
                return _response(False, 400, error="Invalid todo ID.")
            with _db_connect() as conn:
                _db_init(conn)
                _db_migrate_if_needed(conn, password)
                cur = conn.execute("DELETE FROM todos WHERE id=?", (todo_id,))
                conn.commit()
                if cur.rowcount == 0:
                    return _response(False, 404, error="Todo not found.")
            return _response(True, 200, {"status": "ok"}, context={"activePassword": active_password})

        if path.startswith("/api/people/") and method in {"PUT", "DELETE"}:
            password = _require_password(active_password)
            uid = path.split("/api/people/", 1)[1]
            people = _load_people(password)

            if method == "DELETE":
                updated = [p for p in people if _normalize_text(p.get("uid")) != uid]
                if len(updated) == len(people):
                    return _response(False, 404, error="Person not found.")
                _save_people(updated, password)
                return _response(True, 200, {"status": "ok"}, context={"activePassword": active_password})

            if not isinstance(body, dict):
                return _response(False, 400, error="Invalid payload.")
            for person in people:
                if _normalize_text(person.get("uid")) == uid:
                    for key, value in body.items():
                        if key == "uid":
                            continue
                        person[key] = value
                    _save_people(people, password)
                    return _response(True, 200, {"person": person}, context={"activePassword": active_password})
            return _response(False, 404, error="Person not found.")

        return _response(False, 404, error=f"Unknown route: {method} {path}")

    except PermissionError as exc:
        return _response(False, 401, error=str(exc), context={"activePassword": active_password})
    except Exception as exc:
        return _response(False, 500, error=str(exc), context={"activePassword": active_password})


def main():
    try:
        payload = _read_stdin_json()
    except Exception as exc:
        fallback = _response(False, 400, error=f"Invalid JSON input: {exc}")
        sys.stdout.write(json.dumps(fallback))
        sys.stdout.flush()
        return

    try:
        result = handle(payload)
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        try:
            log_path = Path(tempfile.gettempdir()) / "workflow_python_api_error.log"
            with log_path.open("a", encoding="utf-8") as log_handle:
                log_handle.write("\n--- Unhandled error ---\n")
                traceback.print_exc(file=log_handle)
        except Exception:
            pass
        result = _response(False, 500, error=f"Unhandled error: {exc}")
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
