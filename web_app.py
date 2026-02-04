import csv
import io
import json
import os
import re
import tempfile
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from workflow import (
    APP_DATA_DIR,
    APP_VERSION,
    ARCHIVE_DIR_NAME,
    ARCHIVE_SECTIONS,
    BRANCH_OPTIONS,
    CODE_MAPS,
    CSV_EXPORT_FIELDS,
    EXPORTS_DIR_NAME,
    NO_ACTIVITIES_TEXT,
    NO_ENTRIES_TEXT,
    STATUS_FIELDS,
    TRACKER_DIR_NAME,
    WEEKDAY_NAMES,
    SecurityManager,
    _hash_password,
    _verify_password,
    ensure_dirs,
)

BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"
DATA_DIR = Path(APP_DATA_DIR)
ENC_FILE = DATA_DIR / "workflow_data.json.enc"
ARCHIVE_DIR = DATA_DIR / ARCHIVE_DIR_NAME
AUTH_FILE = DATA_DIR / "prog_auth.json"

ACTIVE_PASSWORD: Optional[str] = None
AUTH_TOKEN: Optional[str] = None

app = FastAPI(title="Workflow Web")

app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(WEB_DIR / "index.html")


def _normalize_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _get_password(request: Request) -> str:
    password = os.getenv("WORKFLOW_PASSWORD", "").strip()
    if password:
        return password
    if not ACTIVE_PASSWORD or not AUTH_TOKEN:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    session = request.cookies.get("workflow_session")
    if session != AUTH_TOKEN:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    return ACTIVE_PASSWORD


def _auth_configured() -> bool:
    return AUTH_FILE.exists()


def _load_auth() -> dict:
    if not AUTH_FILE.exists():
        raise HTTPException(status_code=404, detail="Program password not configured.")
    try:
        with open(AUTH_FILE, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Auth file unreadable.") from exc


def _status_badge(status: str) -> str:
    text = status.lower()
    # NEO dates are positive indicators — treat them as success (green)
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
    """Return a compact status string for card display.
    - If the person is scheduled for NEO, show the NEO date instead of 'Submitted'.
    - Hide generic values like 'none', 'cleared', 'submitted' from the card.
    Returns empty string when nothing useful to display.
    """
    # If scheduled, prefer showing the NEO date
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
        # Don't display generic/empty indicators on the card
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


def _person_display_name(person: dict) -> str:
    name = _normalize_text(person.get("Name"))
    if not name:
        first = _normalize_text(person.get("First Name"))
        last = _normalize_text(person.get("Last Name"))
        name = f"{first} {last}".strip() or "Unnamed"
    return name


def _is_removed(person: dict) -> bool:
    value = person.get("Removed")
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in {"true", "1", "yes", "removed"}


def _pick_manager(person: dict) -> str:
    value = _normalize_text(person.get("Manager Name"))
    if value:
        return value
    value = _normalize_text(person.get("Job Location"))
    return value or "Unassigned"


def _is_scheduled(person: dict) -> bool:
    if _normalize_text(person.get("NEO Scheduled Date")):
        return True
    scheduled = _normalize_text(person.get("Scheduled")).lower()
    return scheduled in {"yes", "true", "1", "scheduled"}


def _has_clearance(person: dict) -> bool:
    for key in ("CORI Status", "NH GC Status", "ME GC Status"):
        value = _normalize_text(person.get(key)).lower()
        if "cleared" in value or value == "clr":
            return True
    return False


def _column_for(person: dict) -> str:
    """Decide which column the person should appear in. Rules:
    - Not scheduled => 'not-scheduled'
    - If manually marked 'Onboarding Status' == 'In Progress' => 'in-progress'
    - Otherwise (scheduled) => 'neo-scheduled'

    This removes automatic movement to 'in-progress' based on clearances; moving to
    'in-progress' is now a manual action controlled by the Onboarding Status field.
    """
    if not _is_scheduled(person):
        return "not-scheduled"
    if _normalize_text(person.get("Onboarding Status")).lower() == "in progress":
        return "in-progress"
    return "neo-scheduled"


def _load_people(password: str) -> list:
    if not ENC_FILE.exists():
        return []
    security = SecurityManager(password)
    decrypted = security.decrypt(str(ENC_FILE))
    if not decrypted:
        raise HTTPException(status_code=401, detail="Unable to decrypt data. Check password.")
    try:
        people = json.loads(decrypted)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="Invalid data format.") from exc

    if not isinstance(people, list):
        raise HTTPException(status_code=500, detail="Invalid data format.")

    updated = False
    for person in people:
        if isinstance(person, dict) and not person.get("uid"):
            person["uid"] = str(uuid.uuid4())
            updated = True
    if updated:
        _save_people(people, password)
    return people


def _save_people(people: list, password: str) -> None:
    if not isinstance(people, list):
        raise HTTPException(status_code=500, detail="Invalid data format.")
    payload = json.dumps(people, indent=2, ensure_ascii=False)
    security = SecurityManager(password)
    if not security.encrypt(payload, str(ENC_FILE)):
        raise HTTPException(status_code=500, detail="Failed to save data.")


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
    week_file = _week_filename(week_start, week_end)
    if not week_file.exists():
        return {"metadata": {}, "entries": {}}
    try:
        with open(week_file, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {"metadata": {}, "entries": {}}

    if isinstance(data, dict) and "entries" in data:
        return data
    if isinstance(data, dict):
        return {"metadata": {}, "entries": data}
    return {"metadata": {}, "entries": {}}


def _save_week_data(week_start: datetime.date, week_end: datetime.date, entries: dict) -> dict:
    week_file = _week_filename(week_start, week_end)
    exports_dir = DATA_DIR / EXPORTS_DIR_NAME
    ensure_dirs(str(week_file.parent), str(exports_dir))
    payload = {
        "metadata": {
            "week_start": week_start.strftime("%Y-%m-%d"),
            "week_end": week_end.strftime("%Y-%m-%d"),
            "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        },
        "entries": entries,
    }
    with open(week_file, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
    return payload


def _parse_time_to_minutes(time_str: str) -> int | None:
    value = time_str.strip()
    if not value:
        return None
    match = None
    try:
        match = datetime.strptime(value, "%I:%M%p")
    except ValueError:
        try:
            match = datetime.strptime(value, "%H:%M")
        except ValueError:
            return None
    return match.hour * 60 + match.minute


def _calculate_day_hours(start_str: str, end_str: str) -> float:
    start_minutes = _parse_time_to_minutes(start_str)
    end_minutes = _parse_time_to_minutes(end_str)
    if start_minutes is None or end_minutes is None:
        return 0.0
    if end_minutes < start_minutes:
        end_minutes += 24 * 60
    return round((end_minutes - start_minutes) / 60.0, 2)


def _build_week_summary(week_start: datetime.date, week_end: datetime.date, entries: dict) -> str:
    total_week_hours = 0.0
    lines = []
    lines.append("=" * 60)
    lines.append("WEEKLY WORK TRACKER SUMMARY")
    lines.append(
        f"Work Week: {week_start.strftime('%B %d, %Y')} - {week_end.strftime('%B %d, %Y')}"
    )
    lines.append(f"Generated: {datetime.now().strftime('%B %d, %Y at %I:%M %p')}")
    lines.append("=" * 60)
    lines.append("")

    day_details = []
    for day_name in WEEKDAY_NAMES:
        day_data = entries.get(day_name, {}) if isinstance(entries, dict) else {}
        content = day_data.get("content", "") if isinstance(day_data, dict) else day_data
        start = day_data.get("start", "") if isinstance(day_data, dict) else ""
        end = day_data.get("end", "") if isinstance(day_data, dict) else ""

        day_hours = _calculate_day_hours(start, end)
        total_week_hours += day_hours

        day_details.append(f"--- {day_name} ---")
        if start and end:
            day_details.append(f"Time: {start} to {end} ({day_hours} hours)")
        else:
            day_details.append("Time: (Not specified)")

        day_details.append("Activities:")
        if content and content != NO_ENTRIES_TEXT:
            day_details.append(content)
        else:
            day_details.append(NO_ACTIVITIES_TEXT)
        day_details.append("")

    lines.append(f"TOTAL WEEKLY HOURS: {total_week_hours:.2f}")
    lines.append("-" * 60)
    lines.append("")
    lines.extend(day_details)
    return "\n".join(lines)


def _build_columns(people: list) -> dict:
    columns = {"not-scheduled": [], "neo-scheduled": [], "in-progress": []}
    for person in people:
        if not isinstance(person, dict):
            continue
        uid = _normalize_text(person.get("uid")) or str(uuid.uuid4())
        name = _person_display_name(person)
        status = _pick_status(person)
        columns[_column_for(person)].append(
            {
                "uid": uid,
                "name": name,
                "status": status,
                "manager": _pick_manager(person),
                "date": _pick_date(person),
                "badge": _status_badge(status),
            }
        )
    return columns


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


def _filter_people(people: list, search: str = "", branch: str = "") -> list:
    results = []
    for person in people:
        if not isinstance(person, dict):
            continue
        if _matches_search(person, search) and _matches_branch(person, branch):
            results.append(person)
    return results


def _parse_archive_date(neo_date_str: str) -> tuple[int, int]:
    if not neo_date_str:
        raise ValueError("Missing NEO date")
    parts = neo_date_str.strip().split("/")
    if len(parts) < 3:
        raise ValueError("Invalid NEO date format")
    month = int(parts[0])
    year = int(parts[2])
    if month < 1 or month > 12 or year < 1900:
        raise ValueError("Invalid NEO date values")
    return year, month


def _calculate_neo_hours(start_time: str, end_time: str) -> str:
    try:
        if not start_time or not end_time:
            return "N/A"
        start_str = (start_time or "").strip().replace(":", "")
        end_str = (end_time or "").strip().replace(":", "")
        if not start_str or not end_str:
            return "N/A"
        if len(start_str) < 4 or len(end_str) < 4:
            return "N/A"
        start_mins = int(start_str[:2]) * 60 + int(start_str[2:4])
        end_mins = int(end_str[:2]) * 60 + int(end_str[2:4])
        if end_mins < start_mins:
            end_mins += 24 * 60
        total_mins = end_mins - start_mins
        hours = total_mins // 60
        mins = total_mins % 60
        return f"{hours}h {mins}m" if mins else f"{hours}h"
    except (ValueError, IndexError):
        return "N/A"


def _build_archive_text(person: dict, start_time: str, end_time: str, total_hours: str) -> str:
    req_name = person.get("Name", "Unknown")
    req_eid = person.get("Employee ID", "N/A")
    req_neo = person.get("NEO Scheduled Date", "N/A")
    now = datetime.now()

    parts = [
        f"FILE ARCHIVED: {now.strftime('%m-%d-%Y %H%M')}",
        "",
        f"== {ARCHIVE_SECTIONS['candidate_info']} ==",
        f"Name: {req_name}",
        f"ICIMS ID: {person.get('ICIMS ID', 'N/A')}",
        f"Employee ID: {req_eid}",
        f"Hire Date (NEO): {req_neo}",
        f"Job Name: {person.get('Job Name', 'N/A')}",

        f"Job Location: {person.get('Job Location', 'N/A')}",
        f"Branch: {person.get('Branch', 'N/A')}",
        "",
        f"== {ARCHIVE_SECTIONS['neo_hours']} ==",
        f"Start: {start_time if start_time else 'N/A'}",
        f"End:   {end_time if end_time else 'N/A'}",
        f"Total Hours: {total_hours}",
        "",
        f"== {ARCHIVE_SECTIONS['uniform_sizes']} ==",
        f"Shirt: {person.get('Shirt Size', 'N/A')}",
        f"Pants: {person.get('Pants Size', 'N/A')}",
        f"Boots: {person.get('Boots Size', 'N/A')}",
        "",
    ]

    notes_text = (person.get("Notes") or "").strip()
    if notes_text:
        parts.extend([
            f"== {ARCHIVE_SECTIONS['notes']} ==",
            *[line.rstrip() for line in notes_text.splitlines()],
            "",
        ])

    parts.append("-" * 40)
    return "\n".join(parts)


def _archive_candidate(person: dict, archive_password: str, start_time: str, end_time: str) -> str:
    try:
        import pyzipper  # type: ignore
    except Exception as exc:
        raise HTTPException(status_code=500, detail="pyzipper is required for archives.") from exc

    req_name = person.get("Name", "").strip()
    req_neo = person.get("NEO Scheduled Date", "").strip()
    if not all([req_name, req_neo]):
        raise HTTPException(status_code=400, detail="Name and NEO Scheduled Date are required.")

    try:
        year, month = _parse_archive_date(req_neo)
        month_str = f"{year}_{int(month):02d}"
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid NEO Scheduled Date.") from exc

    ensure_dirs(str(ARCHIVE_DIR))
    archive_file = f"{month_str}.zip"
    archive_full = ARCHIVE_DIR / archive_file

    now = datetime.now()
    clean_name = re.sub(r"[^a-zA-Z0-9]", "_", req_name)
    month_folder = month_str
    readme_name = "README.txt"
    temp_archive = None

    def _count_people(entries: set[str]) -> int:
        prefix = f"{month_folder}/"
        return sum(1 for name in entries if name.startswith(prefix) and name.lower().endswith(".txt"))

    def _read_created_date(text: str, fallback: str) -> str:
        for line in text.splitlines():
            if line.lower().startswith("archive created:"):
                value = line.split(":", 1)[1].strip()
                return value or fallback
        return fallback

    created_date = now.strftime("%Y-%m-%d")
    total_hours = _calculate_neo_hours(start_time, end_time)
    file_body = _build_archive_text(person, start_time, end_time, total_hours)

    try:
        if archive_full.exists():
            tmp_handle = tempfile.NamedTemporaryFile(delete=False, dir=str(archive_full.parent), suffix=".tmp")
            temp_archive = tmp_handle.name
            tmp_handle.close()
            with pyzipper.AESZipFile(archive_full, "r") as zf_in:
                zf_in.setpassword(archive_password.encode("utf-8"))
                existing = set(zf_in.namelist())
                arcname = f"{month_folder}/{clean_name}.txt"
                if arcname in existing:
                    counter = 2
                    while True:
                        candidate = f"{month_folder}/{clean_name}_{counter}.txt"
                        if candidate not in existing:
                            arcname = candidate
                            break
                        counter += 1

                if readme_name in existing:
                    try:
                        existing_text = zf_in.read(readme_name).decode("utf-8", errors="replace")
                        created_date = _read_created_date(existing_text, created_date)
                    except Exception:
                        pass

                updated_entries = set(existing)
                updated_entries.add(arcname)
                people_count = _count_people(updated_entries)

                readme_text = "\n".join([
                    "Workflow Archive",
                    f"Program Version: {APP_VERSION}",
                    f"Archive Created: {created_date}",
                    f"Last Updated: {now.strftime('%Y-%m-%d')}",
                    f"People in Archive: {people_count}",
                    "",
                    "Contents:",
                    "This archive contains exported candidate records from the Workflow program.",
                    "Use common sense when handling sensitive PII. Keep files secure, share only with authorized staff,",
                    "and delete when no longer needed.",
                ])

                with pyzipper.AESZipFile(
                    temp_archive,
                    "w",
                    compression=pyzipper.ZIP_DEFLATED,
                    encryption=pyzipper.WZ_AES,
                ) as zf_out:
                    zf_out.setpassword(archive_password.encode("utf-8"))
                    zf_out.setencryption(pyzipper.WZ_AES, nbits=256)
                    for name in existing:
                        if name == readme_name:
                            continue
                        data = zf_in.read(name)
                        zf_out.writestr(name, data)
                    zf_out.writestr(arcname, file_body)
                    zf_out.writestr(readme_name, readme_text)

            os.replace(temp_archive, archive_full)
        else:
            tmp_handle = tempfile.NamedTemporaryFile(delete=False, dir=str(archive_full.parent), suffix=".tmp")
            temp_archive = tmp_handle.name
            tmp_handle.close()
            arcname = f"{month_folder}/{clean_name}.txt"
            people_count = 1
            readme_text = "\n".join([
                "Workflow Archive",
                f"Program Version: {APP_VERSION}",
                f"Archive Created: {created_date}",
                f"Last Updated: {now.strftime('%Y-%m-%d')}",
                f"People in Archive: {people_count}",
                "",
                "Contents:",
                "This archive contains exported candidate records from the Workflow program.",
                "Use common sense when handling sensitive PII. Keep files secure, share only with authorized staff,",
                "and delete when no longer needed.",
            ])

            with pyzipper.AESZipFile(
                temp_archive,
                "w",
                compression=pyzipper.ZIP_DEFLATED,
                encryption=pyzipper.WZ_AES,
            ) as zf_out:
                zf_out.setpassword(archive_password.encode("utf-8"))
                zf_out.setencryption(pyzipper.WZ_AES, nbits=256)
                zf_out.writestr(arcname, file_body)
                zf_out.writestr(readme_name, readme_text)
            os.replace(temp_archive, archive_full)
    finally:
        if temp_archive and os.path.exists(temp_archive):
            try:
                os.remove(temp_archive)
            except Exception:
                pass

    return str(archive_full)


@app.get("/api/schema")
def get_schema(request: Request):
    _get_password(request)
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
    return {
        "fields": fields,
        "status_fields": STATUS_FIELDS,
        "code_maps": CODE_MAPS,
        "branches": BRANCH_OPTIONS,
    }


@app.get("/api/people")
def get_people(request: Request, search: str = "", branch: str = ""):
    password = _get_password(request)
    people = _load_people(password)
    filtered = [person for person in _filter_people(people, search=search, branch=branch) if not _is_removed(person)]
    columns = _build_columns(filtered)
    summary = {key: len(value) for key, value in columns.items()}
    summary["total"] = sum(summary.values())
    return {"people": filtered, "columns": columns, "summary": summary}


@app.get("/api/removed")
def get_removed(request: Request):
    password = _get_password(request)
    people = _load_people(password)
    removed = [
        {"uid": person.get("uid"), "name": _person_display_name(person)}
        for person in people
        if isinstance(person, dict) and _is_removed(person)
    ]
    removed.sort(key=lambda item: (item.get("name") or "").lower())
    return {"removed": removed}


@app.post("/api/people")
def create_person(request: Request, payload: dict):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload.")
    password = _get_password(request)
    people = _load_people(password)
    payload = {key: value for key, value in payload.items()}
    payload["uid"] = str(uuid.uuid4())
    people.append(payload)
    _save_people(people, password)
    return {"person": payload}


@app.put("/api/people/{uid}")
def update_person(request: Request, uid: str, payload: dict):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload.")
    password = _get_password(request)
    people = _load_people(password)
    for person in people:
        if _normalize_text(person.get("uid")) == uid:
            for key, value in payload.items():
                if key == "uid":
                    continue
                person[key] = value
            _save_people(people, password)
            return {"person": person}
    raise HTTPException(status_code=404, detail="Person not found.")


@app.delete("/api/people/{uid}")
def delete_person(request: Request, uid: str):
    password = _get_password(request)
    people = _load_people(password)
    updated = [person for person in people if _normalize_text(person.get("uid")) != uid]
    if len(updated) == len(people):
        raise HTTPException(status_code=404, detail="Person not found.")
    _save_people(updated, password)
    return {"status": "ok"}


@app.get("/api/export/csv")
def export_csv(request: Request):
    password = _get_password(request)
    people = _load_people(password)
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CSV_EXPORT_FIELDS)
    writer.writeheader()
    for person in people:
        if not isinstance(person, dict):
            continue
        row = {field: person.get(field, "") for field in CSV_EXPORT_FIELDS}
        writer.writerow(row)
    csv_text = buffer.getvalue()
    ensure_dirs(str(DATA_DIR / EXPORTS_DIR_NAME))
    date_stamp = datetime.now().strftime("%Y_%m_%d")
    filename = f"{date_stamp}.csv"
    export_path = DATA_DIR / EXPORTS_DIR_NAME / filename
    if export_path.exists():
        counter = 2
        while True:
            candidate = DATA_DIR / EXPORTS_DIR_NAME / f"{date_stamp}_{counter}.csv"
            if not candidate.exists():
                export_path = candidate
                filename = candidate.name
                break
            counter += 1
    try:
        with open(export_path, "w", encoding="utf-8") as handle:
            handle.write(csv_text)
    except OSError:
        pass
    headers = {"Content-Disposition": f"attachment; filename={filename}"}
    return Response(content=csv_text, media_type="text/csv", headers=headers)


@app.get("/api/exports/list")
def list_exports(request: Request):
    _get_password(request)
    exports_dir = DATA_DIR / EXPORTS_DIR_NAME
    ensure_dirs(str(exports_dir))
    files = sorted(
        [p.name for p in exports_dir.iterdir() if p.is_file() and p.suffix.lower() in {".csv", ".txt"}],
        reverse=True,
    )
    return {"files": files}


@app.get("/api/exports/file")
def download_export(request: Request, name: str):
    _get_password(request)
    exports_dir = DATA_DIR / EXPORTS_DIR_NAME
    ensure_dirs(str(exports_dir))
    candidate = (exports_dir / name).resolve()
    if candidate.parent != exports_dir.resolve() or not candidate.exists():
        raise HTTPException(status_code=404, detail="File not found.")
    if candidate.suffix.lower() not in {".csv", ".txt"}:
        raise HTTPException(status_code=400, detail="Invalid file.")
    return FileResponse(candidate, filename=candidate.name)


@app.delete("/api/exports/delete")
def delete_export(request: Request, name: str):
    _get_password(request)
    exports_dir = DATA_DIR / EXPORTS_DIR_NAME
    ensure_dirs(str(exports_dir))
    candidate = (exports_dir / name).resolve()
    if candidate.parent != exports_dir.resolve() or not candidate.exists():
        raise HTTPException(status_code=404, detail="File not found.")
    if candidate.suffix.lower() not in {".csv", ".txt"}:
        raise HTTPException(status_code=400, detail="Invalid file.")
    try:
        candidate.unlink()
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Unable to delete file.") from exc
    return {"status": "ok"}


@app.get("/api/exports/preview")
def preview_export(request: Request, name: str, limit: int = 20):
    _get_password(request)
    exports_dir = DATA_DIR / EXPORTS_DIR_NAME
    ensure_dirs(str(exports_dir))
    candidate = (exports_dir / name).resolve()
    if candidate.parent != exports_dir.resolve() or not candidate.exists():
        raise HTTPException(status_code=404, detail="File not found.")
    if candidate.suffix.lower() != ".csv":
        raise HTTPException(status_code=400, detail="Preview only available for CSV files.")
    limit = max(1, min(limit, 200))
    try:
        with open(candidate, "r", encoding="utf-8", newline="") as handle:
            reader = csv.reader(handle)
            headers = next(reader, [])
            rows = []
            for _, row in zip(range(limit), reader):
                rows.append(row)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Unable to read file.") from exc
    return {"headers": headers, "rows": rows, "limit": limit}


@app.get("/api/weekly/current")
def get_current_week(request: Request):
    _get_password(request)
    week_start, week_end = _get_current_week()
    data = _load_week_data(week_start, week_end)
    entries = data.get("entries", {}) if isinstance(data, dict) else {}
    normalized = {}
    for day in WEEKDAY_NAMES:
        day_data = entries.get(day, {}) if isinstance(entries, dict) else {}
        if not isinstance(day_data, dict):
            day_data = {"content": day_data, "start": "", "end": ""}
        normalized[day] = {
            "content": day_data.get("content", ""),
            "start": day_data.get("start", ""),
            "end": day_data.get("end", ""),
        }
    return {
        "week_start": week_start.strftime("%Y-%m-%d"),
        "week_end": week_end.strftime("%Y-%m-%d"),
        "entries": normalized,
    }


@app.post("/api/weekly/current")
def save_current_week(request: Request, payload: dict):
    _get_password(request)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload.")
    week_start, week_end = _get_current_week()
    entries = payload.get("entries", {}) if isinstance(payload.get("entries"), dict) else {}
    normalized = {}
    for day in WEEKDAY_NAMES:
        day_data = entries.get(day, {}) if isinstance(entries, dict) else {}
        if not isinstance(day_data, dict):
            day_data = {"content": day_data}
        normalized[day] = {
            "content": day_data.get("content", "") or NO_ENTRIES_TEXT,
            "start": day_data.get("start", ""),
            "end": day_data.get("end", ""),
        }
    data = _save_week_data(week_start, week_end, normalized)
    return {"status": "ok", "data": data}


@app.get("/api/weekly/summary")
def export_week_summary(request: Request):
    _get_password(request)
    week_start, week_end = _get_current_week()
    data = _load_week_data(week_start, week_end)
    entries = data.get("entries", {}) if isinstance(data, dict) else {}
    summary = _build_week_summary(week_start, week_end, entries)
    filename = f"Week_{week_start.strftime('%Y-%m-%d')}_to_{week_end.strftime('%Y-%m-%d')}_SUMMARY.txt"
    headers = {"Content-Disposition": f"attachment; filename={filename}"}
    return Response(content=summary, media_type="text/plain", headers=headers)


@app.get("/api/auth/status")
def auth_status(request: Request):
    configured = _auth_configured()
    authenticated = False
    if os.getenv("WORKFLOW_PASSWORD", "").strip():
        authenticated = True
    elif ACTIVE_PASSWORD and AUTH_TOKEN:
        authenticated = request.cookies.get("workflow_session") == AUTH_TOKEN
    return {"configured": configured, "authenticated": authenticated}


@app.post("/api/auth/setup")
def auth_setup(payload: dict):
    if _auth_configured():
        raise HTTPException(status_code=400, detail="Already configured.")
    password = (payload or {}).get("password") if isinstance(payload, dict) else None
    if not password:
        raise HTTPException(status_code=400, detail="Password required.")
    ensure_dirs(str(DATA_DIR))
    cred = _hash_password(password)
    try:
        with open(AUTH_FILE, "w", encoding="utf-8") as handle:
            json.dump(cred, handle)
        try:
            os.chmod(AUTH_FILE, 0o600)
        except Exception:
            pass
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to write auth file.") from exc
    return {"status": "ok"}


@app.post("/api/auth/login")
def auth_login(payload: dict):
    if not _auth_configured():
        raise HTTPException(status_code=400, detail="Not configured.")
    password = (payload or {}).get("password") if isinstance(payload, dict) else None
    if not password:
        raise HTTPException(status_code=400, detail="Password required.")
    stored = _load_auth()
    salt = stored.get("salt")
    iters = int(stored.get("iterations", 200000))
    key = stored.get("key")
    if not _verify_password(password, salt, iters, key):
        raise HTTPException(status_code=401, detail="Invalid password.")
    global ACTIVE_PASSWORD, AUTH_TOKEN
    ACTIVE_PASSWORD = password
    AUTH_TOKEN = uuid.uuid4().hex
    response = JSONResponse({"status": "ok"})
    response.set_cookie("workflow_session", AUTH_TOKEN, httponly=True, samesite="lax")
    return response


@app.post("/api/auth/logout")
def auth_logout():
    global ACTIVE_PASSWORD, AUTH_TOKEN
    ACTIVE_PASSWORD = None
    AUTH_TOKEN = None
    response = JSONResponse({"status": "ok"})
    response.delete_cookie("workflow_session")
    return response


@app.post("/api/auth/change")
def auth_change(payload: dict):
    """Change the program password.
    Required payload: { "current": "current_password", "new": "new_password" }
    User must provide the current password and it must match the stored credential.
    """
    if os.getenv("WORKFLOW_PASSWORD", "").strip():
        raise HTTPException(status_code=400, detail="Cannot change password when WORKFLOW_PASSWORD is set.")
    if not _auth_configured():
        raise HTTPException(status_code=400, detail="Not configured.")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload.")
    current = (payload or {}).get("current")
    new = (payload or {}).get("new")
    if not current or not new:
        raise HTTPException(status_code=400, detail="Current and new passwords are required.")
    stored = _load_auth()
    salt = stored.get("salt")
    iters = int(stored.get("iterations", 200000))
    key = stored.get("key")
    if not _verify_password(current, salt, iters, key):
        raise HTTPException(status_code=401, detail="Invalid current password.")
    # Hash and write the new password
    cred = _hash_password(new)
    try:
        with open(AUTH_FILE, "w", encoding="utf-8") as handle:
            json.dump(cred, handle)
        try:
            os.chmod(AUTH_FILE, 0o600)
        except Exception:
            pass
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to write auth file.") from exc
    # Update runtime session
    global ACTIVE_PASSWORD, AUTH_TOKEN
    ACTIVE_PASSWORD = new
    AUTH_TOKEN = uuid.uuid4().hex
    response = JSONResponse({"status": "ok"})
    response.set_cookie("workflow_session", AUTH_TOKEN, httponly=True, samesite="lax")
    return response


@app.get("/api/archive/list")
def list_archives(request: Request):
    _get_password(request)
    ensure_dirs(str(ARCHIVE_DIR))
    archives = sorted([p.name for p in ARCHIVE_DIR.glob("*.zip")], reverse=True)
    return {"archives": archives}


@app.post("/api/archive/{uid}")
def archive_person(request: Request, uid: str, payload: dict):
    password = _get_password(request)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload.")
    archive_password = payload.get("archive_password", "")
    start_time = payload.get("start_time", "")
    end_time = payload.get("end_time", "")
    if not archive_password:
        raise HTTPException(status_code=400, detail="Archive password required.")
    people = _load_people(password)
    for index, person in enumerate(people):
        if _normalize_text(person.get("uid")) == uid:
            archive_path = _archive_candidate(person, archive_password, start_time, end_time)
            people.pop(index)
            _save_people(people, password)
            return {"status": "ok", "archive": archive_path}
    raise HTTPException(status_code=404, detail="Person not found.")


def _validate_archive_name(archive_name: str) -> Path:
    ensure_dirs(str(ARCHIVE_DIR))
    candidate = ARCHIVE_DIR / archive_name
    if not candidate.exists() or candidate.suffix.lower() != ".zip":
        raise HTTPException(status_code=404, detail="Archive not found.")
    if candidate.parent.resolve() != ARCHIVE_DIR.resolve():
        raise HTTPException(status_code=400, detail="Invalid archive.")
    return candidate


@app.post("/api/archive/{archive_name}/contents")
def archive_contents(request: Request, archive_name: str, payload: dict):
    _get_password(request)
    archive_password = (payload or {}).get("archive_password") if isinstance(payload, dict) else None
    if not archive_password:
        raise HTTPException(status_code=400, detail="Archive password required.")
    archive_path = _validate_archive_name(archive_name)
    try:
        import pyzipper  # type: ignore
    except Exception as exc:
        raise HTTPException(status_code=500, detail="pyzipper is required for archives.") from exc
    try:
        with pyzipper.AESZipFile(archive_path, "r") as zf:
            zf.setpassword(archive_password.encode("utf-8"))
            names = [name for name in zf.namelist() if name.lower().endswith(".txt")]
    except RuntimeError:
        raise HTTPException(status_code=401, detail="Invalid archive password.")
    return {"files": sorted(names)}


@app.post("/api/archive/{archive_name}/file")
def archive_file(request: Request, archive_name: str, payload: dict):
    _get_password(request)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload.")
    archive_password = payload.get("archive_password")
    internal_path = payload.get("internal_path")
    if not archive_password or not internal_path:
        raise HTTPException(status_code=400, detail="Missing parameters.")
    if ".." in internal_path or internal_path.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid path.")
    archive_path = _validate_archive_name(archive_name)
    try:
        import pyzipper  # type: ignore
    except Exception as exc:
        raise HTTPException(status_code=500, detail="pyzipper is required for archives.") from exc
    try:
        with pyzipper.AESZipFile(archive_path, "r") as zf:
            zf.setpassword(archive_password.encode("utf-8"))
            data = zf.read(internal_path)
    except KeyError:
        raise HTTPException(status_code=404, detail="File not found.")
    except RuntimeError:
        raise HTTPException(status_code=401, detail="Invalid archive password.")
    filename = Path(internal_path).name
    headers = {"Content-Disposition": f"attachment; filename={filename}"}
    return Response(content=data, media_type="text/plain", headers=headers)


@app.delete("/api/archive/{archive_name}")
def archive_delete(request: Request, archive_name: str):
    _get_password(request)
    archive_path = _validate_archive_name(archive_name)
    try:
        archive_path.unlink()
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to delete archive.") from exc
    return {"status": "ok"}


@app.get("/api/archive/{archive_name}/download")
def archive_download(request: Request, archive_name: str):
    _get_password(request)
    archive_path = _validate_archive_name(archive_name)
    return FileResponse(str(archive_path), media_type="application/zip", filename=archive_path.name)
