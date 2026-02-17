# Workflow Tracker User Manual

Tip: Press `CTRL+F` (or `CMD+F` on macOS) to find anything quickly. You can also paste this manual into an AI and ask it to summarize or answer questions.

## What This App Is
Workflow Tracker is a local-first onboarding tracker with a Kanban dashboard, employee records, branch-based uniform inventory, email template tooling, weekly tracker, and a todo list. It stores data only on your device unless you choose to sync the folder with a third-party tool.

This app was built almost entirely with AI. The source lives on GitHub: <https://github.com/davidcit646/Workflow>.

## Data and Security
- All data is stored locally and encrypted with your program password.
- No servers are used by default.
- Android biometrics can unlock the app, but destructive actions still require your real password.
- Backups are your responsibility. See the Backup & Restore guide: <https://github.com/davidcit646/Workflow/blob/main/docs/BACKUP_RESTORE.md>.

## Navigation
- **Dashboard**: Main Kanban board.
- **Employee Databases**: Employee/candidate row data with search, export, import, and Send Email actions.
- **Uniforms Database**: Uniform inventory table and add/delete/export actions.
- **Email Template Dashboard**: Edit built-in templates and add custom templates.
- **Help & Feedback**: Read manuals and submit issue reports.
- **About**: App details and credits.
- **Settings**: Password changes, donation options, and other preferences.
- **Sidebar**: Open/close with the menu button or a swipe gesture on mobile.

## Dashboard (Kanban)
- Add columns with `Add Column`.
- Create candidates inside columns.
- Drag cards between columns.
- Open a candidate to view details in the right-side drawer.
- Use drawer quick actions:
  - `Basic Info` to edit card/header data.
  - `PII` to edit onboarding and uniform fields.
  - `Email Template` to open email generation for that candidate.
- Use `Process Candidate` for status transitions.
- Undo/redo is available for destructive actions like deletes.

## Candidate Basic Info
- Add/edit candidate identity and card fields, including:
  - candidate name
  - ICIMS ID
  - employee ID
  - job ID
  - REQ ID
  - manager, location, branch, phone, email
- `REQ ID` is separate from `Job ID Name` and is tracked independently for email templates and reporting.

## PII + Uniform Issuance
- Uniform issuance is optional in PII.
- When `Issued Uniforms` is enabled, the form tracks:
  - actual reported uniform size (`Shirt Size`, `Waist`, `Inseam`)
  - issued uniform details (`Issued Shirt Size`, `Issued Waist`, `Issued Inseam`, type/alteration, quantity)
- Shirt and pants selections are inventory-aware where applicable.
- Processing a candidate saves issued uniform details into employee rows and deducts matching inventory from the selected branch.

## Weekly Tracker
- Open from the top bar.
- Track start/end times and daily notes.
- The summary can be exported as a Markdown report.

## Todo List
- Add and complete tasks.
- Completed todos can be pushed into the weekly tracker.

## Employee Databases
- Search and filter rows.
- Export to CSV.
- Import databases to view, append, or replace.
- Imported databases are **read-only**.
- Use the database selector dropdown to switch between sources.
- Select one row and use `Send Email` to open the Email Template Generator prefilled from that employee row.
- If a selected row has no email, the app prompts to add one and validates the entry before saving.

### Import Actions
- **Add / Append**: Merges compatible data into your current database and stores the import for read-only viewing.
- **View Only**: Imports a database for read-only viewing without changing your current data.
- **Replace Current**: Overwrites your current database with the imported one.

Before any import, you will see a warning modal. If you proceed, you must enter your password again. Biometrics are intentionally disabled for this step.

If the import file fails validation or looks unsafe, the app will block it.

## Uniforms Database
- Uniform inventory is stored in one table with these columns:
  - `Alteration`
  - `Type`
  - `Size`
  - `Waist`
  - `Inseam`
  - `Quantity`
  - `Branch`
- Use the green `Add Uniform` button to add inventory rows.
- Modal fields are garment-aware:
  - `Type = Shirt`: uses shirt size (XM to 6XL) and optional alteration text.
  - `Type = Pants`: uses numeric waist/inseam and optional alteration text.
- Branch is required so inventory can be deducted from the correct location during candidate processing.

## Email Template Generator
- Can be opened from:
  - candidate drawer (`Email Template`)
  - Employee Databases (`Send Email`)
- Template types include NEO Summary, CORI template, edge links templates, and follow-up templates.
- `Update Info` refreshes subject/body using latest DB values.
- While open, the modal also auto-refreshes candidate context from DB on an interval.
- `Copy` copies To/CC/Subject/Body in a ready-to-paste format.

## Email Template Dashboard
- Select a template type to view/edit:
  - default `To`, `CC`, `Subject`, and `Body`
- Save changes so templates are no longer hard-coded.
- Add custom template names and persist them.
- Reset templates if you need to return to defaults.

## Android Notes
- Data is stored in `Documents/Workflow` when possible.
- The app can fall back to app-only storage if the Documents folder is unavailable.
- Biometrics are supported for sign-in.
- The sidebar menu supports swipe-to-open on mobile.

## Donations
- Donations are optional and do not unlock features.
- If you donate, you are donating to the developer, not the AI.

## Support
- GitHub issues page: <https://github.com/davidcit646/Workflow/issues>.
- Contributing and issue conventions: <https://github.com/davidcit646/Workflow/blob/main/CONTRIBUTING.md>.
- For local troubleshooting, start with the Backup & Restore guide: <https://github.com/davidcit646/Workflow/blob/main/docs/BACKUP_RESTORE.md>.

## Database Structure (High Level)
The encrypted database contains a JSON structure with these main sections:
- `kanban`: Columns, cards, and candidate rows.
- `uniforms`: Branch-based uniform inventory rows.
- `weekly`: Weekly tracker entries keyed by week start date.
- `todos`: Todo list entries.
- `recycle`: Undo/redo history.

This structure is validated during imports to prevent corrupted or unsafe data.
