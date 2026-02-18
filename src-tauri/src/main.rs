#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use aes_gcm::aead::{rand_core::RngCore, Aead, OsRng};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use pbkdf2::pbkdf2_hmac;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Window};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;

const AUTH_FILE: &str = "auth.json";
const DATA_FILE: &str = "workflow.enc";
const META_FILE: &str = "meta.json";
const EMAIL_TEMPLATES_FILE: &str = "email_templates.json";
const DEFAULT_PBKDF2_ITERATIONS: u32 = 200_000;
const DB_VERSION: u8 = 3;
const DB_TABLE_ORDER: [&str; 6] = [
    "kanban_columns",
    "kanban_cards",
    "candidate_data",
    "uniform_inventory",
    "weekly_entries",
    "todos",
];
const KANBAN_COLUMNS_COLUMNS: [&str; 5] = ["id", "name", "order", "created_at", "updated_at"];
const KANBAN_CARDS_COLUMNS: [&str; 14] = [
    "uuid",
    "candidate_name",
    "icims_id",
    "employee_id",
    "job_id",
    "req_id",
    "job_name",
    "job_location",
    "manager",
    "branch",
    "column_id",
    "order",
    "created_at",
    "updated_at",
];
const UNIFORM_COLUMNS: [&str; 7] = [
    "Alteration",
    "Type",
    "Size",
    "Waist",
    "Inseam",
    "Quantity",
    "Branch",
];
const WEEKLY_COLUMNS: [&str; 6] = ["week_start", "week_end", "day", "start", "end", "content"];
const TODO_COLUMNS: [&str; 4] = ["id", "text", "done", "createdAt"];
const CANDIDATE_FIELDS: [&str; 60] = [
    "Candidate Name",
    "Hire Date",
    "ICIMS ID",
    "Employee ID",
    "Neo Arrival Time",
    "Neo Departure Time",
    "Total Neo Hours",
    "REQ ID",
    "Job ID Name",
    "Job Location",
    "Manager",
    "Branch",
    "Contact Phone",
    "Contact Email",
    "Background Provider",
    "Background Cleared Date",
    "Background MVR Flag",
    "License Type",
    "MA CORI Status",
    "MA CORI Date",
    "NH GC Status",
    "NH GC Expiration Date",
    "NH GC ID Number",
    "ME GC Status",
    "ME GC Expiration Date",
    "ID Type",
    "State Abbreviation",
    "ID Number",
    "DOB",
    "EXP",
    "Other ID Type",
    "Social",
    "Bank Name",
    "Account Type",
    "Routing Number",
    "Account Number",
    "Shirt Size",
    "Waist",
    "Inseam",
    "Issued Shirt Size",
    "Issued Waist",
    "Issued Inseam",
    "Issued Pants Size",
    "Issued Shirt Type",
    "Issued Shirts Given",
    "Issued Pants Type",
    "Issued Pants Given",
    "Uniforms Issued",
    "Shirt Type",
    "Shirts Given",
    "Pants Type",
    "Pants Given",
    "Pants Size",
    "Boots Size",
    "Emergency Contact Name",
    "Emergency Contact Relationship",
    "Emergency Contact Phone",
    "Additional Details",
    "Additional Notes",
    "candidate UUID",
];
const SENSITIVE_PII_FIELDS: [&str; 29] = [
    "Contact Phone",
    "Contact Email",
    "Background Provider",
    "Background Cleared Date",
    "Background MVR Flag",
    "License Type",
    "MA CORI Status",
    "MA CORI Date",
    "NH GC Status",
    "NH GC Expiration Date",
    "NH GC ID Number",
    "ME GC Status",
    "ME GC Expiration Date",
    "ID Type",
    "State Abbreviation",
    "ID Number",
    "DOB",
    "EXP",
    "Other ID Type",
    "Social",
    "Bank Name",
    "Account Type",
    "Routing Number",
    "Account Number",
    "Emergency Contact Name",
    "Emergency Contact Relationship",
    "Emergency Contact Phone",
    "Additional Details",
    "Additional Notes",
];
const SENSITIVE_CARD_FIELDS: [&str; 2] = ["icims_id", "employee_id"];

#[derive(Default)]
struct DbCacheState {
    key: Option<String>,
    value: Option<serde_json::Value>,
    db_salt: Option<Vec<u8>>,
    db_key: Option<[u8; 32]>,
}

#[derive(Serialize)]
struct PickTextFileResult {
    ok: bool,
    canceled: bool,
    name: Option<String>,
    data: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct SaveCsvRequest {
    filename: String,
    content: String,
}

#[derive(Serialize)]
struct SaveCsvResult {
    ok: bool,
    canceled: bool,
    filename: String,
    path: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
struct StorageInfoResult {
    ok: bool,
    path_label: String,
}

#[derive(Deserialize)]
struct StorageReadRequest {
    name: String,
}

#[derive(Deserialize)]
struct StorageWriteRequest {
    name: String,
    text: String,
}

#[derive(Deserialize)]
struct StorageWriteJsonRequest {
    name: String,
    value: serde_json::Value,
}

#[derive(Deserialize)]
struct DbAuthRequest {
    password: String,
}

#[derive(Deserialize)]
struct DbTodosSetRequest {
    password: String,
    todos: serde_json::Value,
}

#[derive(Deserialize)]
struct DbWeeklyGetRequest {
    password: String,
    week_start: String,
    week_end: String,
}

#[derive(Deserialize)]
struct DbWeeklySetRequest {
    password: String,
    week_start: String,
    week_end: String,
    entries: serde_json::Value,
}

#[derive(Deserialize)]
struct EmailTemplatesSetRequest {
    value: serde_json::Value,
}

#[derive(Deserialize)]
struct DbGetTableRequest {
    password: String,
    table_id: String,
}

#[derive(Deserialize)]
struct DbKanbanAddColumnRequest {
    password: String,
    name: String,
}

#[derive(Deserialize)]
struct DbKanbanColumnRequest {
    password: String,
    column_id: String,
}

#[derive(Deserialize)]
struct DbKanbanAddCardRequest {
    password: String,
    payload: serde_json::Value,
}

#[derive(Deserialize)]
struct DbKanbanUpdateCardRequest {
    password: String,
    id: String,
    payload: serde_json::Value,
}

#[derive(Deserialize)]
struct DbPiiRequest {
    password: String,
    candidate_id: String,
}

#[derive(Deserialize)]
struct DbPiiSaveRequest {
    password: String,
    candidate_id: String,
    data: serde_json::Value,
}

#[derive(Deserialize)]
struct DbKanbanProcessCandidateRequest {
    password: String,
    candidate_id: String,
    arrival: String,
    departure: String,
    branch: String,
}

#[derive(Deserialize)]
struct DbKanbanReorderRequest {
    password: String,
    column_id: String,
    card_ids: Vec<String>,
}

#[derive(Deserialize)]
struct DbUniformsAddItemRequest {
    password: String,
    payload: serde_json::Value,
}

#[derive(Deserialize)]
struct DbDeleteRowsRequest {
    password: String,
    table_id: String,
    row_ids: Vec<String>,
}

#[derive(Deserialize)]
struct DbRecycleRequest {
    password: String,
    id: String,
}

#[derive(Deserialize)]
struct DbSourceSetRequest {
    password: String,
    source_id: String,
}

#[derive(Deserialize)]
struct DbSourceTableListRequest {
    password: String,
    source_id: String,
}

#[derive(Deserialize)]
struct DbSourceTableRequest {
    password: String,
    source_id: String,
    table_id: String,
}

#[derive(Deserialize)]
struct DbImportApplyRequest {
    action: String,
    file_name: Option<String>,
    file_data: String,
    password: String,
}

#[derive(Deserialize)]
struct DbExportCsvRequest {
    filename: String,
    columns: serde_json::Value,
    rows: serde_json::Value,
}

#[derive(Serialize)]
struct DbTableInfo {
    id: String,
    name: String,
    count: usize,
}

#[derive(Serialize)]
struct DbTableResult {
    id: String,
    name: String,
    columns: Vec<String>,
    rows: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
struct StorageEncryptedReadRequest {
    name: String,
    password: String,
}

#[derive(Deserialize)]
struct StorageEncryptedWriteRequest {
    name: String,
    password: String,
    text: String,
}

#[derive(Deserialize)]
struct CryptoHashPasswordRequest {
    password: String,
    salt: String,
    iterations: Option<u32>,
}

#[derive(Deserialize)]
struct CryptoEncryptRequest {
    text: String,
    password: String,
}

#[derive(Deserialize)]
struct CryptoDecryptRequest {
    password: String,
    salt: String,
    iv: String,
    tag: String,
    data: String,
}

#[derive(Serialize, Deserialize)]
struct CryptoEnvelope {
    v: u8,
    salt: String,
    iv: String,
    tag: String,
    data: String,
}

#[derive(Serialize, Deserialize)]
struct AuthRecord {
    salt: String,
    hash: String,
    #[serde(default = "default_pbkdf2_iterations")]
    iterations: u32,
}

#[derive(Deserialize)]
struct AuthSetupRequest {
    password: String,
    iterations: Option<u32>,
}

#[derive(Deserialize)]
struct AuthVerifyRequest {
    password: String,
}

#[derive(Deserialize)]
struct AuthChangeRequest {
    current: String,
    next: String,
    iterations: Option<u32>,
}

#[derive(Deserialize)]
struct SetupCompleteRequest {
    donation_choice: Option<String>,
}

#[derive(Deserialize)]
struct BiometricEnableRequest {
    password: String,
}

#[derive(Deserialize)]
struct ClipboardWriteRequest {
    text: String,
}

#[derive(Deserialize)]
struct OpenExternalRequest {
    url: String,
}

#[derive(Deserialize)]
struct OpenEmailDraftRequest {
    filename: String,
    content: String,
}

#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn platform_name() -> String {
    match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        "android" => "android",
        _ => "linux",
    }
    .to_string()
}

#[tauri::command]
fn setup_status(app: AppHandle) -> Result<serde_json::Value, String> {
    let folder = storage_root_dir(&app)?.to_string_lossy().to_string();
    Ok(json!({
        "needsSetup": false,
        "folder": folder,
        "fallback": false,
    }))
}

#[tauri::command]
fn setup_complete(payload: SetupCompleteRequest) -> Result<bool, String> {
    let _ = payload.donation_choice;
    Ok(true)
}

#[tauri::command]
fn donation_preference() -> Result<serde_json::Value, String> {
    Ok(json!({ "choice": "not_now" }))
}

#[tauri::command]
fn biometric_status() -> Result<serde_json::Value, String> {
    Ok(json!({
        "available": false,
        "enabled": false,
        "biometryType": serde_json::Value::Null,
    }))
}

#[tauri::command]
fn biometric_enable(payload: BiometricEnableRequest) -> Result<serde_json::Value, String> {
    let _ = payload.password;
    Ok(json!({
        "ok": false,
        "error": "Biometrics unavailable.",
    }))
}

#[tauri::command]
fn biometric_disable() -> Result<serde_json::Value, String> {
    Ok(json!({
        "ok": false,
        "error": "Biometrics unavailable.",
    }))
}

#[tauri::command]
fn biometric_unlock() -> Result<serde_json::Value, String> {
    Ok(json!({
        "ok": false,
        "password": serde_json::Value::Null,
        "error": "Biometrics unavailable.",
    }))
}

#[tauri::command]
fn donate() -> Result<serde_json::Value, String> {
    Ok(json!({
        "ok": false,
        "message": "Billing unavailable.",
    }))
}

#[tauri::command]
fn clipboard_write(app: AppHandle, payload: ClipboardWriteRequest) -> Result<bool, String> {
    app.clipboard()
        .write_text(payload.text)
        .map_err(|err| err.to_string())?;
    Ok(true)
}

#[tauri::command]
fn open_external(app: AppHandle, payload: OpenExternalRequest) -> Result<bool, String> {
    app.opener()
        .open_url(payload.url, Option::<String>::None)
        .map_err(|err: tauri_plugin_opener::Error| err.to_string())?;
    Ok(true)
}

#[tauri::command]
fn open_email_draft(app: AppHandle, payload: OpenEmailDraftRequest) -> Result<bool, String> {
    let root = storage_root_dir(&app)?;
    let mut rel = sanitize_relative_path(payload.filename.as_str())?;
    let rel_str = rel.to_string_lossy().to_string();
    if !rel_str.to_lowercase().ends_with(".eml") {
        rel = PathBuf::from(format!("{}.eml", rel_str));
    }
    let path = root.join(rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    write_text_file(path.clone(), payload.content.as_str())?;
    app.opener()
        .open_url(path.to_string_lossy().to_string(), Option::<String>::None)
        .map_err(|err: tauri_plugin_opener::Error| err.to_string())?;
    Ok(true)
}

#[tauri::command]
fn window_minimize(window: Window) -> Result<(), String> {
    window.minimize().map_err(|err| err.to_string())
}

#[tauri::command]
fn window_maximize(window: Window) -> Result<(), String> {
    window.maximize().map_err(|err| err.to_string())
}

#[tauri::command]
fn window_unmaximize(window: Window) -> Result<(), String> {
    window.unmaximize().map_err(|err| err.to_string())
}

#[tauri::command]
fn window_toggle_maximize(window: Window) -> Result<(), String> {
    if window.is_maximized().map_err(|err| err.to_string())? {
        window.unmaximize().map_err(|err| err.to_string())
    } else {
        window.maximize().map_err(|err| err.to_string())
    }
}

#[tauri::command]
fn window_is_maximized(window: Window) -> Result<bool, String> {
    window.is_maximized().map_err(|err| err.to_string())
}

#[tauri::command]
fn window_close(window: Window) -> Result<(), String> {
    window.close().map_err(|err| err.to_string())
}

#[tauri::command]
fn pick_text_file() -> Result<PickTextFileResult, String> {
    let path = rfd::FileDialog::new()
        .add_filter("Workflow Backup", &["enc", "json"])
        .add_filter("Text", &["txt"])
        .pick_file();

    let Some(path) = path else {
        return Ok(PickTextFileResult {
            ok: false,
            canceled: true,
            name: None,
            data: None,
            error: None,
        });
    };

    let data = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .or_else(|| Some("workflow-import.enc".to_string()));

    Ok(PickTextFileResult {
        ok: true,
        canceled: false,
        name,
        data: Some(data),
        error: None,
    })
}

#[tauri::command]
fn save_csv_file(payload: SaveCsvRequest) -> Result<SaveCsvResult, String> {
    let default_name = sanitize_filename(payload.filename.as_str());
    let path = rfd::FileDialog::new()
        .set_file_name(default_name.as_str())
        .save_file();

    let Some(path) = path else {
        return Ok(SaveCsvResult {
            ok: false,
            canceled: true,
            filename: default_name,
            path: None,
            error: None,
        });
    };

    write_text_file(path.clone(), payload.content.as_str())?;
    Ok(SaveCsvResult {
        ok: true,
        canceled: false,
        filename: default_name,
        path: Some(path.to_string_lossy().to_string()),
        error: None,
    })
}

#[tauri::command]
fn db_export_csv(payload: DbExportCsvRequest) -> Result<SaveCsvResult, String> {
    let filename = sanitize_export_filename(payload.filename.as_str());
    let mut columns = sanitize_export_columns(&payload.columns);
    let mut rows = payload.rows.as_array().cloned().unwrap_or_default();
    if rows.len() > 50_000 {
        rows.truncate(50_000);
    }
    if columns.is_empty() {
        if let Some(first_row) = rows.first().and_then(|row| row.as_object()) {
            for key in first_row.keys() {
                if key == "__rowId" {
                    continue;
                }
                let safe = clamp_string(key.as_str(), 80, false);
                if !safe.is_empty() {
                    columns.push(safe);
                }
            }
        }
    }
    let csv = rows_to_csv(columns.as_slice(), rows.as_slice());
    save_csv_file(SaveCsvRequest {
        filename,
        content: csv,
    })
}

#[tauri::command]
fn storage_info(app: AppHandle) -> Result<StorageInfoResult, String> {
    let root = storage_root_dir(&app)?;
    Ok(StorageInfoResult {
        ok: true,
        path_label: root.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn storage_read_text(
    app: AppHandle,
    payload: StorageReadRequest,
) -> Result<Option<String>, String> {
    let root = storage_root_dir(&app)?;
    let rel = sanitize_relative_path(payload.name.as_str())?;
    let path = root.join(rel);
    if !path.exists() {
        return Ok(None);
    }
    let data = fs::read_to_string(path).map_err(|err| err.to_string())?;
    Ok(Some(data))
}

#[tauri::command]
fn storage_write_text(app: AppHandle, payload: StorageWriteRequest) -> Result<bool, String> {
    let root = storage_root_dir(&app)?;
    let rel = sanitize_relative_path(payload.name.as_str())?;
    let path = root.join(rel);
    write_text_file(path, payload.text.as_str())?;
    Ok(true)
}

#[tauri::command]
fn storage_read_json(
    app: AppHandle,
    payload: StorageReadRequest,
) -> Result<Option<serde_json::Value>, String> {
    let root = storage_root_dir(&app)?;
    let rel = sanitize_relative_path(payload.name.as_str())?;
    let path = root.join(rel);
    if !path.exists() {
        return Ok(None);
    }
    let data = fs::read_to_string(path).map_err(|err| err.to_string())?;
    match serde_json::from_str::<serde_json::Value>(data.as_str()) {
        Ok(value) => Ok(Some(value)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
fn storage_write_json(app: AppHandle, payload: StorageWriteJsonRequest) -> Result<bool, String> {
    let root = storage_root_dir(&app)?;
    let rel = sanitize_relative_path(payload.name.as_str())?;
    let path = root.join(rel);
    let content = serde_json::to_string_pretty(&payload.value).map_err(|err| err.to_string())?;
    write_text_file(path, content.as_str())?;
    Ok(true)
}

#[tauri::command]
fn storage_read_encrypted_json(
    app: AppHandle,
    payload: StorageEncryptedReadRequest,
) -> Result<Option<String>, String> {
    let root = storage_root_dir(&app)?;
    let rel = sanitize_relative_path(payload.name.as_str())?;
    let path = root.join(rel);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let envelope: CryptoEnvelope = match serde_json::from_str(raw.as_str()) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    decrypt_envelope(&envelope, payload.password.as_str())
}

#[tauri::command]
fn storage_write_encrypted_json(
    app: AppHandle,
    payload: StorageEncryptedWriteRequest,
) -> Result<bool, String> {
    let root = storage_root_dir(&app)?;
    let rel = sanitize_relative_path(payload.name.as_str())?;
    let path = root.join(rel);
    let envelope = encrypt_text(payload.text.as_str(), payload.password.as_str())?;
    let content = serde_json::to_string_pretty(&envelope).map_err(|err| err.to_string())?;
    write_text_file(path, content.as_str())?;
    Ok(true)
}

#[tauri::command]
fn db_todos_get(app: AppHandle, payload: DbAuthRequest) -> Result<serde_json::Value, String> {
    let db = load_db_value(&app, payload.password.as_str())?;
    let todos = db.get("todos").cloned().unwrap_or_else(|| json!([]));
    if todos.is_array() {
        Ok(todos)
    } else {
        Ok(json!([]))
    }
}

#[tauri::command]
fn db_dashboard_get(app: AppHandle, payload: DbAuthRequest) -> Result<serde_json::Value, String> {
    let db = load_db_value(&app, payload.password.as_str())?;
    let columns = db
        .get("kanban")
        .and_then(|v| v.get("columns"))
        .cloned()
        .unwrap_or_else(|| json!([]));
    let cards = db
        .get("kanban")
        .and_then(|v| v.get("cards"))
        .cloned()
        .unwrap_or_else(|| json!([]));
    let todos = db.get("todos").cloned().unwrap_or_else(|| json!([]));

    Ok(json!({
        "kanban": {
            "columns": if columns.is_array() { columns } else { json!([]) },
            "cards": if cards.is_array() { cards } else { json!([]) },
        },
        "todos": if todos.is_array() { todos } else { json!([]) },
    }))
}

#[tauri::command]
fn db_todos_set(app: AppHandle, payload: DbTodosSetRequest) -> Result<bool, String> {
    let mut db = load_db_value(&app, payload.password.as_str())?;
    let todos = if payload.todos.is_array() {
        payload.todos
    } else {
        json!([])
    };
    db["todos"] = todos;
    save_db_value(&app, payload.password.as_str(), &db)?;
    Ok(true)
}

#[tauri::command]
fn db_weekly_get(app: AppHandle, payload: DbWeeklyGetRequest) -> Result<serde_json::Value, String> {
    let mut db = load_db_value(&app, payload.password.as_str())?;
    let week_start = payload.week_start.trim().to_string();
    let week_end = payload.week_end.trim().to_string();
    if week_start.is_empty() {
        return Err("Missing week_start.".to_string());
    }
    let mut changed = false;

    if !db.get("weekly").is_some_and(|v| v.is_object()) {
        db["weekly"] = json!({});
        changed = true;
    }

    let weekly = db
        .get_mut("weekly")
        .and_then(|value| value.as_object_mut())
        .ok_or_else(|| "Invalid weekly store.".to_string())?;

    let entry = weekly.entry(week_start.clone()).or_insert_with(|| {
        changed = true;
        json!({
            "week_start": week_start.clone(),
            "week_end": week_end.clone(),
            "entries": {},
        })
    });

    if !entry.is_object() {
        *entry = json!({
            "week_start": payload.week_start,
            "week_end": payload.week_end,
            "entries": {},
        });
        changed = true;
    }

    if let Some(entry_obj) = entry.as_object_mut() {
        if !entry_obj.get("week_start").is_some_and(|v| v.is_string()) {
            entry_obj.insert("week_start".to_string(), json!(payload.week_start));
            changed = true;
        }
        if !entry_obj.get("week_end").is_some_and(|v| v.is_string()) {
            entry_obj.insert("week_end".to_string(), json!(payload.week_end));
            changed = true;
        }
        if !entry_obj.get("entries").is_some_and(|v| v.is_object()) {
            entry_obj.insert("entries".to_string(), json!({}));
            changed = true;
        }
    }

    let out = entry.clone();
    if changed {
        save_db_value(&app, payload.password.as_str(), &db)?;
    }
    Ok(out)
}

#[tauri::command]
fn db_weekly_set(app: AppHandle, payload: DbWeeklySetRequest) -> Result<bool, String> {
    let mut db = load_db_value(&app, payload.password.as_str())?;
    let week_start = payload.week_start.trim();
    if week_start.is_empty() {
        return Err("Missing week_start.".to_string());
    }
    if !db.get("weekly").is_some_and(|v| v.is_object()) {
        db["weekly"] = json!({});
    }
    let weekly = db
        .get_mut("weekly")
        .and_then(|value| value.as_object_mut())
        .ok_or_else(|| "Invalid weekly store.".to_string())?;
    let entries = if payload.entries.is_object() {
        payload.entries
    } else {
        json!({})
    };
    weekly.insert(
        payload.week_start.clone(),
        json!({
            "week_start": payload.week_start,
            "week_end": payload.week_end,
            "entries": entries,
        }),
    );
    save_db_value(&app, payload.password.as_str(), &db)?;
    Ok(true)
}

#[tauri::command]
fn db_weekly_summary(
    app: AppHandle,
    payload: DbWeeklyGetRequest,
) -> Result<serde_json::Value, String> {
    let db = load_db_value(&app, payload.password.as_str())?;
    let week_start = clamp_string(payload.week_start.as_str(), 40, true);
    let week_end = clamp_string(payload.week_end.as_str(), 40, true);
    if week_start.is_empty() {
        return Err("Missing week_start.".to_string());
    }

    let data = db
        .get("weekly")
        .and_then(|value| value.get(week_start.as_str()))
        .cloned()
        .unwrap_or_else(|| {
            json!({
                "week_start": week_start.clone(),
                "week_end": week_end.clone(),
                "entries": {},
            })
        });
    let content = build_weekly_summary_markdown(&data);
    Ok(json!({
        "filename": format!("Weekly_{week_start}_Summary.md"),
        "content": content,
    }))
}

#[tauri::command]
fn db_weekly_summary_save(
    app: AppHandle,
    payload: DbWeeklyGetRequest,
) -> Result<SaveCsvResult, String> {
    let summary = db_weekly_summary(app, payload)?;
    let filename = clamp_string(
        value_ref_string(summary.get("filename")).as_str(),
        255,
        true,
    );
    let content = value_ref_string(summary.get("content"));
    save_csv_file(SaveCsvRequest {
        filename: if filename.is_empty() {
            "weekly_summary.md".to_string()
        } else {
            filename
        },
        content,
    })
}

#[tauri::command]
fn email_templates_get(app: AppHandle) -> Result<serde_json::Value, String> {
    let root = storage_root_dir(&app)?;
    let path = root.join(EMAIL_TEMPLATES_FILE);
    if !path.exists() {
        return Ok(json!({}));
    }
    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    match serde_json::from_str::<serde_json::Value>(raw.as_str()) {
        Ok(value) => Ok(value),
        Err(_) => Ok(json!({})),
    }
}

#[tauri::command]
fn email_templates_set(app: AppHandle, payload: EmailTemplatesSetRequest) -> Result<bool, String> {
    let root = storage_root_dir(&app)?;
    let path = root.join(EMAIL_TEMPLATES_FILE);
    let value = if payload.value.is_object() {
        payload.value
    } else {
        json!({})
    };
    let content = serde_json::to_string_pretty(&value).map_err(|err| err.to_string())?;
    write_text_file(path, content.as_str())?;
    Ok(true)
}

#[tauri::command]
fn db_list_tables(app: AppHandle, payload: DbAuthRequest) -> Result<Vec<DbTableInfo>, String> {
    let db = load_db_value(&app, payload.password.as_str())?;
    let mut out = Vec::new();
    for table_id in DB_TABLE_ORDER {
        out.push(DbTableInfo {
            id: table_id.to_string(),
            name: table_display_name(table_id).to_string(),
            count: db_table_count(&db, table_id),
        });
    }
    Ok(out)
}

#[tauri::command]
fn db_get_table(app: AppHandle, payload: DbGetTableRequest) -> Result<DbTableResult, String> {
    let db = load_db_value(&app, payload.password.as_str())?;
    let table_id = payload.table_id.trim();
    Ok(build_db_table(&db, table_id))
}

#[tauri::command]
fn db_sources_get(app: AppHandle, payload: DbAuthRequest) -> Result<serde_json::Value, String> {
    if payload.password.trim().is_empty() {
        return Err("Password is required.".to_string());
    }
    let meta = load_meta_value(&app)?;
    let sources = list_db_sources(&meta);
    let active = resolve_active_source_id(&meta, &sources);
    Ok(json!({
        "sources": sources,
        "activeId": active,
    }))
}

#[tauri::command]
fn db_set_source(app: AppHandle, payload: DbSourceSetRequest) -> Result<serde_json::Value, String> {
    if payload.password.trim().is_empty() {
        return Err("Password is required.".to_string());
    }
    let mut meta = load_meta_value(&app)?;
    let sources = list_db_sources(&meta);
    let requested = clamp_string(payload.source_id.as_str(), 128, true);
    let has_requested = sources
        .iter()
        .any(|entry| value_ref_string(entry.get("id")) == requested);
    let next_id = if has_requested {
        requested
    } else {
        "current".to_string()
    };
    if let Some(meta_obj) = meta.as_object_mut() {
        meta_obj.insert("active_db".to_string(), json!(next_id.clone()));
    }
    write_meta_value(&app, &meta)?;
    Ok(json!({ "ok": true, "activeId": next_id }))
}

#[tauri::command]
fn db_list_tables_source(
    app: AppHandle,
    payload: DbSourceTableListRequest,
) -> Result<Vec<DbTableInfo>, String> {
    let source_id = clamp_string(payload.source_id.as_str(), 128, true);
    let db = load_db_by_source_value(&app, source_id.as_str(), payload.password.as_str())?;
    let Some(db) = db else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for table_id in DB_TABLE_ORDER {
        out.push(DbTableInfo {
            id: table_id.to_string(),
            name: table_display_name(table_id).to_string(),
            count: db_table_count(&db, table_id),
        });
    }
    Ok(out)
}

#[tauri::command]
fn db_get_table_source(
    app: AppHandle,
    payload: DbSourceTableRequest,
) -> Result<DbTableResult, String> {
    let source_id = clamp_string(payload.source_id.as_str(), 128, true);
    let db = load_db_by_source_value(&app, source_id.as_str(), payload.password.as_str())?;
    let table_id = payload.table_id.trim();
    let Some(db) = db else {
        return Ok(DbTableResult {
            id: table_id.to_string(),
            name: "Unknown".to_string(),
            columns: Vec::new(),
            rows: Vec::new(),
        });
    };
    Ok(build_db_table(&db, table_id))
}

#[tauri::command]
fn db_import_apply(
    app: AppHandle,
    payload: DbImportApplyRequest,
) -> Result<serde_json::Value, String> {
    let action = clamp_string(payload.action.as_str(), 20, true).to_lowercase();
    if action != "append" && action != "view" && action != "replace" {
        return Ok(json!({
            "ok": false,
            "code": "broken",
            "error": "Invalid import action.",
        }));
    }

    let password = clamp_string(payload.password.as_str(), 256, false);
    if !verify_auth_password(&app, password.as_str())? {
        return Ok(json!({
            "ok": false,
            "code": "password",
            "error": "Invalid password.",
        }));
    }

    let encrypted_json: serde_json::Value = match serde_json::from_str(payload.file_data.as_str()) {
        Ok(value) => value,
        Err(_) => {
            return Ok(json!({
                "ok": false,
                "code": "broken",
                "error": "Import file is not valid JSON.",
            }));
        }
    };
    let encrypted: CryptoEnvelope = match serde_json::from_value(encrypted_json) {
        Ok(value) => value,
        Err(_) => {
            return Ok(json!({
                "ok": false,
                "code": "broken",
                "error": "Unable to decrypt the import file.",
            }));
        }
    };
    let decrypted = match decrypt_envelope(&encrypted, password.as_str())? {
        Some(value) => value,
        None => {
            return Ok(json!({
                "ok": false,
                "code": "broken",
                "error": "Unable to decrypt the import file.",
            }));
        }
    };
    let imported_json: serde_json::Value = match serde_json::from_str(decrypted.as_str()) {
        Ok(value) => value,
        Err(_) => {
            return Ok(json!({
                "ok": false,
                "code": "broken",
                "error": "Unable to decrypt the import file.",
            }));
        }
    };
    let migrated = ensure_db_shape_value(imported_json);
    if let Some((code, message)) = validate_db_basic(&migrated) {
        return Ok(json!({
            "ok": false,
            "code": code,
            "error": message,
        }));
    }

    let mut view_entry: Option<serde_json::Value> = None;
    if action == "append" {
        let mut db = load_db_value(&app, password.as_str())?;
        merge_databases(&mut db, &migrated);
        save_db_value(&app, password.as_str(), &db)?;
        view_entry = Some(store_imported_database(
            &app,
            &migrated,
            payload.file_name.as_deref().unwrap_or(""),
            password.as_str(),
        )?);
    } else if action == "replace" {
        save_db_value(&app, password.as_str(), &migrated)?;
    } else if action == "view" {
        view_entry = Some(store_imported_database(
            &app,
            &migrated,
            payload.file_name.as_deref().unwrap_or(""),
            password.as_str(),
        )?);
    }

    let view_id = view_entry
        .as_ref()
        .map(|entry| value_ref_string(entry.get("id")))
        .filter(|id| !id.is_empty());
    let view_name = view_entry
        .as_ref()
        .map(|entry| value_ref_string(entry.get("name")))
        .filter(|name| !name.is_empty());

    Ok(json!({
        "ok": true,
        "action": action,
        "viewId": view_id,
        "viewName": view_name,
    }))
}

#[tauri::command]
fn db_kanban_get(app: AppHandle, payload: DbAuthRequest) -> Result<serde_json::Value, String> {
    let db = load_db_value(&app, payload.password.as_str())?;
    let columns = db
        .get("kanban")
        .and_then(|v| v.get("columns"))
        .cloned()
        .unwrap_or_else(|| json!([]));
    let cards = db
        .get("kanban")
        .and_then(|v| v.get("cards"))
        .cloned()
        .unwrap_or_else(|| json!([]));
    let columns = if columns.is_array() {
        columns
    } else {
        json!([])
    };
    let cards = if cards.is_array() { cards } else { json!([]) };
    Ok(json!({ "columns": columns, "cards": cards }))
}

#[tauri::command]
fn db_kanban_add_column(
    app: AppHandle,
    payload: DbKanbanAddColumnRequest,
) -> Result<serde_json::Value, String> {
    let mut db = load_db_value(&app, payload.password.as_str())?;
    let name = clamp_string(payload.name.as_str(), 60, true);
    let columns_now = db
        .get("kanban")
        .and_then(|v| v.get("columns"))
        .cloned()
        .unwrap_or_else(|| json!([]));
    if name.is_empty() {
        return Ok(json!({
            "ok": false,
            "error": "Column name is required.",
            "columns": if columns_now.is_array() { columns_now } else { json!([]) }
        }));
    }

    let now = now_string();
    let mut out_columns = json!([]);
    {
        let columns = db_kanban_columns_mut(&mut db)?;
        let mut max_order = 0_i64;
        for col in columns.iter() {
            max_order = max_order.max(value_i64(col.get("order")));
        }
        columns.push(json!({
            "id": new_id(),
            "name": name,
            "order": max_order + 1,
            "created_at": now,
        }));
        out_columns = json!(columns);
    }
    save_db_value(&app, payload.password.as_str(), &db)?;
    Ok(json!({ "ok": true, "columns": out_columns }))
}

#[tauri::command]
fn db_kanban_remove_column(
    app: AppHandle,
    payload: DbKanbanColumnRequest,
) -> Result<serde_json::Value, String> {
    let mut db = load_db_value(&app, payload.password.as_str())?;
    let column_id = clamp_string(payload.column_id.as_str(), 128, true);
    if column_id.is_empty() {
        return Ok(json!({
            "ok": true,
            "columns": db.get("kanban").and_then(|v| v.get("columns")).cloned().unwrap_or_else(|| json!([])),
            "cards": db.get("kanban").and_then(|v| v.get("cards")).cloned().unwrap_or_else(|| json!([])),
        }));
    }
    let result = remove_kanban_columns(&mut db, &HashSet::from([column_id]), true);
    if result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        save_db_value(&app, payload.password.as_str(), &db)?;
    }
    Ok(result)
}

#[tauri::command]
fn db_kanban_add_card(
    app: AppHandle,
    payload: DbKanbanAddCardRequest,
) -> Result<serde_json::Value, String> {
    let mut db = load_db_value(&app, payload.password.as_str())?;
    let card_payload = payload.payload;
    let column_id = clamp_string(
        value_ref_string(card_payload.get("column_id")).as_str(),
        128,
        true,
    );

    let columns = db_kanban_columns_mut(&mut db)?;
    let valid_column = columns
        .iter()
        .any(|col| value_ref_string(col.get("id")) == column_id);
    if !valid_column {
        return Ok(json!({ "ok": false, "error": "Invalid column." }));
    }

    let cards = db_kanban_cards_mut(&mut db)?;
    let mut max_order = 0_i64;
    for card in cards.iter() {
        if value_ref_string(card.get("column_id")) == column_id {
            max_order = max_order.max(value_i64(card.get("order")));
        }
    }
    let now = now_string();
    let uuid = new_id();
    let card = json!({
        "uuid": uuid,
        "column_id": column_id,
        "order": max_order + 1,
        "candidate_name": clamp_string(value_ref_string(card_payload.get("candidate_name")).as_str(), 120, false),
        "icims_id": clamp_string(value_ref_string(card_payload.get("icims_id")).as_str(), 64, false),
        "employee_id": clamp_string(value_ref_string(card_payload.get("employee_id")).as_str(), 64, false),
        "job_id": clamp_string(value_ref_string(card_payload.get("job_id")).as_str(), 64, false),
        "req_id": clamp_string(value_ref_string(card_payload.get("req_id")).as_str(), 64, false),
        "job_name": clamp_string(value_ref_string(card_payload.get("job_name")).as_str(), 120, false),
        "job_location": clamp_string(value_ref_string(card_payload.get("job_location")).as_str(), 120, false),
        "manager": clamp_string(value_ref_string(card_payload.get("manager")).as_str(), 80, false),
        "branch": clamp_string(value_ref_string(card_payload.get("branch")).as_str(), 80, false),
        "created_at": now,
        "updated_at": now,
    });
    cards.push(card.clone());

    let candidates = db_kanban_candidates_mut(&mut db)?;
    let mut row = default_candidate_row();
    row.insert(
        "Candidate Name".to_string(),
        json!(value_ref_string(card.get("candidate_name"))),
    );
    row.insert(
        "ICIMS ID".to_string(),
        json!(value_ref_string(card.get("icims_id"))),
    );
    row.insert(
        "Employee ID".to_string(),
        json!(value_ref_string(card.get("employee_id"))),
    );
    row.insert(
        "REQ ID".to_string(),
        json!(value_ref_string(card.get("req_id"))),
    );
    row.insert(
        "Contact Phone".to_string(),
        json!(clamp_string(
            value_ref_string(card_payload.get("contact_phone")).as_str(),
            32,
            false
        )),
    );
    row.insert(
        "Contact Email".to_string(),
        json!(clamp_string(
            value_ref_string(card_payload.get("contact_email")).as_str(),
            120,
            false
        )),
    );
    row.insert(
        "Job ID Name".to_string(),
        json!(job_id_name(
            value_ref_string(card.get("job_id")).as_str(),
            value_ref_string(card.get("job_name")).as_str()
        )),
    );
    row.insert(
        "Job Location".to_string(),
        json!(value_ref_string(card.get("job_location"))),
    );
    row.insert(
        "Manager".to_string(),
        json!(value_ref_string(card.get("manager"))),
    );
    row.insert(
        "Branch".to_string(),
        json!(value_ref_string(card.get("branch"))),
    );
    row.insert(
        "candidate UUID".to_string(),
        json!(value_ref_string(card.get("uuid"))),
    );
    candidates.push(serde_json::Value::Object(row));

    save_db_value(&app, payload.password.as_str(), &db)?;
    Ok(json!({ "ok": true, "card": card }))
}

#[tauri::command]
fn db_kanban_update_card(
    app: AppHandle,
    payload: DbKanbanUpdateCardRequest,
) -> Result<serde_json::Value, String> {
    let mut db = load_db_value(&app, payload.password.as_str())?;
    let card_id = clamp_string(payload.id.as_str(), 128, true);
    if card_id.is_empty() {
        return Ok(json!({
            "cards": db.get("kanban").and_then(|v| v.get("cards")).cloned().unwrap_or_else(|| json!([])),
        }));
    }
    let valid_columns: HashSet<String> = db_kanban_columns_mut(&mut db)?
        .iter()
        .map(|col| value_ref_string(col.get("id")))
        .collect();
    let update_payload = payload.payload;
    let now = now_string();

    let mut updated_card: Option<serde_json::Value> = None;
    {
        let cards = db_kanban_cards_mut(&mut db)?;
        if let Some(card) = cards
            .iter_mut()
            .find(|card| value_ref_string(card.get("uuid")) == card_id)
        {
            if let Some(card_obj) = card.as_object_mut() {
                apply_card_updates(card_obj, &update_payload, &valid_columns);
                card_obj.insert("updated_at".to_string(), json!(now));
                updated_card = Some(serde_json::Value::Object(card_obj.clone()));
            }
        }
    }
    if updated_card.is_none() {
        return Ok(json!({
            "cards": db.get("kanban").and_then(|v| v.get("cards")).cloned().unwrap_or_else(|| json!([])),
        }));
    }

    if let Some(updated) = &updated_card {
        let row = ensure_candidate_row(&mut db, card_id.as_str())?;
        if let Some(row_obj) = row.as_object_mut() {
            row_obj.insert(
                "Candidate Name".to_string(),
                json!(value_ref_string(updated.get("candidate_name"))),
            );
            row_obj.insert(
                "ICIMS ID".to_string(),
                json!(value_ref_string(updated.get("icims_id"))),
            );
            row_obj.insert(
                "Employee ID".to_string(),
                json!(value_ref_string(updated.get("employee_id"))),
            );
            row_obj.insert(
                "REQ ID".to_string(),
                json!(value_ref_string(updated.get("req_id"))),
            );
            if has_key(&update_payload, "contact_phone") {
                row_obj.insert(
                    "Contact Phone".to_string(),
                    json!(clamp_string(
                        value_ref_string(update_payload.get("contact_phone")).as_str(),
                        32,
                        false
                    )),
                );
            }
            if has_key(&update_payload, "contact_email") {
                row_obj.insert(
                    "Contact Email".to_string(),
                    json!(clamp_string(
                        value_ref_string(update_payload.get("contact_email")).as_str(),
                        120,
                        false
                    )),
                );
            }
            row_obj.insert(
                "Job ID Name".to_string(),
                json!(job_id_name(
                    value_ref_string(updated.get("job_id")).as_str(),
                    value_ref_string(updated.get("job_name")).as_str()
                )),
            );
            row_obj.insert(
                "Job Location".to_string(),
                json!(value_ref_string(updated.get("job_location"))),
            );
            row_obj.insert(
                "Manager".to_string(),
                json!(value_ref_string(updated.get("manager"))),
            );
            row_obj.insert(
                "Branch".to_string(),
                json!(value_ref_string(updated.get("branch"))),
            );
        }
    }

    save_db_value(&app, payload.password.as_str(), &db)?;
    Ok(json!({
        "cards": db.get("kanban").and_then(|v| v.get("cards")).cloned().unwrap_or_else(|| json!([])),
    }))
}

#[tauri::command]
fn db_pii_get(app: AppHandle, payload: DbPiiRequest) -> Result<serde_json::Value, String> {
    let mut db = load_db_value(&app, payload.password.as_str())?;
    let candidate_id = clamp_string(payload.candidate_id.as_str(), 128, true);
    if candidate_id.is_empty() {
        return Ok(json!({ "row": {}, "candidateName": "" }));
    }
    let card = db_kanban_cards_mut(&mut db)?
        .iter()
        .find(|card| value_ref_string(card.get("uuid")) == candidate_id)
        .cloned();
    let row = ensure_candidate_row(&mut db, candidate_id.as_str())?;
    if let Some(row_obj) = row.as_object_mut() {
        if let Some(card) = &card {
            if let Some(name) = card.get("candidate_name") {
                if !value_ref_string(Some(name)).is_empty() {
                    row_obj.insert("Candidate Name".to_string(), name.clone());
                }
            }
            if let Some(req) = card.get("req_id") {
                if !value_ref_string(Some(req)).is_empty() {
                    row_obj.insert("REQ ID".to_string(), req.clone());
                }
            }
        }
    }
    let row_out = row.clone();
    save_db_value(&app, payload.password.as_str(), &db)?;
    let mut candidate_name = value_ref_string(row_out.get("Candidate Name"));
    if candidate_name.is_empty() {
        candidate_name = card
            .as_ref()
            .map(|c| value_ref_string(c.get("candidate_name")))
            .unwrap_or_default();
    }
    Ok(json!({
        "row": row_out,
        "candidateName": candidate_name,
    }))
}

#[tauri::command]
fn db_pii_save(app: AppHandle, payload: DbPiiSaveRequest) -> Result<bool, String> {
    let mut db = load_db_value(&app, payload.password.as_str())?;
    let candidate_id = clamp_string(payload.candidate_id.as_str(), 128, true);
    if candidate_id.is_empty() {
        return Ok(false);
    }
    let row = ensure_candidate_row(&mut db, candidate_id.as_str())?;
    let Some(row_obj) = row.as_object_mut() else {
        return Ok(false);
    };
    let data = if payload.data.is_object() {
        payload.data
    } else {
        json!({})
    };
    for field in CANDIDATE_FIELDS {
        if field == "Candidate Name" || field == "candidate UUID" {
            continue;
        }
        if !has_key(&data, field) {
            continue;
        }
        let max_len = if field == "Additional Details" || field == "Additional Notes" {
            2000
        } else {
            200
        };
        let value = clamp_string(value_ref_string(data.get(field)).as_str(), max_len, false);
        row_obj.insert(field.to_string(), json!(value));
    }
    save_db_value(&app, payload.password.as_str(), &db)?;
    Ok(true)
}

#[tauri::command]
fn db_kanban_process_candidate(
    app: AppHandle,
    payload: DbKanbanProcessCandidateRequest,
) -> Result<serde_json::Value, String> {
    let mut db = load_db_value(&app, payload.password.as_str())?;
    let candidate_id = clamp_string(payload.candidate_id.as_str(), 128, true);
    if candidate_id.is_empty() {
        return Ok(json!({ "ok": false, "message": "Missing candidate." }));
    }

    let card_index = db_kanban_cards_mut(&mut db)?
        .iter()
        .position(|card| value_ref_string(card.get("uuid")) == candidate_id);
    let Some(card_index) = card_index else {
        return Ok(json!({ "ok": false, "message": "Candidate not found." }));
    };

    let selected_branch = {
        let cards = db_kanban_cards_mut(&mut db)?;
        let existing = cards
            .get(card_index)
            .map(|card| value_ref_string(card.get("branch")))
            .unwrap_or_default();
        let branch = clamp_string(payload.branch.as_str(), 40, true);
        if branch.is_empty() {
            existing
        } else {
            branch
        }
    };
    if selected_branch.is_empty() {
        return Ok(json!({ "ok": false, "message": "Branch is required." }));
    }

    let arrival_minutes = parse_military_time(payload.arrival.as_str()).map(round_to_quarter_hour);
    let departure_minutes =
        parse_military_time(payload.departure.as_str()).map(round_to_quarter_hour);
    let Some(arrival_minutes) = arrival_minutes else {
        return Ok(json!({ "ok": false, "message": "Invalid time format. Use 4-digit 24H time." }));
    };
    let Some(departure_minutes) = departure_minutes else {
        return Ok(json!({ "ok": false, "message": "Invalid time format. Use 4-digit 24H time." }));
    };

    let pre_card = db_kanban_cards_mut(&mut db)?
        .get(card_index)
        .cloned()
        .unwrap_or_else(|| json!({}));
    let pre_row = ensure_candidate_row(&mut db, candidate_id.as_str())?.clone();

    let arrival_text = format_military_time(arrival_minutes);
    let departure_text = format_military_time(departure_minutes);
    let mut total_minutes = departure_minutes - arrival_minutes;
    if total_minutes < 0 {
        total_minutes += 24 * 60;
    }
    let total_hours = format_total_hours(total_minutes);
    let mut uniform_adjustments: Vec<serde_json::Value> = Vec::new();
    let mut shirt_deduction_plan: Option<(String, i64, Vec<String>)> = None;
    let mut pants_deduction_plan: Option<(String, i64, String)> = None;

    {
        let cards = db_kanban_cards_mut(&mut db)?;
        if let Some(card) = cards.get_mut(card_index).and_then(|v| v.as_object_mut()) {
            card.insert("branch".to_string(), json!(selected_branch.clone()));
            card.insert("updated_at".to_string(), json!(now_string()));
        }
    }

    {
        let row = ensure_candidate_row(&mut db, candidate_id.as_str())?;
        if let Some(row_obj) = row.as_object_mut() {
            if let Some(card) = pre_card.as_object() {
                row_obj.insert(
                    "Candidate Name".to_string(),
                    json!(value_ref_string(card.get("candidate_name"))),
                );
                row_obj.insert(
                    "ICIMS ID".to_string(),
                    json!(value_ref_string(card.get("icims_id"))),
                );
                row_obj.insert(
                    "Employee ID".to_string(),
                    json!(value_ref_string(card.get("employee_id"))),
                );
                row_obj.insert(
                    "REQ ID".to_string(),
                    json!(value_ref_string(card.get("req_id"))),
                );
                row_obj.insert(
                    "Job ID Name".to_string(),
                    json!(job_id_name(
                        value_ref_string(card.get("job_id")).as_str(),
                        value_ref_string(card.get("job_name")).as_str()
                    )),
                );
                row_obj.insert(
                    "Job Location".to_string(),
                    json!(value_ref_string(card.get("job_location"))),
                );
                row_obj.insert(
                    "Manager".to_string(),
                    json!(value_ref_string(card.get("manager"))),
                );
            }
            row_obj.insert("Branch".to_string(), json!(selected_branch.clone()));
            row_obj.insert("Neo Arrival Time".to_string(), json!(arrival_text));
            row_obj.insert("Neo Departure Time".to_string(), json!(departure_text));
            row_obj.insert("Total Neo Hours".to_string(), json!(total_hours));

            let uniforms_issued =
                value_ref_string(row_obj.get("Uniforms Issued")).eq_ignore_ascii_case("yes");
            if uniforms_issued {
                let issued_shirt_size = clamp_string(
                    value_ref_string(row_obj.get("Issued Shirt Size")).as_str(),
                    40,
                    true,
                );
                let shirt_size = if issued_shirt_size.is_empty() {
                    clamp_string(
                        value_ref_string(row_obj.get("Shirt Size")).as_str(),
                        40,
                        true,
                    )
                } else {
                    issued_shirt_size
                };
                let issued_shirts_given = value_ref_string(row_obj.get("Issued Shirts Given"));
                let shirts_given_value = if issued_shirts_given.is_empty() {
                    value_ref_string(row_obj.get("Shirts Given"))
                } else {
                    issued_shirts_given
                };
                let shirts_given = parse_issued_uniform_quantity(shirts_given_value.as_str());
                let shirt_type_text =
                    if value_ref_string(row_obj.get("Issued Shirt Type")).is_empty() {
                        value_ref_string(row_obj.get("Shirt Type"))
                    } else {
                        value_ref_string(row_obj.get("Issued Shirt Type"))
                    };
                let shirt_alterations = parse_alteration_list(shirt_type_text.as_str());
                if !shirt_size.is_empty() && shirts_given > 0 {
                    shirt_deduction_plan = Some((shirt_size, shirts_given, shirt_alterations));
                }

                let issued_waist = clamp_string(
                    value_ref_string(row_obj.get("Issued Waist")).as_str(),
                    2,
                    true,
                );
                let issued_inseam = clamp_string(
                    value_ref_string(row_obj.get("Issued Inseam")).as_str(),
                    2,
                    true,
                );
                let waist = if issued_waist.is_empty() {
                    clamp_string(value_ref_string(row_obj.get("Waist")).as_str(), 2, true)
                } else {
                    issued_waist
                };
                let inseam = if issued_inseam.is_empty() {
                    clamp_string(value_ref_string(row_obj.get("Inseam")).as_str(), 2, true)
                } else {
                    issued_inseam
                };
                let issued_pants_size = clamp_string(
                    value_ref_string(row_obj.get("Issued Pants Size")).as_str(),
                    40,
                    true,
                );
                let mut pants_size = if issued_pants_size.is_empty() {
                    clamp_string(
                        value_ref_string(row_obj.get("Pants Size")).as_str(),
                        40,
                        true,
                    )
                } else {
                    issued_pants_size
                };
                if pants_size.is_empty() && !waist.is_empty() && !inseam.is_empty() {
                    pants_size = format!("{waist}x{inseam}");
                }
                let issued_pants_given = value_ref_string(row_obj.get("Issued Pants Given"));
                let pants_given_value = if issued_pants_given.is_empty() {
                    value_ref_string(row_obj.get("Pants Given"))
                } else {
                    issued_pants_given
                };
                let pants_given = parse_issued_uniform_quantity(pants_given_value.as_str());
                let issued_pants_type = value_ref_string(row_obj.get("Issued Pants Type"));
                let pants_type_value = if issued_pants_type.is_empty() {
                    value_ref_string(row_obj.get("Pants Type"))
                } else {
                    issued_pants_type
                };
                let pants_alteration = clamp_string(pants_type_value.as_str(), 80, true);
                if !pants_size.is_empty() && pants_given > 0 {
                    pants_deduction_plan = Some((pants_size, pants_given, pants_alteration));
                }
            }

            for field in SENSITIVE_PII_FIELDS {
                row_obj.insert(field.to_string(), json!(""));
            }
        }
    }

    if let Some((shirt_size, shirts_given, shirt_alterations)) = shirt_deduction_plan {
        let deductions = deduct_uniforms_across_alterations(
            &mut db,
            "Shirt",
            shirt_size.as_str(),
            shirts_given,
            selected_branch.as_str(),
            shirt_alterations.as_slice(),
        );
        uniform_adjustments.extend(deductions);
    }
    if let Some((pants_size, pants_given, pants_alteration)) = pants_deduction_plan {
        let deductions = deduct_uniforms_across_alterations(
            &mut db,
            "Pants",
            pants_size.as_str(),
            pants_given,
            selected_branch.as_str(),
            &[pants_alteration],
        );
        uniform_adjustments.extend(deductions);
    }

    {
        let cards = db_kanban_cards_mut(&mut db)?;
        if let Some(card) = cards.get_mut(card_index).and_then(|v| v.as_object_mut()) {
            for field in SENSITIVE_CARD_FIELDS {
                card.insert(field.to_string(), json!(""));
            }
        }
    }

    {
        let cards = db_kanban_cards_mut(&mut db)?;
        cards.retain(|card| value_ref_string(card.get("uuid")) != candidate_id);
    }

    let undo_id = push_recycle_item(
        &mut db,
        json!({
            "type": "kanban_cards",
            "cards": [pre_card],
            "candidates": [pre_row],
            "uniformAdjustments": uniform_adjustments,
        }),
    );

    save_db_value(&app, payload.password.as_str(), &db)?;
    Ok(json!({
        "ok": true,
        "cards": db.get("kanban").and_then(|v| v.get("cards")).cloned().unwrap_or_else(|| json!([])),
        "undoId": undo_id,
    }))
}

#[tauri::command]
fn db_kanban_remove_candidate(
    app: AppHandle,
    payload: DbPiiRequest,
) -> Result<serde_json::Value, String> {
    let mut db = load_db_value(&app, payload.password.as_str())?;
    let candidate_id = clamp_string(payload.candidate_id.as_str(), 128, true);
    if candidate_id.is_empty() {
        return Ok(json!({ "ok": false, "message": "Missing candidate." }));
    }

    let removed_cards: Vec<serde_json::Value> = db_kanban_cards_mut(&mut db)?
        .iter()
        .filter(|card| value_ref_string(card.get("uuid")) == candidate_id)
        .cloned()
        .collect();
    let removed_rows: Vec<serde_json::Value> = db_kanban_candidates_mut(&mut db)?
        .iter()
        .filter(|row| value_ref_string(row.get("candidate UUID")) == candidate_id)
        .cloned()
        .collect();

    db_kanban_cards_mut(&mut db)?.retain(|card| value_ref_string(card.get("uuid")) != candidate_id);
    db_kanban_candidates_mut(&mut db)?
        .retain(|row| value_ref_string(row.get("candidate UUID")) != candidate_id);

    let undo_id = if removed_cards.is_empty() && removed_rows.is_empty() {
        None
    } else {
        push_recycle_item(
            &mut db,
            json!({
                "type": "kanban_cards",
                "cards": removed_cards,
                "candidates": removed_rows,
            }),
        )
    };

    save_db_value(&app, payload.password.as_str(), &db)?;
    Ok(json!({
        "ok": true,
        "columns": db.get("kanban").and_then(|v| v.get("columns")).cloned().unwrap_or_else(|| json!([])),
        "cards": db.get("kanban").and_then(|v| v.get("cards")).cloned().unwrap_or_else(|| json!([])),
        "undoId": undo_id,
    }))
}

#[tauri::command]
fn db_kanban_reorder_column(
    app: AppHandle,
    payload: DbKanbanReorderRequest,
) -> Result<serde_json::Value, String> {
    let mut db = load_db_value(&app, payload.password.as_str())?;
    let column_id = clamp_string(payload.column_id.as_str(), 128, true);
    let ordered_ids: Vec<String> = payload
        .card_ids
        .into_iter()
        .map(|id| clamp_string(id.as_str(), 128, true))
        .filter(|id| !id.is_empty())
        .collect();
    let cards = db_kanban_cards_mut(&mut db)?;

    let mut column_cards: Vec<serde_json::Value> = cards
        .iter()
        .filter(|card| value_ref_string(card.get("column_id")) == column_id)
        .cloned()
        .collect();
    let mut by_id = std::collections::HashMap::new();
    for card in &column_cards {
        by_id.insert(value_ref_string(card.get("uuid")), card.clone());
    }

    let mut ordered = Vec::new();
    let mut seen = HashSet::new();
    for id in ordered_ids {
        if seen.contains(&id) {
            continue;
        }
        if let Some(card) = by_id.get(&id) {
            ordered.push(card.clone());
            seen.insert(id);
        }
    }

    column_cards.sort_by_key(|card| value_i64(card.get("order")));
    for card in column_cards {
        let card_id = value_ref_string(card.get("uuid"));
        if !seen.contains(&card_id) {
            ordered.push(card);
        }
    }

    let now = now_string();
    let mut order_by_id = std::collections::HashMap::new();
    for (idx, card) in ordered.iter().enumerate() {
        order_by_id.insert(value_ref_string(card.get("uuid")), (idx + 1) as i64);
    }

    for card in cards.iter_mut() {
        if value_ref_string(card.get("column_id")) != column_id {
            continue;
        }
        let id = value_ref_string(card.get("uuid"));
        if let Some(next_order) = order_by_id.get(&id).copied() {
            if let Some(card_obj) = card.as_object_mut() {
                card_obj.insert("order".to_string(), json!(next_order));
                card_obj.insert("updated_at".to_string(), json!(now.clone()));
            }
        }
    }

    save_db_value(&app, payload.password.as_str(), &db)?;
    Ok(json!({
        "cards": db.get("kanban").and_then(|v| v.get("cards")).cloned().unwrap_or_else(|| json!([])),
    }))
}

#[tauri::command]
fn db_uniforms_add_item(
    app: AppHandle,
    payload: DbUniformsAddItemRequest,
) -> Result<serde_json::Value, String> {
    let mut db = load_db_value(&app, payload.password.as_str())?;
    let normalized = normalize_uniform_payload(&payload.payload);

    if normalized.alteration.is_empty()
        || normalized.kind.is_empty()
        || normalized.branch.is_empty()
    {
        return Ok(json!({ "ok": false, "error": "Alteration, type, and branch are required." }));
    }
    if normalized.kind == "Shirt" && normalized.size.is_empty() {
        return Ok(json!({ "ok": false, "error": "Shirt size is required for shirt inventory." }));
    }
    if normalized.kind == "Pants" && (normalized.waist.is_empty() || normalized.inseam.is_empty()) {
        return Ok(
            json!({ "ok": false, "error": "Waist and inseam are required for pants inventory." }),
        );
    }
    if normalized.quantity <= 0 {
        return Ok(json!({ "ok": false, "error": "Quantity must be greater than 0." }));
    }

    let row = upsert_uniform_stock(&mut db, &normalized);
    let Some(row) = row else {
        return Ok(json!({ "ok": false, "error": "Unable to add uniform inventory." }));
    };

    save_db_value(&app, payload.password.as_str(), &db)?;
    Ok(json!({ "ok": true, "row": row }))
}

#[tauri::command]
fn db_delete_rows(
    app: AppHandle,
    payload: DbDeleteRowsRequest,
) -> Result<serde_json::Value, String> {
    let mut db = load_db_value(&app, payload.password.as_str())?;
    let table_id = clamp_string(payload.table_id.as_str(), 128, true);
    let ids: HashSet<String> = payload
        .row_ids
        .iter()
        .map(|id| clamp_string(id.as_str(), 128, true))
        .filter(|id| !id.is_empty())
        .collect();
    let mut undo_id = None;

    match table_id.as_str() {
        "kanban_columns" => {
            let result = remove_kanban_columns(&mut db, &ids, true);
            if !result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
                return Ok(result);
            }
            undo_id = nonempty_value(result.get("undoId"));
        }
        "kanban_cards" => {
            let removed_cards: Vec<serde_json::Value> = db_kanban_cards_mut(&mut db)?
                .iter()
                .filter(|card| ids.contains(&value_ref_string(card.get("uuid"))))
                .cloned()
                .collect();
            let removed_rows: Vec<serde_json::Value> = db_kanban_candidates_mut(&mut db)?
                .iter()
                .filter(|row| ids.contains(&value_ref_string(row.get("candidate UUID"))))
                .cloned()
                .collect();
            db_kanban_cards_mut(&mut db)?
                .retain(|card| !ids.contains(&value_ref_string(card.get("uuid"))));
            db_kanban_candidates_mut(&mut db)?
                .retain(|row| !ids.contains(&value_ref_string(row.get("candidate UUID"))));
            if !removed_cards.is_empty() || !removed_rows.is_empty() {
                undo_id = push_recycle_item(
                    &mut db,
                    json!({
                        "type": "kanban_cards",
                        "cards": removed_cards,
                        "candidates": removed_rows,
                    }),
                );
            }
        }
        "candidate_data" => {
            let removed_rows: Vec<serde_json::Value> = db_kanban_candidates_mut(&mut db)?
                .iter()
                .filter(|row| ids.contains(&value_ref_string(row.get("candidate UUID"))))
                .cloned()
                .collect();
            db_kanban_candidates_mut(&mut db)?
                .retain(|row| !ids.contains(&value_ref_string(row.get("candidate UUID"))));
            if !removed_rows.is_empty() {
                undo_id = push_recycle_item(
                    &mut db,
                    json!({
                        "type": "candidate_rows",
                        "candidates": removed_rows,
                    }),
                );
            }
        }
        "weekly_entries" => {
            let mut removed = Vec::new();
            if let Some(weekly) = db.get_mut("weekly").and_then(|v| v.as_object_mut()) {
                for (_week_key, week) in weekly.iter_mut() {
                    let week_start = value_ref_string(week.get("week_start"));
                    let week_end = value_ref_string(week.get("week_end"));
                    if let Some(entries) = week.get_mut("entries").and_then(|v| v.as_object_mut()) {
                        let days: Vec<String> = entries.keys().cloned().collect();
                        for day in days {
                            let row_id = format!("{week_start}-{day}");
                            if !ids.contains(&row_id) {
                                continue;
                            }
                            let payload = entries.remove(day.as_str()).unwrap_or_else(|| json!({}));
                            removed.push(json!({
                                "week_start": week_start,
                                "week_end": week_end,
                                "day": day,
                                "payload": payload,
                            }));
                        }
                    }
                }
            }
            if !removed.is_empty() {
                undo_id = push_recycle_item(
                    &mut db,
                    json!({
                        "type": "weekly_entries",
                        "entries": removed,
                    }),
                );
            }
        }
        "uniform_inventory" => {
            let uniforms = db_uniforms_mut(&mut db)?;
            let removed: Vec<serde_json::Value> = uniforms
                .iter()
                .filter(|entry| ids.contains(&value_ref_string(entry.get("id"))))
                .cloned()
                .collect();
            uniforms.retain(|entry| !ids.contains(&value_ref_string(entry.get("id"))));
            if !removed.is_empty() {
                undo_id = push_recycle_item(
                    &mut db,
                    json!({
                        "type": "uniform_rows",
                        "uniforms": removed,
                    }),
                );
            }
        }
        "todos" => {
            let todos = db_todos_mut(&mut db)?;
            let removed: Vec<serde_json::Value> = todos
                .iter()
                .filter(|todo| ids.contains(&value_ref_string(todo.get("id"))))
                .cloned()
                .collect();
            todos.retain(|todo| !ids.contains(&value_ref_string(todo.get("id"))));
            if !removed.is_empty() {
                undo_id = push_recycle_item(
                    &mut db,
                    json!({
                        "type": "todos",
                        "todos": removed,
                    }),
                );
            }
        }
        _ => {
            return Ok(json!({ "ok": false, "error": "Invalid table." }));
        }
    }

    save_db_value(&app, payload.password.as_str(), &db)?;
    Ok(json!({ "ok": true, "undoId": undo_id }))
}

#[tauri::command]
fn db_validate_current(
    app: AppHandle,
    payload: DbAuthRequest,
) -> Result<serde_json::Value, String> {
    let db = load_db_value(&app, payload.password.as_str())?;
    let issue = validate_db_basic(&db);
    if let Some((code, message)) = issue {
        return Ok(json!({
            "ok": false,
            "code": code,
            "message": message,
        }));
    }
    Ok(json!({ "ok": true }))
}

#[tauri::command]
fn db_recycle_undo(app: AppHandle, payload: DbRecycleRequest) -> Result<serde_json::Value, String> {
    let mut db = load_db_value(&app, payload.password.as_str())?;
    let id = clamp_string(payload.id.as_str(), 128, true);
    if id.is_empty() {
        return Ok(json!({ "ok": false, "error": "Nothing to undo." }));
    }
    let item = pop_recycle_item(&mut db, id.as_str());
    let Some(item) = item else {
        return Ok(json!({ "ok": false, "error": "Nothing to undo." }));
    };
    if !restore_recycle_item(&mut db, &item) {
        return Ok(json!({ "ok": false, "error": "Unable to restore." }));
    }
    let redo_id = push_redo_item(&mut db, item);
    save_db_value(&app, payload.password.as_str(), &db)?;
    Ok(json!({ "ok": true, "redoId": redo_id }))
}

#[tauri::command]
fn db_recycle_redo(app: AppHandle, payload: DbRecycleRequest) -> Result<serde_json::Value, String> {
    let mut db = load_db_value(&app, payload.password.as_str())?;
    let id = clamp_string(payload.id.as_str(), 128, true);
    if id.is_empty() {
        return Ok(json!({ "ok": false, "error": "Nothing to redo." }));
    }
    let item = pop_redo_item(&mut db, id.as_str());
    let Some(item) = item else {
        return Ok(json!({ "ok": false, "error": "Nothing to redo." }));
    };
    if !reapply_recycle_item(&mut db, &item) {
        return Ok(json!({ "ok": false, "error": "Unable to redo." }));
    }
    let undo_id = push_recycle_item(&mut db, item);
    save_db_value(&app, payload.password.as_str(), &db)?;
    Ok(json!({ "ok": true, "undoId": undo_id }))
}

#[tauri::command]
fn auth_read(app: AppHandle) -> Result<Option<AuthRecord>, String> {
    read_auth_record(&app)
}

#[tauri::command]
fn auth_setup(app: AppHandle, payload: AuthSetupRequest) -> Result<AuthRecord, String> {
    let password = payload.password;
    if password.is_empty() {
        return Err("Password is required.".to_string());
    }
    let iterations = payload
        .iterations
        .unwrap_or(DEFAULT_PBKDF2_ITERATIONS)
        .max(1);
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let key = derive_key(password.as_str(), &salt, iterations);
    let record = AuthRecord {
        salt: encode_b64(&salt),
        hash: encode_b64(key.as_slice()),
        iterations,
    };
    write_auth_record(&app, &record)?;
    Ok(record)
}

#[tauri::command]
fn auth_verify(app: AppHandle, payload: AuthVerifyRequest) -> Result<bool, String> {
    let Some(record) = read_auth_record(&app)? else {
        return Ok(false);
    };
    if payload.password.is_empty() {
        return Ok(false);
    }
    let salt = match decode_b64(record.salt.as_str()) {
        Ok(value) => value,
        Err(_) => return Ok(false),
    };
    let key = derive_key(
        payload.password.as_str(),
        salt.as_slice(),
        record.iterations.max(1),
    );
    Ok(encode_b64(key.as_slice()) == record.hash)
}

#[tauri::command]
fn auth_change(app: AppHandle, payload: AuthChangeRequest) -> Result<bool, String> {
    let Some(current_record) = read_auth_record(&app)? else {
        return Ok(false);
    };
    if payload.current.is_empty() || payload.next.is_empty() {
        return Ok(false);
    }
    let salt = match decode_b64(current_record.salt.as_str()) {
        Ok(value) => value,
        Err(_) => return Ok(false),
    };
    let current_key = derive_key(
        payload.current.as_str(),
        salt.as_slice(),
        current_record.iterations.max(1),
    );
    if encode_b64(current_key.as_slice()) != current_record.hash {
        return Ok(false);
    }

    let iterations = payload
        .iterations
        .unwrap_or(current_record.iterations)
        .max(1);
    let mut new_salt = [0u8; 16];
    OsRng.fill_bytes(&mut new_salt);
    let new_key = derive_key(payload.next.as_str(), &new_salt, iterations);
    let next_record = AuthRecord {
        salt: encode_b64(&new_salt),
        hash: encode_b64(new_key.as_slice()),
        iterations,
    };
    write_auth_record(&app, &next_record)?;
    Ok(true)
}

#[tauri::command]
fn crypto_hash_password(payload: CryptoHashPasswordRequest) -> Result<String, String> {
    let iterations = payload
        .iterations
        .unwrap_or(DEFAULT_PBKDF2_ITERATIONS)
        .max(1);
    let salt = decode_b64(payload.salt.as_str())?;
    let key = derive_key(payload.password.as_str(), salt.as_slice(), iterations);
    Ok(encode_b64(key.as_slice()))
}

#[tauri::command]
fn crypto_encrypt_json(payload: CryptoEncryptRequest) -> Result<CryptoEnvelope, String> {
    encrypt_text(payload.text.as_str(), payload.password.as_str())
}

#[tauri::command]
fn crypto_decrypt_json(payload: CryptoDecryptRequest) -> Result<Option<String>, String> {
    let envelope = CryptoEnvelope {
        v: 1,
        salt: payload.salt,
        iv: payload.iv,
        tag: payload.tag,
        data: payload.data,
    };
    decrypt_envelope(&envelope, payload.password.as_str())
}

#[derive(Clone)]
struct UniformPayload {
    alteration: String,
    kind: String,
    size: String,
    waist: String,
    inseam: String,
    quantity: i64,
    branch: String,
}

fn now_string() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    ms.to_string()
}

fn new_id() -> String {
    let mut bytes = [0_u8; 10];
    OsRng.fill_bytes(&mut bytes);
    let mut hex = String::new();
    for b in bytes {
        hex.push_str(format!("{:02x}", b).as_str());
    }
    format!("id-{}-{hex}", now_string())
}

fn nonempty_value(value: Option<&serde_json::Value>) -> Option<String> {
    let text = value_ref_string(value);
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn value_ref_string(value: Option<&serde_json::Value>) -> String {
    nonempty_string(value).unwrap_or_default()
}

fn value_i64(value: Option<&serde_json::Value>) -> i64 {
    match value {
        Some(v) => {
            if let Some(num) = v.as_i64() {
                num
            } else if let Some(num) = v.as_u64() {
                num as i64
            } else if let Some(num) = v.as_f64() {
                num.round() as i64
            } else if let Some(text) = v.as_str() {
                text.trim().parse::<i64>().unwrap_or(0)
            } else {
                0
            }
        }
        None => 0,
    }
}

fn has_key(value: &serde_json::Value, key: &str) -> bool {
    value
        .as_object()
        .map(|obj| obj.contains_key(key))
        .unwrap_or(false)
}

fn clamp_string(value: &str, max_len: usize, trim: bool) -> String {
    let mut out = if trim {
        value.trim().to_string()
    } else {
        value.to_string()
    };
    out = out
        .chars()
        .filter(|ch| {
            let code = *ch as u32;
            code >= 32 && code != 127
        })
        .collect();
    if out.chars().count() > max_len {
        out = out.chars().take(max_len).collect();
    }
    out
}

fn parse_military_time(value: &str) -> Option<i64> {
    let digits: String = value.chars().filter(|ch| ch.is_ascii_digit()).collect();
    if digits.len() != 4 {
        return None;
    }
    let hours = digits[0..2].parse::<i64>().ok()?;
    let minutes = digits[2..4].parse::<i64>().ok()?;
    if !(0..=23).contains(&hours) || !(0..=59).contains(&minutes) {
        return None;
    }
    Some(hours * 60 + minutes)
}

fn round_to_quarter_hour(minutes: i64) -> i64 {
    let rounded = ((minutes as f64) / 15.0).round() as i64 * 15;
    rounded.clamp(0, 23 * 60 + 45)
}

fn format_military_time(minutes: i64) -> String {
    let h = minutes.div_euclid(60);
    let m = minutes.rem_euclid(60);
    format!("{h:02}:{m:02}")
}

fn format_total_hours(minutes: i64) -> String {
    format!("{:.2}", minutes as f64 / 60.0)
}

const WEEKLY_SUMMARY_DAYS: [&str; 7] = [
    "Friday",
    "Saturday",
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
];

fn detect_weekly_meridiem(raw: &str) -> Option<char> {
    let compact: String = raw
        .chars()
        .filter(|ch| !ch.is_whitespace() && *ch != '.')
        .collect();
    if compact.contains("am") || compact.ends_with('a') {
        Some('a')
    } else if compact.contains("pm") || compact.ends_with('p') {
        Some('p')
    } else {
        None
    }
}

fn parse_weekly_time(value: &str) -> Option<i64> {
    let raw = value.trim().to_lowercase();
    if raw.is_empty() {
        return None;
    }
    let meridiem = detect_weekly_meridiem(raw.as_str());
    let cleaned: String = raw
        .chars()
        .filter(|ch| ch.is_ascii_digit() || *ch == ':')
        .collect();
    if cleaned.is_empty() {
        return None;
    }

    let (mut hours, minutes) = if cleaned.contains(':') {
        let parts: Vec<&str> = cleaned.split(':').collect();
        if parts.len() != 2 {
            return None;
        }
        let h = parts[0].parse::<i64>().ok()?;
        let m = parts[1].parse::<i64>().ok()?;
        (h, m)
    } else {
        let digits = cleaned.as_str();
        match digits.len() {
            1 | 2 => (digits.parse::<i64>().ok()?, 0),
            3 => (
                digits[0..1].parse::<i64>().ok()?,
                digits[1..3].parse::<i64>().ok()?,
            ),
            4 => (
                digits[0..2].parse::<i64>().ok()?,
                digits[2..4].parse::<i64>().ok()?,
            ),
            _ => return None,
        }
    };
    if !(0..=59).contains(&minutes) {
        return None;
    }

    if let Some(mark) = meridiem {
        if !(1..=12).contains(&hours) {
            return None;
        }
        if mark == 'a' {
            if hours == 12 {
                hours = 0;
            }
        } else if mark == 'p' && hours != 12 {
            hours += 12;
        }
    } else if !(0..=23).contains(&hours) {
        return None;
    }
    Some(hours * 60 + minutes)
}

fn format_hours(minutes: Option<i64>) -> String {
    match minutes {
        Some(value) => format!("{:.2}", value as f64 / 60.0),
        None => "—".to_string(),
    }
}

fn build_weekly_summary_markdown(week: &serde_json::Value) -> String {
    struct DayBlock {
        day: &'static str,
        start: String,
        end: String,
        total: String,
        activities: Vec<String>,
    }

    let week_start = clamp_string(value_ref_string(week.get("week_start")).as_str(), 40, true);
    let week_end = clamp_string(value_ref_string(week.get("week_end")).as_str(), 40, true);
    let entries = week
        .get("entries")
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();

    let mut total_minutes = 0_i64;
    let mut has_totals = false;
    let mut day_blocks: Vec<DayBlock> = Vec::new();

    for day in WEEKLY_SUMMARY_DAYS {
        let entry = entries.get(day).cloned().unwrap_or_else(|| json!({}));
        let start_text = clamp_string(value_ref_string(entry.get("start")).as_str(), 40, true);
        let end_text = clamp_string(value_ref_string(entry.get("end")).as_str(), 40, true);
        let start_minutes = parse_weekly_time(start_text.as_str());
        let end_minutes = parse_weekly_time(end_text.as_str());
        let mut day_minutes = None;
        if let (Some(start), Some(end)) = (start_minutes, end_minutes) {
            let mut diff = end - start;
            if diff < 0 {
                diff += 24 * 60;
            }
            day_minutes = Some(diff);
            total_minutes += diff;
            has_totals = true;
        }

        let content = value_ref_string(entry.get("content"));
        let mut activities: Vec<String> = content
            .lines()
            .map(|line| line.trim())
            .filter(|line| !line.is_empty())
            .map(|line| format!("- {line}"))
            .collect();
        if activities.is_empty() {
            activities.push("_No activities entered._".to_string());
        }

        day_blocks.push(DayBlock {
            day,
            start: if start_text.is_empty() {
                "—".to_string()
            } else {
                start_text
            },
            end: if end_text.is_empty() {
                "—".to_string()
            } else {
                end_text
            },
            total: format_hours(day_minutes),
            activities,
        });
    }

    let mut lines: Vec<String> = Vec::new();
    lines.push("# Weekly Summary".to_string());
    lines.push(String::new());
    lines.push(
        format!("Week of {week_start} to {week_end}")
            .trim()
            .to_string(),
    );
    lines.push(String::new());
    lines.push(format!("Generated {}", now_string()));
    lines.push(String::new());
    if has_totals {
        lines.push(format!("Total Hours: {:.2}", total_minutes as f64 / 60.0));
        lines.push(String::new());
    }
    for block in day_blocks {
        lines.push(format!("## {}", block.day));
        lines.push(String::new());
        lines.push(format!("Start: {}", block.start));
        lines.push(format!("End: {}", block.end));
        lines.push(format!("Total: {}", block.total));
        lines.push(String::new());
        lines.push("Activities:".to_string());
        lines.extend(block.activities);
        lines.push(String::new());
    }
    lines.join("\n")
}

fn job_id_name(job_id: &str, job_name: &str) -> String {
    [job_id.trim(), job_name.trim()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn db_kanban_mut(
    db: &mut serde_json::Value,
) -> Result<&mut serde_json::Map<String, serde_json::Value>, String> {
    db.get_mut("kanban")
        .and_then(|v| v.as_object_mut())
        .ok_or_else(|| "Invalid kanban store.".to_string())
}

fn db_kanban_columns_mut(
    db: &mut serde_json::Value,
) -> Result<&mut Vec<serde_json::Value>, String> {
    db_kanban_mut(db)?
        .get_mut("columns")
        .and_then(|v| v.as_array_mut())
        .ok_or_else(|| "Invalid kanban columns.".to_string())
}

fn db_kanban_cards_mut(db: &mut serde_json::Value) -> Result<&mut Vec<serde_json::Value>, String> {
    db_kanban_mut(db)?
        .get_mut("cards")
        .and_then(|v| v.as_array_mut())
        .ok_or_else(|| "Invalid kanban cards.".to_string())
}

fn db_kanban_candidates_mut(
    db: &mut serde_json::Value,
) -> Result<&mut Vec<serde_json::Value>, String> {
    db_kanban_mut(db)?
        .get_mut("candidates")
        .and_then(|v| v.as_array_mut())
        .ok_or_else(|| "Invalid kanban candidates.".to_string())
}

fn db_uniforms_mut(db: &mut serde_json::Value) -> Result<&mut Vec<serde_json::Value>, String> {
    db.get_mut("uniforms")
        .and_then(|v| v.as_array_mut())
        .ok_or_else(|| "Invalid uniform inventory.".to_string())
}

fn db_todos_mut(db: &mut serde_json::Value) -> Result<&mut Vec<serde_json::Value>, String> {
    db.get_mut("todos")
        .and_then(|v| v.as_array_mut())
        .ok_or_else(|| "Invalid todos store.".to_string())
}

fn db_recycle_items_mut(db: &mut serde_json::Value) -> Result<&mut Vec<serde_json::Value>, String> {
    db.get_mut("recycle")
        .and_then(|v| v.as_object_mut())
        .and_then(|recycle| recycle.get_mut("items"))
        .and_then(|v| v.as_array_mut())
        .ok_or_else(|| "Invalid recycle items.".to_string())
}

fn db_redo_items_mut(db: &mut serde_json::Value) -> Result<&mut Vec<serde_json::Value>, String> {
    db.get_mut("recycle")
        .and_then(|v| v.as_object_mut())
        .and_then(|recycle| recycle.get_mut("redo"))
        .and_then(|v| v.as_array_mut())
        .ok_or_else(|| "Invalid recycle redo items.".to_string())
}

fn default_candidate_row() -> serde_json::Map<String, serde_json::Value> {
    let mut row = serde_json::Map::new();
    for field in CANDIDATE_FIELDS {
        row.insert(field.to_string(), json!(""));
    }
    row
}

fn ensure_candidate_row<'a>(
    db: &'a mut serde_json::Value,
    candidate_id: &str,
) -> Result<&'a mut serde_json::Value, String> {
    let card = db_kanban_cards_mut(db)?
        .iter()
        .find(|card| value_ref_string(card.get("uuid")) == candidate_id)
        .cloned();

    let candidates = db_kanban_candidates_mut(db)?;
    if let Some((idx, _)) = candidates
        .iter()
        .enumerate()
        .find(|(_, row)| value_ref_string(row.get("candidate UUID")) == candidate_id)
    {
        if let Some(row_obj) = candidates[idx].as_object_mut() {
            for field in CANDIDATE_FIELDS {
                if !row_obj.contains_key(field) {
                    row_obj.insert(field.to_string(), json!(""));
                }
            }
            row_obj.insert("candidate UUID".to_string(), json!(candidate_id));
        }
        return candidates
            .get_mut(idx)
            .ok_or_else(|| "Unable to access candidate row.".to_string());
    }

    let mut row = default_candidate_row();
    row.insert("candidate UUID".to_string(), json!(candidate_id));
    if let Some(card) = card.as_ref() {
        row.insert(
            "Candidate Name".to_string(),
            json!(value_ref_string(card.get("candidate_name"))),
        );
        row.insert(
            "REQ ID".to_string(),
            json!(value_ref_string(card.get("req_id"))),
        );
    }
    candidates.push(serde_json::Value::Object(row));
    candidates
        .last_mut()
        .ok_or_else(|| "Unable to create candidate row.".to_string())
}

fn apply_card_updates(
    card_obj: &mut serde_json::Map<String, serde_json::Value>,
    payload: &serde_json::Value,
    valid_columns: &HashSet<String>,
) {
    let Some(payload_obj) = payload.as_object() else {
        return;
    };
    let set_text =
        |key: &str, max_len: usize, card_obj: &mut serde_json::Map<String, serde_json::Value>| {
            if let Some(value) = payload_obj.get(key) {
                let text = clamp_string(value_ref_string(Some(value)).as_str(), max_len, false);
                card_obj.insert(key.to_string(), json!(text));
            }
        };

    set_text("candidate_name", 120, card_obj);
    set_text("icims_id", 64, card_obj);
    set_text("employee_id", 64, card_obj);
    set_text("job_id", 64, card_obj);
    set_text("req_id", 64, card_obj);
    set_text("job_name", 120, card_obj);
    set_text("job_location", 120, card_obj);
    set_text("manager", 80, card_obj);
    set_text("branch", 80, card_obj);

    if let Some(column_value) = payload_obj.get("column_id") {
        let column_id = clamp_string(value_ref_string(Some(column_value)).as_str(), 128, true);
        if !column_id.is_empty() && valid_columns.contains(&column_id) {
            card_obj.insert("column_id".to_string(), json!(column_id));
        }
    }
    if let Some(order_value) = payload_obj.get("order") {
        card_obj.insert("order".to_string(), json!(value_i64(Some(order_value))));
    }
}

fn remove_kanban_columns(
    db: &mut serde_json::Value,
    ids: &HashSet<String>,
    record_undo: bool,
) -> serde_json::Value {
    let (removed_columns, remaining_columns) = {
        let Ok(columns) = db_kanban_columns_mut(db) else {
            return json!({ "ok": false, "error": "Invalid table." });
        };
        let removed_columns: Vec<serde_json::Value> = columns
            .iter()
            .filter(|col| ids.contains(&value_ref_string(col.get("id"))))
            .cloned()
            .collect();
        let remaining_columns: Vec<serde_json::Value> = columns
            .iter()
            .filter(|col| !ids.contains(&value_ref_string(col.get("id"))))
            .cloned()
            .collect();
        (removed_columns, remaining_columns)
    };

    let removed_cards: Vec<serde_json::Value> = {
        let Ok(cards) = db_kanban_cards_mut(db) else {
            return json!({ "ok": false, "error": "Invalid table." });
        };
        cards
            .iter()
            .filter(|card| ids.contains(&value_ref_string(card.get("column_id"))))
            .cloned()
            .collect()
    };

    if remaining_columns.is_empty() && !removed_cards.is_empty() {
        return json!({
            "ok": false,
            "error": "last_column",
            "message": "Please remove candidate cards from the last remaining column before deleting it.",
        });
    }

    if !remaining_columns.is_empty() && !removed_cards.is_empty() {
        let mut sorted_remaining = remaining_columns.clone();
        sorted_remaining.sort_by_key(|col| value_i64(col.get("order")));
        let target_column_id = value_ref_string(sorted_remaining.first().and_then(|v| v.get("id")));
        if !target_column_id.is_empty() {
            let Ok(cards) = db_kanban_cards_mut(db) else {
                return json!({ "ok": false, "error": "Invalid table." });
            };
            let mut next_order = cards
                .iter()
                .filter(|card| value_ref_string(card.get("column_id")) == target_column_id)
                .map(|card| value_i64(card.get("order")))
                .max()
                .unwrap_or(0)
                + 1;
            let now = now_string();
            cards.sort_by_key(|card| value_i64(card.get("order")));
            for card in cards.iter_mut() {
                if ids.contains(&value_ref_string(card.get("column_id"))) {
                    if let Some(card_obj) = card.as_object_mut() {
                        card_obj.insert("column_id".to_string(), json!(target_column_id.clone()));
                        card_obj.insert("order".to_string(), json!(next_order));
                        card_obj.insert("updated_at".to_string(), json!(now.clone()));
                    }
                    next_order += 1;
                }
            }
        }
    }

    if let Ok(columns_mut) = db_kanban_columns_mut(db) {
        columns_mut.retain(|col| !ids.contains(&value_ref_string(col.get("id"))));
    }

    let undo_id = if record_undo && !removed_columns.is_empty() {
        push_recycle_item(
            db,
            json!({
                "type": "kanban_columns",
                "columns": removed_columns,
                "cards": removed_cards,
            }),
        )
    } else {
        None
    };

    json!({
        "ok": true,
        "columns": db.get("kanban").and_then(|v| v.get("columns")).cloned().unwrap_or_else(|| json!([])),
        "cards": db.get("kanban").and_then(|v| v.get("cards")).cloned().unwrap_or_else(|| json!([])),
        "undoId": undo_id,
    })
}

fn normalize_uniform_type(value: &str) -> String {
    let text = clamp_string(value, 40, true);
    let lowered = text.to_lowercase();
    if lowered == "shirts" {
        "Shirt".to_string()
    } else if lowered == "pants" {
        "Pants".to_string()
    } else {
        text
    }
}

fn normalize_uniform_payload(payload: &serde_json::Value) -> UniformPayload {
    let alteration = clamp_string(
        value_ref_string(payload.get("alteration")).as_str(),
        80,
        true,
    );
    let kind = normalize_uniform_type(value_ref_string(payload.get("type")).as_str());
    let mut size = clamp_string(value_ref_string(payload.get("size")).as_str(), 40, true);
    let waist = clamp_string(
        value_ref_string(payload.get("waist").or_else(|| payload.get("Waist"))).as_str(),
        2,
        true,
    );
    let inseam = clamp_string(
        value_ref_string(payload.get("inseam").or_else(|| payload.get("Inseam"))).as_str(),
        2,
        true,
    );
    let branch = clamp_string(value_ref_string(payload.get("branch")).as_str(), 40, true);
    let quantity = parse_nonnegative_integer(payload.get("quantity"));

    if kind == "Pants" && size.is_empty() && !waist.is_empty() && !inseam.is_empty() {
        size = format!("{waist}x{inseam}");
    }
    if kind == "Shirt" {
        size = clamp_string(size.to_uppercase().as_str(), 40, true);
    }

    UniformPayload {
        alteration,
        kind,
        size,
        waist,
        inseam,
        quantity,
        branch,
    }
}

fn uniform_key_from_entry(entry: &serde_json::Value) -> String {
    let branch = value_ref_string(entry.get("branch")).to_lowercase();
    let kind = value_ref_string(entry.get("type")).to_lowercase();
    let size = value_ref_string(entry.get("size")).to_lowercase();
    let alteration = value_ref_string(entry.get("alteration")).to_lowercase();
    format!("{branch}|{kind}|{size}|{alteration}")
}

fn uniform_key_from_payload(payload: &UniformPayload) -> String {
    format!(
        "{}|{}|{}|{}",
        payload.branch.to_lowercase(),
        payload.kind.to_lowercase(),
        payload.size.to_lowercase(),
        payload.alteration.to_lowercase()
    )
}

fn upsert_uniform_stock(
    db: &mut serde_json::Value,
    payload: &UniformPayload,
) -> Option<serde_json::Value> {
    let uniforms = db_uniforms_mut(db).ok()?;
    let key = uniform_key_from_payload(payload);
    for entry in uniforms.iter_mut() {
        if uniform_key_from_entry(entry) != key {
            continue;
        }
        if let Some(entry_obj) = entry.as_object_mut() {
            let next = value_i64(entry_obj.get("quantity")) + payload.quantity;
            entry_obj.insert("quantity".to_string(), json!(next.max(0)));
            return Some(serde_json::Value::Object(entry_obj.clone()));
        }
    }

    let row = json!({
        "id": new_id(),
        "alteration": payload.alteration,
        "type": payload.kind,
        "size": payload.size,
        "waist": payload.waist,
        "inseam": payload.inseam,
        "quantity": payload.quantity,
        "branch": payload.branch,
    });
    uniforms.push(row.clone());
    Some(row)
}

fn decrement_uniform_stock(db: &mut serde_json::Value, payload: &UniformPayload) -> i64 {
    let Ok(uniforms) = db_uniforms_mut(db) else {
        return 0;
    };
    let key = uniform_key_from_payload(payload);
    for idx in 0..uniforms.len() {
        let Some(entry) = uniforms.get(idx) else {
            continue;
        };
        if uniform_key_from_entry(entry) != key {
            continue;
        }
        let available = value_i64(uniforms[idx].get("quantity")).max(0);
        if available <= 0 {
            return 0;
        }
        let deducted = available.min(payload.quantity.max(0));
        if let Some(obj) = uniforms[idx].as_object_mut() {
            obj.insert("quantity".to_string(), json!(available - deducted));
        }
        if value_i64(uniforms[idx].get("quantity")) <= 0 {
            uniforms.remove(idx);
        }
        return deducted;
    }
    0
}

fn parse_issued_uniform_quantity(value: &str) -> i64 {
    let num = value.trim().parse::<i64>().unwrap_or(0);
    if (1..=4).contains(&num) {
        num
    } else {
        0
    }
}

fn parse_alteration_list(value: &str) -> Vec<String> {
    let text = value.trim();
    if text.is_empty() {
        return Vec::new();
    }

    let mut out = Vec::new();
    if text.starts_with('[') && text.ends_with(']') {
        if let Ok(parsed) = serde_json::from_str::<Vec<serde_json::Value>>(text) {
            for item in parsed {
                let normalized = clamp_string(value_ref_string(Some(&item)).as_str(), 80, true);
                if !normalized.is_empty() {
                    out.push(normalized);
                }
            }
        }
    } else {
        for part in text.split(',') {
            let normalized = clamp_string(part, 80, true);
            if !normalized.is_empty() {
                out.push(normalized);
            }
        }
    }
    let mut seen = HashSet::new();
    out.retain(|item| seen.insert(item.to_lowercase()));
    out
}

fn append_uniform_adjustment(
    adjustments: &mut Vec<serde_json::Value>,
    payload: &UniformPayload,
    quantity: i64,
) {
    if quantity <= 0 {
        return;
    }
    let key = uniform_key_from_payload(payload);
    for entry in adjustments.iter_mut() {
        if uniform_key_from_entry(entry) != key {
            continue;
        }
        if let Some(obj) = entry.as_object_mut() {
            let next = value_i64(obj.get("quantity")) + quantity;
            obj.insert("quantity".to_string(), json!(next));
        }
        return;
    }
    adjustments.push(json!({
        "alteration": payload.alteration,
        "type": payload.kind,
        "size": payload.size,
        "quantity": quantity,
        "branch": payload.branch,
    }));
}

fn deduct_uniforms_across_alterations(
    db: &mut serde_json::Value,
    kind: &str,
    size: &str,
    quantity: i64,
    branch: &str,
    alterations: &[String],
) -> Vec<serde_json::Value> {
    let mut adjustments = Vec::new();
    let normalized_kind = normalize_uniform_type(kind);
    let normalized_size = clamp_string(size, 40, true);
    let normalized_branch = clamp_string(branch, 40, true);
    let normalized_quantity = parse_issued_uniform_quantity(quantity.to_string().as_str());
    if normalized_kind.is_empty()
        || normalized_size.is_empty()
        || normalized_branch.is_empty()
        || normalized_quantity <= 0
    {
        return adjustments;
    }

    let mut targets: Vec<String> = alterations
        .iter()
        .map(|value| clamp_string(value, 80, true))
        .filter(|value| !value.is_empty())
        .collect();
    if targets.is_empty() {
        targets.push(String::new());
    }

    if targets.len() == 1 {
        let payload = UniformPayload {
            alteration: targets[0].clone(),
            kind: normalized_kind,
            size: normalized_size,
            waist: String::new(),
            inseam: String::new(),
            quantity: normalized_quantity,
            branch: normalized_branch,
        };
        let deducted = decrement_uniform_stock(db, &payload);
        append_uniform_adjustment(&mut adjustments, &payload, deducted);
        return adjustments;
    }

    let mut remaining = normalized_quantity;
    let mut misses = 0_usize;
    let mut idx = 0_usize;
    while remaining > 0 && misses < targets.len() {
        let alteration = targets[idx % targets.len()].clone();
        let payload = UniformPayload {
            alteration,
            kind: normalized_kind.clone(),
            size: normalized_size.clone(),
            waist: String::new(),
            inseam: String::new(),
            quantity: 1,
            branch: normalized_branch.clone(),
        };
        let deducted = decrement_uniform_stock(db, &payload);
        if deducted > 0 {
            remaining -= deducted;
            misses = 0;
            append_uniform_adjustment(&mut adjustments, &payload, deducted);
        } else {
            misses += 1;
        }
        idx += 1;
    }
    adjustments
}

fn push_recycle_item(db: &mut serde_json::Value, payload: serde_json::Value) -> Option<String> {
    let id = new_id();
    let mut entry = serde_json::Map::new();
    entry.insert("id".to_string(), json!(id.clone()));
    entry.insert("deleted_at".to_string(), json!(now_string()));
    if let Some(obj) = payload.as_object() {
        for (key, value) in obj {
            entry.insert(key.clone(), value.clone());
        }
    }
    let items = db_recycle_items_mut(db).ok()?;
    items.push(serde_json::Value::Object(entry));
    Some(id)
}

fn push_redo_item(db: &mut serde_json::Value, payload: serde_json::Value) -> Option<String> {
    let id = new_id();
    let mut entry = serde_json::Map::new();
    entry.insert("id".to_string(), json!(id.clone()));
    entry.insert("deleted_at".to_string(), json!(now_string()));
    if let Some(obj) = payload.as_object() {
        for (key, value) in obj {
            entry.insert(key.clone(), value.clone());
        }
    }
    let redo = db_redo_items_mut(db).ok()?;
    redo.push(serde_json::Value::Object(entry));
    Some(id)
}

fn pop_recycle_item(db: &mut serde_json::Value, id: &str) -> Option<serde_json::Value> {
    let items = db_recycle_items_mut(db).ok()?;
    let idx = items
        .iter()
        .position(|item| value_ref_string(item.get("id")) == id)?;
    Some(items.remove(idx))
}

fn pop_redo_item(db: &mut serde_json::Value, id: &str) -> Option<serde_json::Value> {
    let redo = db_redo_items_mut(db).ok()?;
    let idx = redo
        .iter()
        .position(|item| value_ref_string(item.get("id")) == id)?;
    Some(redo.remove(idx))
}

fn restore_recycle_item(db: &mut serde_json::Value, item: &serde_json::Value) -> bool {
    let item_type = value_ref_string(item.get("type"));
    match item_type.as_str() {
        "kanban_cards" => {
            let cards = item
                .get("cards")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let rows = item
                .get("candidates")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let adjustments = item
                .get("uniformAdjustments")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            if let Ok(db_cards) = db_kanban_cards_mut(db) {
                let existing: HashSet<String> = db_cards
                    .iter()
                    .map(|card| value_ref_string(card.get("uuid")))
                    .collect();
                for card in cards {
                    let id = value_ref_string(card.get("uuid"));
                    if id.is_empty() || existing.contains(&id) {
                        continue;
                    }
                    db_cards.push(card);
                }
            }
            if let Ok(db_rows) = db_kanban_candidates_mut(db) {
                let existing: HashSet<String> = db_rows
                    .iter()
                    .map(|row| value_ref_string(row.get("candidate UUID")))
                    .collect();
                for row in rows {
                    let id = value_ref_string(row.get("candidate UUID"));
                    if id.is_empty() || existing.contains(&id) {
                        continue;
                    }
                    db_rows.push(row);
                }
            }
            for entry in adjustments {
                let normalized = normalize_uniform_payload(&entry);
                if normalized.quantity > 0 {
                    let _ = upsert_uniform_stock(db, &normalized);
                }
            }
            true
        }
        "kanban_columns" => {
            let columns = item
                .get("columns")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let cards = item
                .get("cards")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            if let Ok(db_columns) = db_kanban_columns_mut(db) {
                let existing: HashSet<String> = db_columns
                    .iter()
                    .map(|col| value_ref_string(col.get("id")))
                    .collect();
                for col in columns {
                    let id = value_ref_string(col.get("id"));
                    if id.is_empty() || existing.contains(&id) {
                        continue;
                    }
                    db_columns.push(col);
                }
            }
            if let Ok(db_cards) = db_kanban_cards_mut(db) {
                let ids: HashSet<String> = cards
                    .iter()
                    .map(|card| value_ref_string(card.get("uuid")))
                    .filter(|id| !id.is_empty())
                    .collect();
                db_cards.retain(|card| !ids.contains(&value_ref_string(card.get("uuid"))));
                for card in cards {
                    if !value_ref_string(card.get("uuid")).is_empty() {
                        db_cards.push(card);
                    }
                }
            }
            true
        }
        "candidate_rows" => {
            let rows = item
                .get("candidates")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            if let Ok(db_rows) = db_kanban_candidates_mut(db) {
                let existing: HashSet<String> = db_rows
                    .iter()
                    .map(|row| value_ref_string(row.get("candidate UUID")))
                    .collect();
                for row in rows {
                    let id = value_ref_string(row.get("candidate UUID"));
                    if id.is_empty() || existing.contains(&id) {
                        continue;
                    }
                    db_rows.push(row);
                }
            }
            true
        }
        "weekly_entries" => {
            let entries = item
                .get("entries")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            if let Some(weekly) = db.get_mut("weekly").and_then(|v| v.as_object_mut()) {
                for entry in entries {
                    let week_start = value_ref_string(entry.get("week_start"));
                    let week_end = value_ref_string(entry.get("week_end"));
                    let day = value_ref_string(entry.get("day"));
                    if week_start.is_empty() || day.is_empty() {
                        continue;
                    }
                    let week_entry = weekly.entry(week_start.clone()).or_insert_with(|| {
                        json!({
                            "week_start": week_start,
                            "week_end": week_end,
                            "entries": {},
                        })
                    });
                    if let Some(week_obj) = week_entry.as_object_mut() {
                        week_obj.insert("week_start".to_string(), json!(week_start.clone()));
                        if !week_end.is_empty() {
                            week_obj.insert("week_end".to_string(), json!(week_end));
                        }
                        if !week_obj.get("entries").is_some_and(|v| v.is_object()) {
                            week_obj.insert("entries".to_string(), json!({}));
                        }
                        if let Some(days_obj) =
                            week_obj.get_mut("entries").and_then(|v| v.as_object_mut())
                        {
                            days_obj.insert(
                                day,
                                entry.get("payload").cloned().unwrap_or_else(|| json!({})),
                            );
                        }
                    }
                }
            }
            true
        }
        "todos" => {
            let rows = item
                .get("todos")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            if let Ok(todos) = db_todos_mut(db) {
                let existing: HashSet<String> = todos
                    .iter()
                    .map(|todo| value_ref_string(todo.get("id")))
                    .collect();
                for todo in rows {
                    let id = value_ref_string(todo.get("id"));
                    if id.is_empty() || existing.contains(&id) {
                        continue;
                    }
                    todos.push(todo);
                }
            }
            true
        }
        "uniform_rows" => {
            let rows = item
                .get("uniforms")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            if let Ok(uniforms) = db_uniforms_mut(db) {
                let existing: HashSet<String> = uniforms
                    .iter()
                    .map(|entry| value_ref_string(entry.get("id")))
                    .collect();
                for entry in rows {
                    let id = value_ref_string(entry.get("id"));
                    if id.is_empty() || existing.contains(&id) {
                        continue;
                    }
                    uniforms.push(entry);
                }
            }
            true
        }
        _ => false,
    }
}

fn reapply_recycle_item(db: &mut serde_json::Value, item: &serde_json::Value) -> bool {
    let item_type = value_ref_string(item.get("type"));
    match item_type.as_str() {
        "kanban_cards" => {
            let cards = item
                .get("cards")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let rows = item
                .get("candidates")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let adjustments = item
                .get("uniformAdjustments")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            let card_ids: HashSet<String> = cards
                .iter()
                .map(|card| value_ref_string(card.get("uuid")))
                .filter(|id| !id.is_empty())
                .collect();
            let row_ids: HashSet<String> = rows
                .iter()
                .map(|row| value_ref_string(row.get("candidate UUID")))
                .filter(|id| !id.is_empty())
                .collect();
            if let Ok(db_cards) = db_kanban_cards_mut(db) {
                db_cards.retain(|card| !card_ids.contains(&value_ref_string(card.get("uuid"))));
            }
            if let Ok(db_rows) = db_kanban_candidates_mut(db) {
                db_rows
                    .retain(|row| !row_ids.contains(&value_ref_string(row.get("candidate UUID"))));
            }
            for entry in adjustments {
                let normalized = normalize_uniform_payload(&entry);
                if normalized.quantity > 0 {
                    let _ = decrement_uniform_stock(db, &normalized);
                }
            }
            true
        }
        "kanban_columns" => {
            let ids: HashSet<String> = item
                .get("columns")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|col| value_ref_string(col.get("id")))
                .filter(|id| !id.is_empty())
                .collect();
            if ids.is_empty() {
                return false;
            }
            remove_kanban_columns(db, &ids, false)
                .get("ok")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        }
        "candidate_rows" => {
            let ids: HashSet<String> = item
                .get("candidates")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|row| value_ref_string(row.get("candidate UUID")))
                .filter(|id| !id.is_empty())
                .collect();
            if let Ok(rows) = db_kanban_candidates_mut(db) {
                rows.retain(|row| !ids.contains(&value_ref_string(row.get("candidate UUID"))));
            }
            true
        }
        "weekly_entries" => {
            let entries = item
                .get("entries")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            if let Some(weekly) = db.get_mut("weekly").and_then(|v| v.as_object_mut()) {
                for entry in entries {
                    let week_start = value_ref_string(entry.get("week_start"));
                    let day = value_ref_string(entry.get("day"));
                    if let Some(week) = weekly.get_mut(&week_start).and_then(|v| v.as_object_mut())
                    {
                        if let Some(days) = week.get_mut("entries").and_then(|v| v.as_object_mut())
                        {
                            days.remove(day.as_str());
                        }
                    }
                }
            }
            true
        }
        "todos" => {
            let ids: HashSet<String> = item
                .get("todos")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|todo| value_ref_string(todo.get("id")))
                .filter(|id| !id.is_empty())
                .collect();
            if let Ok(todos) = db_todos_mut(db) {
                todos.retain(|todo| !ids.contains(&value_ref_string(todo.get("id"))));
            }
            true
        }
        "uniform_rows" => {
            let ids: HashSet<String> = item
                .get("uniforms")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|entry| value_ref_string(entry.get("id")))
                .filter(|id| !id.is_empty())
                .collect();
            if let Ok(uniforms) = db_uniforms_mut(db) {
                uniforms.retain(|entry| !ids.contains(&value_ref_string(entry.get("id"))));
            }
            true
        }
        _ => false,
    }
}

fn validate_db_basic(db: &serde_json::Value) -> Option<(String, String)> {
    let Some(db_obj) = db.as_object() else {
        return Some((
            "broken".to_string(),
            "Database payload is not an object.".to_string(),
        ));
    };

    let version = value_i64(db_obj.get("version"));
    if version > DB_VERSION as i64 {
        return Some((
            "broken".to_string(),
            "Database version is newer than this app supports.".to_string(),
        ));
    }

    let Some(kanban) = db_obj.get("kanban").and_then(|v| v.as_object()) else {
        return Some((
            "broken".to_string(),
            "Kanban data is missing or invalid.".to_string(),
        ));
    };
    if !kanban.get("columns").is_some_and(|v| v.is_array()) {
        return Some((
            "broken".to_string(),
            "Kanban columns are missing.".to_string(),
        ));
    }
    if !kanban.get("cards").is_some_and(|v| v.is_array()) {
        return Some((
            "broken".to_string(),
            "Kanban cards are missing.".to_string(),
        ));
    }
    if !kanban.get("candidates").is_some_and(|v| v.is_array()) {
        return Some((
            "broken".to_string(),
            "Candidate rows are missing.".to_string(),
        ));
    }

    if !db_obj.get("uniforms").is_some_and(|v| v.is_array()) {
        return Some((
            "broken".to_string(),
            "Uniform inventory is invalid.".to_string(),
        ));
    }
    if !db_obj.get("weekly").is_some_and(|v| v.is_object()) {
        return Some(("broken".to_string(), "Weekly data is invalid.".to_string()));
    }
    if !db_obj.get("todos").is_some_and(|v| v.is_array()) {
        return Some(("broken".to_string(), "Todo data is invalid.".to_string()));
    }
    if !db_obj.get("recycle").is_some_and(|v| v.is_object()) {
        return Some(("broken".to_string(), "Recycle data is invalid.".to_string()));
    }

    for column in kanban
        .get("columns")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
    {
        if value_ref_string(column.get("id")).is_empty() {
            return Some(("broken".to_string(), "Column IDs are invalid.".to_string()));
        }
    }
    for card in kanban
        .get("cards")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
    {
        if value_ref_string(card.get("uuid")).is_empty() {
            return Some(("broken".to_string(), "Card IDs are invalid.".to_string()));
        }
        if value_ref_string(card.get("column_id")).is_empty() {
            return Some((
                "broken".to_string(),
                "Card column references are invalid.".to_string(),
            ));
        }
    }
    for row in kanban
        .get("candidates")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
    {
        if value_ref_string(row.get("candidate UUID")).is_empty() {
            return Some((
                "broken".to_string(),
                "Candidate UUIDs are missing.".to_string(),
            ));
        }
    }
    None
}

fn verify_auth_password(app: &AppHandle, password: &str) -> Result<bool, String> {
    let Some(record) = read_auth_record(app)? else {
        return Ok(false);
    };
    if password.is_empty() {
        return Ok(false);
    }
    let salt = match decode_b64(record.salt.as_str()) {
        Ok(value) => value,
        Err(_) => return Ok(false),
    };
    let key = derive_key(password, salt.as_slice(), record.iterations.max(1));
    Ok(encode_b64(key.as_slice()) == record.hash)
}

fn meta_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let root = storage_root_dir(app)?;
    Ok(root.join(META_FILE))
}

fn ensure_meta_shape_value(value: serde_json::Value) -> serde_json::Value {
    let mut out = if value.is_object() { value } else { json!({}) };
    let Some(obj) = out.as_object_mut() else {
        return json!({
            "databases": [],
            "active_db": "current",
            "biometrics_enabled": false,
        });
    };
    if !obj.get("databases").is_some_and(|v| v.is_array()) {
        obj.insert("databases".to_string(), json!([]));
    }
    if !obj.get("active_db").is_some_and(|v| v.is_string()) {
        obj.insert("active_db".to_string(), json!("current"));
    }
    if !obj
        .get("biometrics_enabled")
        .is_some_and(|v| v.is_boolean())
    {
        obj.insert("biometrics_enabled".to_string(), json!(false));
    }
    out
}

fn load_meta_value(app: &AppHandle) -> Result<serde_json::Value, String> {
    let path = meta_file_path(app)?;
    if !path.exists() {
        return Ok(ensure_meta_shape_value(json!({})));
    }
    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let parsed = match serde_json::from_str::<serde_json::Value>(raw.as_str()) {
        Ok(value) => value,
        Err(_) => json!({}),
    };
    Ok(ensure_meta_shape_value(parsed))
}

fn write_meta_value(app: &AppHandle, value: &serde_json::Value) -> Result<(), String> {
    let path = meta_file_path(app)?;
    let normalized = ensure_meta_shape_value(value.clone());
    let content = serde_json::to_string(&normalized).map_err(|err| err.to_string())?;
    write_text_file(path, content.as_str())
}

fn list_db_sources(meta: &serde_json::Value) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    out.push(json!({
        "id": "current",
        "name": "Current Database",
        "readonly": false,
    }));
    if let Some(items) = meta.get("databases").and_then(|v| v.as_array()) {
        for entry in items {
            let id = clamp_string(value_ref_string(entry.get("id")).as_str(), 128, true);
            if id.is_empty() {
                continue;
            }
            let mut name = clamp_string(value_ref_string(entry.get("name")).as_str(), 200, true);
            if name.is_empty() {
                name = clamp_string(value_ref_string(entry.get("filename")).as_str(), 200, true);
            }
            if name.is_empty() {
                name = "Imported Database".to_string();
            }
            out.push(json!({
                "id": id,
                "name": name,
                "readonly": true,
            }));
        }
    }
    out
}

fn resolve_active_source_id(meta: &serde_json::Value, sources: &[serde_json::Value]) -> String {
    let requested = clamp_string(value_ref_string(meta.get("active_db")).as_str(), 128, true);
    if requested.is_empty() {
        return "current".to_string();
    }
    let exists = sources
        .iter()
        .any(|source| value_ref_string(source.get("id")) == requested);
    if exists {
        requested
    } else {
        "current".to_string()
    }
}

fn get_db_entry(meta: &serde_json::Value, id: &str) -> Option<serde_json::Value> {
    let entries = meta.get("databases")?.as_array()?;
    for entry in entries {
        if value_ref_string(entry.get("id")) == id {
            return Some(entry.clone());
        }
    }
    None
}

fn build_db_filename(id: &str) -> String {
    let mut normalized = String::new();
    for ch in clamp_string(id, 128, true).chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            normalized.push(ch);
        } else {
            normalized.push('_');
        }
    }
    let normalized = normalized.trim_matches('_');
    let basename = if normalized.is_empty() {
        format!("imported-{}", now_string())
    } else {
        normalized.to_string()
    };
    format!("{basename}.enc")
}

fn imported_db_file_path(app: &AppHandle, filename: &str) -> Result<PathBuf, String> {
    let root = storage_root_dir(app)?;
    let safe_filename = clamp_string(filename, 256, true);
    if safe_filename.is_empty() {
        return Err("Invalid database filename.".to_string());
    }
    let rel = sanitize_relative_path(format!("dbs/{safe_filename}").as_str())?;
    Ok(root.join(rel))
}

fn read_db_file_by_name(
    app: &AppHandle,
    filename: &str,
    password: &str,
) -> Result<Option<serde_json::Value>, String> {
    let path = match imported_db_file_path(app, filename) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let envelope: CryptoEnvelope = match serde_json::from_str(raw.as_str()) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    let decrypted = match decrypt_envelope(&envelope, password)? {
        Some(value) => value,
        None => return Ok(None),
    };
    let parsed = match serde_json::from_str::<serde_json::Value>(decrypted.as_str()) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    Ok(Some(ensure_db_shape_value(parsed)))
}

fn write_db_file_by_name(
    app: &AppHandle,
    filename: &str,
    db: &serde_json::Value,
    password: &str,
) -> Result<(), String> {
    let path = imported_db_file_path(app, filename)?;
    let normalized = ensure_db_shape_value(db.clone());
    let text = serde_json::to_string(&normalized).map_err(|err| err.to_string())?;
    let envelope = encrypt_text(text.as_str(), password)?;
    let content = serde_json::to_string(&envelope).map_err(|err| err.to_string())?;
    write_text_file(path, content.as_str())
}

fn load_db_by_source_value(
    app: &AppHandle,
    source_id: &str,
    password: &str,
) -> Result<Option<serde_json::Value>, String> {
    let safe_source = clamp_string(source_id, 128, true);
    if safe_source.is_empty() || safe_source == "current" {
        return Ok(Some(load_db_value(app, password)?));
    }
    let meta = load_meta_value(app)?;
    let Some(entry) = get_db_entry(&meta, safe_source.as_str()) else {
        return Ok(None);
    };
    let filename = value_ref_string(entry.get("filename"));
    if filename.is_empty() {
        return Ok(None);
    }
    read_db_file_by_name(app, filename.as_str(), password)
}

fn store_imported_database(
    app: &AppHandle,
    db: &serde_json::Value,
    file_name: &str,
    password: &str,
) -> Result<serde_json::Value, String> {
    let mut meta = load_meta_value(app)?;
    let id = new_id();
    let filename = build_db_filename(id.as_str());
    write_db_file_by_name(app, filename.as_str(), db, password)?;
    let name = {
        let raw = clamp_string(file_name, 200, true);
        if raw.is_empty() {
            "Imported Database".to_string()
        } else {
            raw
        }
    };
    let entry = json!({
        "id": id,
        "filename": filename,
        "name": name,
        "imported_at": now_string(),
    });
    if let Some(meta_obj) = meta.as_object_mut() {
        if !meta_obj.get("databases").is_some_and(|v| v.is_array()) {
            meta_obj.insert("databases".to_string(), json!([]));
        }
        if let Some(items) = meta_obj.get_mut("databases").and_then(|v| v.as_array_mut()) {
            items.push(entry.clone());
        }
    }
    write_meta_value(app, &meta)?;
    Ok(entry)
}

fn merge_databases(target: &mut serde_json::Value, incoming: &serde_json::Value) {
    *target = ensure_db_shape_value(target.clone());
    let incoming = ensure_db_shape_value(incoming.clone());
    let now = now_string();

    let mut column_map: HashMap<String, String> = HashMap::new();
    let mut existing_columns: HashSet<String> = target
        .get("kanban")
        .and_then(|v| v.get("columns"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|column| value_ref_string(column.get("id")))
        .filter(|id| !id.is_empty())
        .collect();
    let mut max_column_order = target
        .get("kanban")
        .and_then(|v| v.get("columns"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|column| value_i64(column.get("order")))
        .max()
        .unwrap_or(0);
    let mut incoming_columns = incoming
        .get("kanban")
        .and_then(|v| v.get("columns"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    incoming_columns.sort_by_key(|column| value_i64(column.get("order")));
    if let Ok(target_columns) = db_kanban_columns_mut(target) {
        for column in incoming_columns {
            let old_id = value_ref_string(column.get("id"));
            if old_id.is_empty() {
                continue;
            }
            let next_id = if existing_columns.contains(&old_id) {
                new_id()
            } else {
                old_id.clone()
            };
            existing_columns.insert(next_id.clone());
            column_map.insert(old_id, next_id.clone());
            max_column_order += 1;
            let mut next_column = column.as_object().cloned().unwrap_or_default();
            next_column.insert("id".to_string(), json!(next_id));
            next_column.insert("order".to_string(), json!(max_column_order));
            next_column.insert("updated_at".to_string(), json!(now.clone()));
            target_columns.push(serde_json::Value::Object(next_column));
        }
    }

    let first_column_id = target
        .get("kanban")
        .and_then(|v| v.get("columns"))
        .and_then(|v| v.as_array())
        .and_then(|columns| columns.first())
        .map(|column| value_ref_string(column.get("id")))
        .unwrap_or_default();

    let mut card_id_map: HashMap<String, String> = HashMap::new();
    let mut existing_card_ids: HashSet<String> = target
        .get("kanban")
        .and_then(|v| v.get("cards"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|card| value_ref_string(card.get("uuid")))
        .filter(|id| !id.is_empty())
        .collect();
    let mut existing_row_ids: HashSet<String> = target
        .get("kanban")
        .and_then(|v| v.get("candidates"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|row| value_ref_string(row.get("candidate UUID")))
        .filter(|id| !id.is_empty())
        .collect();
    let mut order_by_column: HashMap<String, i64> = HashMap::new();
    for card in target
        .get("kanban")
        .and_then(|v| v.get("cards"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
    {
        let column_id = value_ref_string(card.get("column_id"));
        if column_id.is_empty() {
            continue;
        }
        let current = order_by_column.get(&column_id).copied().unwrap_or(0);
        let next = current.max(value_i64(card.get("order")));
        order_by_column.insert(column_id, next);
    }

    let mut incoming_cards = incoming
        .get("kanban")
        .and_then(|v| v.get("cards"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    incoming_cards.sort_by_key(|card| value_i64(card.get("order")));
    if let Ok(target_cards) = db_kanban_cards_mut(target) {
        for card in incoming_cards {
            let old_id = value_ref_string(card.get("uuid"));
            if old_id.is_empty() {
                continue;
            }
            let next_id = if existing_card_ids.contains(&old_id) {
                new_id()
            } else {
                old_id.clone()
            };
            let mapped_column = {
                let incoming_column = value_ref_string(card.get("column_id"));
                column_map
                    .get(&incoming_column)
                    .cloned()
                    .unwrap_or(incoming_column)
            };
            let safe_column =
                if !mapped_column.is_empty() && existing_columns.contains(&mapped_column) {
                    mapped_column
                } else if !first_column_id.is_empty() {
                    first_column_id.clone()
                } else {
                    mapped_column
                };
            let next_order = order_by_column.get(&safe_column).copied().unwrap_or(0) + 1;
            order_by_column.insert(safe_column.clone(), next_order);

            let mut next_card = card.as_object().cloned().unwrap_or_default();
            next_card.insert("uuid".to_string(), json!(next_id.clone()));
            next_card.insert("column_id".to_string(), json!(safe_column));
            next_card.insert("order".to_string(), json!(next_order));
            next_card.insert("updated_at".to_string(), json!(now.clone()));
            target_cards.push(serde_json::Value::Object(next_card));
            existing_card_ids.insert(next_id.clone());
            card_id_map.insert(old_id, next_id);
        }
    }

    let incoming_rows = incoming
        .get("kanban")
        .and_then(|v| v.get("candidates"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if let Ok(target_rows) = db_kanban_candidates_mut(target) {
        for row in incoming_rows {
            let Some(row_obj) = row.as_object() else {
                continue;
            };
            let original_id = value_ref_string(row.get("candidate UUID"));
            let mut next_id = card_id_map
                .get(original_id.as_str())
                .cloned()
                .unwrap_or(original_id);
            if next_id.is_empty() || existing_row_ids.contains(&next_id) {
                next_id = new_id();
            }
            let mut next_row = row_obj.clone();
            next_row.insert("candidate UUID".to_string(), json!(next_id.clone()));
            for field in CANDIDATE_FIELDS {
                if !next_row.contains_key(field) {
                    next_row.insert(field.to_string(), json!(""));
                }
            }
            target_rows.push(serde_json::Value::Object(next_row));
            existing_row_ids.insert(next_id);
        }
    }

    let incoming_weeks = incoming
        .get("weekly")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    if let Some(target_weeks) = target.get_mut("weekly").and_then(|v| v.as_object_mut()) {
        for week in incoming_weeks.values() {
            let week_start = value_ref_string(week.get("week_start"));
            if week_start.is_empty() {
                continue;
            }
            let week_end = value_ref_string(week.get("week_end"));
            let week_entry = target_weeks.entry(week_start.clone()).or_insert_with(|| {
                json!({
                    "week_start": week_start.clone(),
                    "week_end": week_end.clone(),
                    "entries": {},
                })
            });
            if let Some(week_obj) = week_entry.as_object_mut() {
                if !week_obj.get("entries").is_some_and(|v| v.is_object()) {
                    week_obj.insert("entries".to_string(), json!({}));
                }
                if let Some(target_entries) = week_obj
                    .get_mut("entries")
                    .and_then(|value| value.as_object_mut())
                {
                    if let Some(source_entries) =
                        week.get("entries").and_then(|value| value.as_object())
                    {
                        for (day, payload) in source_entries {
                            if !target_entries.contains_key(day) {
                                target_entries.insert(day.clone(), payload.clone());
                            }
                        }
                    }
                }
            }
        }
    }

    let mut todo_ids: HashSet<String> = target
        .get("todos")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|todo| value_ref_string(todo.get("id")))
        .filter(|id| !id.is_empty())
        .collect();
    let incoming_todos = incoming
        .get("todos")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if let Ok(target_todos) = db_todos_mut(target) {
        for todo in incoming_todos {
            let Some(todo_obj) = todo.as_object() else {
                continue;
            };
            let mut next_id = value_ref_string(todo.get("id"));
            if next_id.is_empty() || todo_ids.contains(&next_id) {
                next_id = new_id();
            }
            let mut next_todo = todo_obj.clone();
            next_todo.insert("id".to_string(), json!(next_id.clone()));
            target_todos.push(serde_json::Value::Object(next_todo));
            todo_ids.insert(next_id);
        }
    }

    let incoming_uniforms = incoming
        .get("uniforms")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    for entry in incoming_uniforms {
        let normalized = normalize_uniform_payload(&entry);
        if normalized.kind.is_empty()
            || normalized.size.is_empty()
            || normalized.branch.is_empty()
            || normalized.quantity <= 0
        {
            continue;
        }
        let _ = upsert_uniform_stock(target, &normalized);
    }
}

fn default_pbkdf2_iterations() -> u32 {
    DEFAULT_PBKDF2_ITERATIONS
}

fn auth_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let root = storage_root_dir(app)?;
    Ok(root.join(AUTH_FILE))
}

fn read_auth_record(app: &AppHandle) -> Result<Option<AuthRecord>, String> {
    let path = auth_file_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let mut record: AuthRecord = match serde_json::from_str(raw.as_str()) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    if record.salt.is_empty() || record.hash.is_empty() {
        return Ok(None);
    }
    if record.iterations == 0 {
        record.iterations = DEFAULT_PBKDF2_ITERATIONS;
    }
    Ok(Some(record))
}

fn write_auth_record(app: &AppHandle, payload: &AuthRecord) -> Result<(), String> {
    let path = auth_file_path(app)?;
    let content = serde_json::to_string_pretty(payload).map_err(|err| err.to_string())?;
    write_text_file(path, content.as_str())
}

fn encrypt_text_with_key(
    text: &str,
    salt: &[u8],
    key: &[u8; 32],
) -> Result<CryptoEnvelope, String> {
    let mut iv = [0u8; 12];
    OsRng.fill_bytes(&mut iv);
    let cipher = Aes256Gcm::new_from_slice(key.as_slice()).map_err(|err| err.to_string())?;
    let nonce = Nonce::from_slice(&iv);
    let encrypted = cipher
        .encrypt(nonce, text.as_bytes())
        .map_err(|err| err.to_string())?;

    if encrypted.len() < 16 {
        return Err("Encryption output too short.".to_string());
    }
    let split_at = encrypted.len() - 16;
    let (data, tag) = encrypted.split_at(split_at);

    Ok(CryptoEnvelope {
        v: 1,
        salt: encode_b64(salt),
        iv: encode_b64(&iv),
        tag: encode_b64(tag),
        data: encode_b64(data),
    })
}

fn encrypt_text(text: &str, password: &str) -> Result<CryptoEnvelope, String> {
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);

    let key = derive_key(password, &salt, DEFAULT_PBKDF2_ITERATIONS);
    encrypt_text_with_key(text, &salt, &key)
}

fn decrypt_envelope_with_key(
    payload: &CryptoEnvelope,
    key: &[u8; 32],
) -> Result<Option<String>, String> {
    let iv = match decode_b64(payload.iv.as_str()) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    let tag = match decode_b64(payload.tag.as_str()) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    let data = match decode_b64(payload.data.as_str()) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    if iv.len() != 12 || tag.is_empty() || data.is_empty() {
        return Ok(None);
    }

    let cipher = Aes256Gcm::new_from_slice(key.as_slice()).map_err(|err| err.to_string())?;
    let nonce = Nonce::from_slice(iv.as_slice());
    let mut combined = Vec::with_capacity(data.len() + tag.len());
    combined.extend_from_slice(data.as_slice());
    combined.extend_from_slice(tag.as_slice());

    let decrypted = match cipher.decrypt(nonce, combined.as_slice()) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };

    match String::from_utf8(decrypted) {
        Ok(text) => Ok(Some(text)),
        Err(_) => Ok(None),
    }
}

fn decrypt_envelope(payload: &CryptoEnvelope, password: &str) -> Result<Option<String>, String> {
    let salt = match decode_b64(payload.salt.as_str()) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    let key = derive_key(password, salt.as_slice(), DEFAULT_PBKDF2_ITERATIONS);
    decrypt_envelope_with_key(payload, &key)
}

fn db_cache() -> &'static Mutex<DbCacheState> {
    static CACHE: OnceLock<Mutex<DbCacheState>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(DbCacheState::default()))
}

fn db_cache_key(password: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    let digest = hasher.finalize();
    encode_b64(digest.as_ref())
}

fn load_cached_db_value(password: &str) -> Option<serde_json::Value> {
    let cache_key = db_cache_key(password);
    let guard = db_cache().lock().ok()?;
    if guard.key.as_deref() == Some(cache_key.as_str()) {
        return guard.value.clone();
    }
    None
}

fn store_cached_db_value(password: &str, value: &serde_json::Value) {
    if let Ok(mut guard) = db_cache().lock() {
        let cache_key = db_cache_key(password);
        if guard.key.as_deref() != Some(cache_key.as_str()) {
            guard.db_salt = None;
            guard.db_key = None;
        }
        guard.key = Some(cache_key);
        guard.value = Some(value.clone());
    }
}

fn load_cached_db_crypto(password: &str) -> Option<(Vec<u8>, [u8; 32])> {
    let cache_key = db_cache_key(password);
    let guard = db_cache().lock().ok()?;
    if guard.key.as_deref() != Some(cache_key.as_str()) {
        return None;
    }
    let salt = guard.db_salt.clone()?;
    let key = guard.db_key?;
    Some((salt, key))
}

fn store_cached_db_crypto(password: &str, salt: &[u8], key: [u8; 32]) {
    if let Ok(mut guard) = db_cache().lock() {
        let cache_key = db_cache_key(password);
        if guard.key.as_deref() != Some(cache_key.as_str()) {
            guard.value = None;
        }
        guard.key = Some(cache_key);
        guard.db_salt = Some(salt.to_vec());
        guard.db_key = Some(key);
    }
}

fn db_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let root = storage_root_dir(app)?;
    Ok(root.join(DATA_FILE))
}

fn load_db_value(app: &AppHandle, password: &str) -> Result<serde_json::Value, String> {
    if let Some(cached) = load_cached_db_value(password) {
        return Ok(cached);
    }
    let path = db_file_path(app)?;
    if !path.exists() {
        let out = default_db_value();
        store_cached_db_value(password, &out);
        return Ok(out);
    }
    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let envelope: CryptoEnvelope = match serde_json::from_str(raw.as_str()) {
        Ok(value) => value,
        Err(_) => {
            let out = default_db_value();
            store_cached_db_value(password, &out);
            return Ok(out);
        }
    };
    let salt = match decode_b64(envelope.salt.as_str()) {
        Ok(value) if !value.is_empty() => value,
        _ => {
            let out = default_db_value();
            store_cached_db_value(password, &out);
            return Ok(out);
        }
    };
    let key = match load_cached_db_crypto(password) {
        Some((cached_salt, cached_key)) if cached_salt == salt => cached_key,
        _ => derive_key(password, salt.as_slice(), DEFAULT_PBKDF2_ITERATIONS),
    };
    let decrypted = match decrypt_envelope_with_key(&envelope, &key)? {
        Some(text) => text,
        None => {
            let out = default_db_value();
            store_cached_db_value(password, &out);
            return Ok(out);
        }
    };
    let parsed: serde_json::Value = match serde_json::from_str(decrypted.as_str()) {
        Ok(value) => value,
        Err(_) => {
            let out = default_db_value();
            store_cached_db_value(password, &out);
            return Ok(out);
        }
    };
    let out = ensure_db_shape_value(parsed);
    store_cached_db_value(password, &out);
    store_cached_db_crypto(password, salt.as_slice(), key);
    Ok(out)
}

fn save_db_value(app: &AppHandle, password: &str, value: &serde_json::Value) -> Result<(), String> {
    let path = db_file_path(app)?;
    let normalized = ensure_db_shape_value(value.clone());
    let plaintext = serde_json::to_string(&normalized).map_err(|err| err.to_string())?;
    let (salt, key) = if let Some((salt, key)) = load_cached_db_crypto(password) {
        (salt, key)
    } else if path.exists() {
        let mut resolved: Option<(Vec<u8>, [u8; 32])> = None;
        if let Ok(raw) = fs::read_to_string(path.as_path()) {
            if let Ok(envelope) = serde_json::from_str::<CryptoEnvelope>(raw.as_str()) {
                if let Ok(salt) = decode_b64(envelope.salt.as_str()) {
                    if !salt.is_empty() {
                        let key = derive_key(password, salt.as_slice(), DEFAULT_PBKDF2_ITERATIONS);
                        resolved = Some((salt, key));
                    }
                }
            }
        }
        match resolved {
            Some(value) => value,
            None => {
                let mut fresh_salt = [0u8; 16];
                OsRng.fill_bytes(&mut fresh_salt);
                let key = derive_key(password, &fresh_salt, DEFAULT_PBKDF2_ITERATIONS);
                (fresh_salt.to_vec(), key)
            }
        }
    } else {
        let mut fresh_salt = [0u8; 16];
        OsRng.fill_bytes(&mut fresh_salt);
        let key = derive_key(password, &fresh_salt, DEFAULT_PBKDF2_ITERATIONS);
        (fresh_salt.to_vec(), key)
    };
    let envelope = encrypt_text_with_key(plaintext.as_str(), salt.as_slice(), &key)?;
    let content = serde_json::to_string(&envelope).map_err(|err| err.to_string())?;
    write_text_file(path, content.as_str())?;
    store_cached_db_value(password, &normalized);
    store_cached_db_crypto(password, salt.as_slice(), key);
    Ok(())
}

fn default_db_value() -> serde_json::Value {
    json!({
        "version": DB_VERSION,
        "kanban": {
            "columns": [],
            "cards": [],
            "candidates": [],
        },
        "uniforms": [],
        "weekly": {},
        "todos": [],
        "recycle": {
            "items": [],
            "redo": [],
        },
    })
}

fn ensure_db_shape_value(value: serde_json::Value) -> serde_json::Value {
    if !value.is_object() {
        return default_db_value();
    }
    let mut out = value;
    let Some(obj) = out.as_object_mut() else {
        return default_db_value();
    };
    if !obj.get("version").is_some_and(|v| v.is_number()) {
        obj.insert("version".to_string(), json!(DB_VERSION));
    }
    if !obj.get("kanban").is_some_and(|v| v.is_object()) {
        obj.insert(
            "kanban".to_string(),
            json!({
                "columns": [],
                "cards": [],
                "candidates": [],
            }),
        );
    }
    if let Some(kanban) = obj.get_mut("kanban").and_then(|v| v.as_object_mut()) {
        if !kanban.get("columns").is_some_and(|v| v.is_array()) {
            kanban.insert("columns".to_string(), json!([]));
        }
        if !kanban.get("cards").is_some_and(|v| v.is_array()) {
            kanban.insert("cards".to_string(), json!([]));
        }
        if !kanban.get("candidates").is_some_and(|v| v.is_array()) {
            kanban.insert("candidates".to_string(), json!([]));
        }
    }
    if !obj.get("uniforms").is_some_and(|v| v.is_array()) {
        obj.insert("uniforms".to_string(), json!([]));
    }
    if !obj.get("weekly").is_some_and(|v| v.is_object()) {
        obj.insert("weekly".to_string(), json!({}));
    }
    if !obj.get("todos").is_some_and(|v| v.is_array()) {
        obj.insert("todos".to_string(), json!([]));
    }
    if !obj.get("recycle").is_some_and(|v| v.is_object()) {
        obj.insert(
            "recycle".to_string(),
            json!({
                "items": [],
                "redo": [],
            }),
        );
    }
    if let Some(recycle) = obj.get_mut("recycle").and_then(|v| v.as_object_mut()) {
        if !recycle.get("items").is_some_and(|v| v.is_array()) {
            recycle.insert("items".to_string(), json!([]));
        }
        if !recycle.get("redo").is_some_and(|v| v.is_array()) {
            recycle.insert("redo".to_string(), json!([]));
        }
    }
    out
}

fn table_display_name(table_id: &str) -> &'static str {
    match table_id {
        "kanban_columns" => "Kanban Columns",
        "kanban_cards" => "Kanban Cards",
        "candidate_data" => "Onboarding Candidate Data",
        "uniform_inventory" => "Uniform Inventory",
        "weekly_entries" => "Weekly Tracker Entries",
        "todos" => "Todos",
        _ => "Unknown",
    }
}

fn db_table_count(db: &serde_json::Value, table_id: &str) -> usize {
    match table_id {
        "kanban_columns" => db
            .get("kanban")
            .and_then(|v| v.get("columns"))
            .and_then(|v| v.as_array())
            .map(|rows| rows.len())
            .unwrap_or(0),
        "kanban_cards" => db
            .get("kanban")
            .and_then(|v| v.get("cards"))
            .and_then(|v| v.as_array())
            .map(|rows| rows.len())
            .unwrap_or(0),
        "candidate_data" => db
            .get("kanban")
            .and_then(|v| v.get("candidates"))
            .and_then(|v| v.as_array())
            .map(|rows| rows.len())
            .unwrap_or(0),
        "uniform_inventory" => db
            .get("uniforms")
            .and_then(|v| v.as_array())
            .map(|rows| rows.len())
            .unwrap_or(0),
        "weekly_entries" => db
            .get("weekly")
            .and_then(|v| v.as_object())
            .map(|weeks| {
                weeks
                    .values()
                    .map(|week| {
                        week.get("entries")
                            .and_then(|v| v.as_object())
                            .map(|entries| entries.len())
                            .unwrap_or(0)
                    })
                    .sum()
            })
            .unwrap_or(0),
        "todos" => db
            .get("todos")
            .and_then(|v| v.as_array())
            .map(|rows| rows.len())
            .unwrap_or(0),
        _ => 0,
    }
}

fn build_db_table(db: &serde_json::Value, table_id: &str) -> DbTableResult {
    match table_id {
        "kanban_columns" => DbTableResult {
            id: "kanban_columns".to_string(),
            name: table_display_name("kanban_columns").to_string(),
            columns: KANBAN_COLUMNS_COLUMNS
                .iter()
                .map(|v| (*v).to_string())
                .collect(),
            rows: build_kanban_columns_rows(db),
        },
        "kanban_cards" => DbTableResult {
            id: "kanban_cards".to_string(),
            name: table_display_name("kanban_cards").to_string(),
            columns: KANBAN_CARDS_COLUMNS
                .iter()
                .map(|v| (*v).to_string())
                .collect(),
            rows: build_kanban_cards_rows(db),
        },
        "candidate_data" => DbTableResult {
            id: "candidate_data".to_string(),
            name: table_display_name("candidate_data").to_string(),
            columns: CANDIDATE_FIELDS.iter().map(|v| (*v).to_string()).collect(),
            rows: build_candidate_rows(db),
        },
        "uniform_inventory" => DbTableResult {
            id: "uniform_inventory".to_string(),
            name: table_display_name("uniform_inventory").to_string(),
            columns: UNIFORM_COLUMNS.iter().map(|v| (*v).to_string()).collect(),
            rows: build_uniform_rows(db),
        },
        "weekly_entries" => DbTableResult {
            id: "weekly_entries".to_string(),
            name: table_display_name("weekly_entries").to_string(),
            columns: WEEKLY_COLUMNS.iter().map(|v| (*v).to_string()).collect(),
            rows: build_weekly_rows(db),
        },
        "todos" => DbTableResult {
            id: "todos".to_string(),
            name: table_display_name("todos").to_string(),
            columns: TODO_COLUMNS.iter().map(|v| (*v).to_string()).collect(),
            rows: build_todo_rows(db),
        },
        _ => DbTableResult {
            id: table_id.to_string(),
            name: "Unknown".to_string(),
            columns: Vec::new(),
            rows: Vec::new(),
        },
    }
}

fn build_kanban_columns_rows(db: &serde_json::Value) -> Vec<serde_json::Value> {
    let Some(columns) = db
        .get("kanban")
        .and_then(|v| v.get("columns"))
        .and_then(|v| v.as_array())
    else {
        return Vec::new();
    };
    columns
        .iter()
        .enumerate()
        .map(|(idx, col)| {
            let id = value_string(col, "id");
            let row_id = if id.is_empty() {
                format!("column-{}", idx + 1)
            } else {
                id.clone()
            };
            json!({
                "__rowId": row_id,
                "id": id,
                "name": value_string(col, "name"),
                "order": value_or_empty(col.get("order")),
                "created_at": value_or_empty(col.get("created_at")),
                "updated_at": value_or_empty(col.get("updated_at")),
            })
        })
        .collect()
}

fn build_kanban_cards_rows(db: &serde_json::Value) -> Vec<serde_json::Value> {
    let Some(cards) = db
        .get("kanban")
        .and_then(|v| v.get("cards"))
        .and_then(|v| v.as_array())
    else {
        return Vec::new();
    };
    cards
        .iter()
        .enumerate()
        .map(|(idx, card)| {
            let uuid = value_string(card, "uuid");
            let row_id = if uuid.is_empty() {
                format!("card-{}", idx + 1)
            } else {
                uuid.clone()
            };
            json!({
                "__rowId": row_id,
                "uuid": uuid,
                "candidate_name": value_string(card, "candidate_name"),
                "icims_id": value_string(card, "icims_id"),
                "employee_id": value_string(card, "employee_id"),
                "job_id": value_string(card, "job_id"),
                "req_id": value_string(card, "req_id"),
                "job_name": value_string(card, "job_name"),
                "job_location": value_string(card, "job_location"),
                "manager": value_string(card, "manager"),
                "branch": value_string(card, "branch"),
                "column_id": value_string(card, "column_id"),
                "order": value_or_empty(card.get("order")),
                "created_at": value_or_empty(card.get("created_at")),
                "updated_at": value_or_empty(card.get("updated_at")),
            })
        })
        .collect()
}

fn build_candidate_rows(db: &serde_json::Value) -> Vec<serde_json::Value> {
    let Some(candidates) = db
        .get("kanban")
        .and_then(|v| v.get("candidates"))
        .and_then(|v| v.as_array())
    else {
        return Vec::new();
    };
    candidates
        .iter()
        .enumerate()
        .map(|(idx, row)| {
            let row_id = nonempty_string(row.get("candidate UUID"))
                .or_else(|| nonempty_string(row.get("Candidate Name")))
                .unwrap_or_else(|| format!("candidate-{}", idx + 1));
            let mut out = serde_json::Map::new();
            out.insert("__rowId".to_string(), json!(row_id));
            for field in CANDIDATE_FIELDS {
                out.insert(field.to_string(), value_or_empty(row.get(field)));
            }
            serde_json::Value::Object(out)
        })
        .collect()
}

fn build_uniform_rows(db: &serde_json::Value) -> Vec<serde_json::Value> {
    let Some(uniforms) = db.get("uniforms").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut rows: Vec<serde_json::Value> = uniforms
        .iter()
        .enumerate()
        .map(|(idx, entry)| {
            let id = value_string(entry, "id");
            let row_id = if id.is_empty() {
                format!("uniform-{}", idx + 1)
            } else {
                id
            };
            let quantity = parse_nonnegative_integer(entry.get("quantity"));
            json!({
                "__rowId": row_id,
                "Alteration": value_string(entry, "alteration"),
                "Type": value_string(entry, "type"),
                "Size": value_string(entry, "size"),
                "Waist": value_string(entry, "waist"),
                "Inseam": value_string(entry, "inseam"),
                "Quantity": quantity.to_string(),
                "Branch": value_string(entry, "branch"),
            })
        })
        .collect();

    rows.sort_by(|a, b| {
        let abranch = row_string(a, "Branch");
        let bbranch = row_string(b, "Branch");
        abranch
            .cmp(&bbranch)
            .then(row_string(a, "Type").cmp(&row_string(b, "Type")))
            .then(row_string(a, "Alteration").cmp(&row_string(b, "Alteration")))
            .then(row_string(a, "Size").cmp(&row_string(b, "Size")))
    });
    rows
}

fn build_weekly_rows(db: &serde_json::Value) -> Vec<serde_json::Value> {
    let Some(weekly) = db.get("weekly").and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    let mut rows = Vec::new();
    for (week_key, week) in weekly {
        let week_start =
            nonempty_string(week.get("week_start")).unwrap_or_else(|| week_key.clone());
        let week_end = value_string(week, "week_end");
        if let Some(entries) = week.get("entries").and_then(|v| v.as_object()) {
            for (day, entry) in entries {
                rows.push(json!({
                    "__rowId": format!("{week_start}-{day}"),
                    "week_start": week_start.clone(),
                    "week_end": week_end.clone(),
                    "day": day,
                    "start": value_string(entry, "start"),
                    "end": value_string(entry, "end"),
                    "content": value_string(entry, "content"),
                }));
            }
        }
    }
    rows.sort_by(|a, b| {
        row_string(a, "week_start")
            .cmp(&row_string(b, "week_start"))
            .then(row_string(a, "day").cmp(&row_string(b, "day")))
    });
    rows
}

fn build_todo_rows(db: &serde_json::Value) -> Vec<serde_json::Value> {
    let Some(todos) = db.get("todos").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    todos
        .iter()
        .enumerate()
        .map(|(idx, todo)| {
            let id = value_string(todo, "id");
            let row_id = if id.is_empty() {
                format!("todo-{}", idx + 1)
            } else {
                id.clone()
            };
            json!({
                "__rowId": row_id,
                "id": id,
                "text": value_string(todo, "text"),
                "done": todo.get("done").and_then(|v| v.as_bool()).unwrap_or(false),
                "createdAt": value_or_empty(todo.get("createdAt")),
            })
        })
        .collect()
}

fn value_or_empty(value: Option<&serde_json::Value>) -> serde_json::Value {
    match value {
        Some(v) if !v.is_null() => v.clone(),
        _ => json!(""),
    }
}

fn value_string(value: &serde_json::Value, key: &str) -> String {
    nonempty_string(value.get(key)).unwrap_or_default()
}

fn row_string(value: &serde_json::Value, key: &str) -> String {
    nonempty_string(value.get(key)).unwrap_or_default()
}

fn nonempty_string(value: Option<&serde_json::Value>) -> Option<String> {
    let Some(value) = value else {
        return None;
    };
    if value.is_null() {
        return None;
    }
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    if let Some(number) = value.as_i64() {
        return Some(number.to_string());
    }
    if let Some(number) = value.as_u64() {
        return Some(number.to_string());
    }
    if let Some(number) = value.as_f64() {
        return Some(number.to_string());
    }
    if let Some(boolean) = value.as_bool() {
        return Some(boolean.to_string());
    }
    None
}

fn parse_nonnegative_integer(value: Option<&serde_json::Value>) -> i64 {
    let parsed = match value {
        Some(v) => {
            if let Some(number) = v.as_i64() {
                Some(number)
            } else if let Some(number) = v.as_u64() {
                Some(number as i64)
            } else if let Some(number) = v.as_f64() {
                Some(number.round() as i64)
            } else if let Some(text) = v.as_str() {
                text.trim().parse::<i64>().ok()
            } else {
                None
            }
        }
        None => None,
    };
    parsed.unwrap_or(0).max(0)
}

fn write_text_file(path: PathBuf, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::write(path, content).map_err(|err| err.to_string())?;
    Ok(())
}

fn path_has_storage_data(root: &Path) -> bool {
    storage_root_score(root) > 0
}

fn storage_root_score(root: &Path) -> i64 {
    if !root.exists() {
        return -1;
    }

    let mut score = 0_i64;
    let data_path = root.join(DATA_FILE);
    if data_path.is_file() {
        score += 50;
        if let Ok(meta) = fs::metadata(data_path) {
            // Prefer roots that appear to contain real historical data.
            score += ((meta.len() / 1024) as i64).min(10_000);
        }
    }
    if root.join(AUTH_FILE).is_file() {
        score += 10;
    }
    if root.join(META_FILE).is_file() {
        score += 20;
    }
    if root.join(EMAIL_TEMPLATES_FILE).is_file() {
        score += 5;
    }

    let dbs = root.join("dbs");
    if dbs.is_dir() {
        if let Ok(entries) = fs::read_dir(dbs) {
            let entry_count = entries.filter(|entry| entry.is_ok()).take(200).count() as i64;
            if entry_count > 0 {
                score += 100 + entry_count;
            }
        }
    }

    score
}

fn legacy_storage_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut push_unique = |path: PathBuf| {
        if !roots.iter().any(|existing| existing == &path) {
            roots.push(path);
        }
    };

    if let Ok(documents) = app.path().document_dir() {
        push_unique(documents.join("Workflow"));
    }
    if let Ok(config) = app.path().config_dir() {
        push_unique(config.join("workflow"));
        push_unique(config.join("Workflow"));
    }
    if let Ok(data) = app.path().data_dir() {
        push_unique(data.join("workflow"));
        push_unique(data.join("Workflow"));
    }
    if let Ok(home) = app.path().home_dir() {
        push_unique(home.join("Documents").join("Workflow"));
        push_unique(home.join(".config").join("workflow"));
        push_unique(home.join(".config").join("Workflow"));
        push_unique(home.join(".local").join("share").join("workflow"));
        push_unique(home.join(".local").join("share").join("Workflow"));
        push_unique(
            home.join("Library")
                .join("Application Support")
                .join("Workflow"),
        );
        push_unique(home.join("AppData").join("Roaming").join("Workflow"));
    }

    roots
}

fn storage_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    static RESOLVED_ROOT: OnceLock<PathBuf> = OnceLock::new();
    if let Some(root) = RESOLVED_ROOT.get() {
        return Ok(root.clone());
    }

    let base = app.path().app_data_dir().map_err(|err| err.to_string())?;
    let default_root = base.join("Workflow");
    fs::create_dir_all(default_root.as_path()).map_err(|err| err.to_string())?;

    let mut resolved = default_root.clone();
    let mut best_score = storage_root_score(default_root.as_path());
    for legacy in legacy_storage_roots(app) {
        if legacy == default_root || !path_has_storage_data(legacy.as_path()) {
            continue;
        }
        let score = storage_root_score(legacy.as_path());
        if score > best_score {
            best_score = score;
            resolved = legacy;
        }
    }

    fs::create_dir_all(resolved.as_path()).map_err(|err| err.to_string())?;
    let _ = RESOLVED_ROOT.set(resolved.clone());
    Ok(resolved)
}

fn sanitize_relative_path(value: &str) -> Result<PathBuf, String> {
    let mut out = PathBuf::new();
    for component in PathBuf::from(value).components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return Err("Invalid storage path.".to_string()),
        }
    }
    if out.as_os_str().is_empty() {
        return Err("Invalid storage path.".to_string());
    }
    Ok(out)
}

fn sanitize_filename(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    let trimmed = out.trim_matches('_');
    if trimmed.is_empty() {
        "workflow-export.csv".to_string()
    } else {
        trimmed.to_string()
    }
}

fn sanitize_export_filename(value: &str) -> String {
    let trimmed = clamp_string(value, 255, true);
    let safe = sanitize_filename(trimmed.as_str());
    if safe.to_lowercase().ends_with(".csv") {
        safe
    } else {
        format!("{safe}.csv")
    }
}

fn sanitize_export_columns(value: &serde_json::Value) -> Vec<String> {
    value
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|entry| clamp_string(value_ref_string(Some(entry)).as_str(), 80, false))
        .filter(|entry| !entry.is_empty() && entry != "__rowId")
        .collect()
}

fn should_neutralize_csv(value: &str) -> bool {
    let trimmed = value.trim_start();
    if trimmed.is_empty() || trimmed.starts_with('\'') {
        return false;
    }
    matches!(
        trimmed.chars().next(),
        Some('=') | Some('+') | Some('-') | Some('@')
    )
}

fn neutralize_csv_formula(value: &str) -> String {
    if should_neutralize_csv(value) {
        format!("'{value}")
    } else {
        value.to_string()
    }
}

fn csv_escape(value: &str) -> String {
    let safe = neutralize_csv_formula(value);
    if safe.contains(',') || safe.contains('"') || safe.contains('\n') || safe.contains('\r') {
        format!("\"{}\"", safe.replace('"', "\"\""))
    } else {
        safe
    }
}

fn js_like_value_string(value: Option<&serde_json::Value>) -> String {
    match value {
        Some(serde_json::Value::Null) | None => String::new(),
        Some(serde_json::Value::String(text)) => text.clone(),
        Some(serde_json::Value::Number(number)) => number.to_string(),
        Some(serde_json::Value::Bool(boolean)) => boolean.to_string(),
        Some(serde_json::Value::Array(items)) => items
            .iter()
            .map(|entry| js_like_value_string(Some(entry)))
            .collect::<Vec<_>>()
            .join(","),
        Some(serde_json::Value::Object(_)) => "[object Object]".to_string(),
    }
}

fn rows_to_csv(columns: &[String], rows: &[serde_json::Value]) -> String {
    let mut lines: Vec<String> = Vec::new();
    if !columns.is_empty() {
        lines.push(
            columns
                .iter()
                .map(|col| csv_escape(col.as_str()))
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    for row in rows {
        let line = columns
            .iter()
            .map(|column| {
                let value = row.as_object().and_then(|obj| obj.get(column));
                csv_escape(js_like_value_string(value).as_str())
            })
            .collect::<Vec<_>>()
            .join(",");
        lines.push(line);
    }
    lines.join("\n")
}

fn derive_key(password: &str, salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, iterations, &mut key);
    key
}

fn decode_b64(value: &str) -> Result<Vec<u8>, String> {
    B64.decode(value).map_err(|err| err.to_string())
}

fn encode_b64(bytes: &[u8]) -> String {
    B64.encode(bytes)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            app_version,
            platform_name,
            setup_status,
            setup_complete,
            donation_preference,
            biometric_status,
            biometric_enable,
            biometric_disable,
            biometric_unlock,
            donate,
            clipboard_write,
            open_external,
            open_email_draft,
            window_minimize,
            window_maximize,
            window_unmaximize,
            window_toggle_maximize,
            window_is_maximized,
            window_close,
            pick_text_file,
            save_csv_file,
            db_export_csv,
            storage_info,
            storage_read_text,
            storage_write_text,
            storage_read_json,
            storage_write_json,
            storage_read_encrypted_json,
            storage_write_encrypted_json,
            db_todos_get,
            db_dashboard_get,
            db_todos_set,
            db_weekly_get,
            db_weekly_set,
            db_weekly_summary,
            db_weekly_summary_save,
            email_templates_get,
            email_templates_set,
            db_list_tables,
            db_get_table,
            db_sources_get,
            db_set_source,
            db_list_tables_source,
            db_get_table_source,
            db_import_apply,
            db_kanban_get,
            db_kanban_add_column,
            db_kanban_remove_column,
            db_kanban_add_card,
            db_kanban_update_card,
            db_pii_get,
            db_pii_save,
            db_kanban_process_candidate,
            db_kanban_remove_candidate,
            db_kanban_reorder_column,
            db_uniforms_add_item,
            db_delete_rows,
            db_validate_current,
            db_recycle_undo,
            db_recycle_redo,
            auth_read,
            auth_setup,
            auth_verify,
            auth_change,
            crypto_hash_password,
            crypto_encrypt_json,
            crypto_decrypt_json
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Workflow Tracker");
}
