# Workflow Tracker User Manual

Tip: Press `CTRL+F` (or `CMD+F` on macOS) to find anything quickly. You can also paste this manual into an AI and ask it to summarize or answer questions.

## What This App Is
Workflow Tracker is a local-first onboarding tracker with a Kanban dashboard, a searchable database view, weekly tracker, and a todo list. It stores data only on your device unless you choose to sync the folder with a third-party tool.

This app was built almost entirely with AI. The source lives on GitHub (link to be added).

## Data and Security
- All data is stored locally and encrypted with your program password.
- No servers are used by default.
- Android biometrics can unlock the app, but destructive actions still require your real password.
- Backups are your responsibility. See `docs/BACKUP_RESTORE.md`.

## Navigation
- **Dashboard**: Main Kanban board.
- **Database**: Read-only data view with export and import tools.
- **Settings**: Password changes, donation options, and other preferences.
- **Sidebar**: Open/close with the menu button or a swipe gesture on mobile.

## Dashboard (Kanban)
- Add columns with `Add Column`.
- Create candidates inside columns.
- Drag cards between columns.
- Open a candidate to view details in the right-side drawer.
- Use `Process Candidate` for status transitions.
- Undo/redo is available for destructive actions like deletes.

## Weekly Tracker
- Open from the top bar.
- Track start/end times and daily notes.
- The summary can be exported as a Markdown report.

## Todo List
- Add and complete tasks.
- Completed todos can be pushed into the weekly tracker.

## Database Screen
- Search and filter the current table.
- Export to CSV.
- Import databases to view, append, or replace.
- Imported databases are **read-only**.
- Use the database selector dropdown to switch between sources.

### Import Actions
- **Add / Append**: Merges compatible data into your current database and stores the import for read-only viewing.
- **View Only**: Imports a database for read-only viewing without changing your current data.
- **Replace Current**: Overwrites your current database with the imported one.

Before any import, you will see a warning modal. If you proceed, you must enter your password again. Biometrics are intentionally disabled for this step.

If the import file fails validation or looks unsafe, the app will block it.

## Android Notes
- Data is stored in `Documents/Workflow` when possible.
- The app can fall back to app-only storage if the Documents folder is unavailable.
- Biometrics are supported for sign-in.
- The sidebar menu supports swipe-to-open on mobile.

## Donations
- Donations are optional and do not unlock features.
- If you donate, you are donating to the developer, not the AI.

## Support
- GitHub issues page: link to be added.
- For local troubleshooting, start with `docs/BACKUP_RESTORE.md`.

## Database Structure (High Level)
The encrypted database contains a JSON structure with these main sections:
- `kanban`: Columns, cards, and candidate rows.
- `weekly`: Weekly tracker entries keyed by week start date.
- `todos`: Todo list entries.
- `recycle`: Undo/redo history.

This structure is validated during imports to prevent corrupted or unsafe data.
