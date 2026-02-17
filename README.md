# Workflow Tracker

Workflow Tracker is a local-first onboarding tracker built with Electron (desktop) and Capacitor (Android). It combines a Kanban dashboard, searchable database tools, weekly tracking, todos, and encrypted local data storage.

Current app version: `1.0.0`

## Key Features
- Kanban dashboard for candidate flow management.
- Candidate detail drawer with process actions and recycle/undo support.
- Encrypted local database with password-based authentication.
- Employee Databases page with search, import modes, and CSV export.
- Uniforms Database page with branch-aware inventory tracking and row management.
- Candidate PII uniform issuance flow that records issued items and deducts inventory on process.
- Email Template Generator with auto-refresh from DB context and "Update Info" draft refresh.
- Email Template Dashboard for editing template defaults and custom template definitions.
- Send Email action directly from Employee Databases rows.
- Weekly tracker with summary output.
- Todo list that can feed weekly notes.
- In-app Help & Feedback page with:
  - manual picker
  - modal manual reader
  - table of contents
  - search within manuals
  - GitHub feedback link and issue submission tips

## Recent Changes (February 10-17, 2026)
- Tagged and shipped the `1.0` desktop release baseline.
- Completed a major UI overhaul with Kanban/dashboard layout restoration.
- Refined database integration and import flow behavior across add/view/replace paths.
- Split database tooling into dedicated Employee Databases and Uniforms Database pages.
- Added branch-based uniform inventory schema (`Alteration`, `Type`, `Size`, `Waist`, `Inseam`, `Quantity`, `Branch`).
- Added conditional uniform add modal logic by garment type (shirt vs pants).
- Added required branch handling during processing and inventory deduction at process time.
- Added issued uniform capture in PII and persistence in employee data rows.
- Added email template generation directly in onboarding and from Employee Databases via Send Email.
- Added template types including NEO Summary and CORI, with editable defaults in Email Template Dashboard.
- Added periodic email modal context refresh so drafts can stay aligned with latest stored candidate data.
- Added Android sync updates and mobile interaction improvements (including sidebar swipe behavior).
- Added lint/format tooling and cleaned frontend event wiring for maintainability.
- Replaced the old manuals screen with a full `Help & Feedback` page.
- Added in-app manual modal with live search and left-side table of contents.
- Added issue-reporting guidance directly in the feedback card.
- Added `Current App Version` display in Help & Feedback.
- Centered and compacted Help and Settings layouts to reduce wasted space.
- Updated app branding to the new Option C logo across app/web/electron assets.
- Fixed Linux AppImage taskbar icon behavior via packaging icon/WMClass updates.
- Stabilized dashboard topbar scroll behavior and cleaned up frontend wiring.
- Continued security hardening and import validation improvements.

## Getting Started (Desktop)

Prerequisites:
- Node.js 20+ (recommended)
- npm

Install dependencies:

```bash
npm install
```

Run in development:

```bash
npm start
```

Run lint checks:

```bash
npm run lint
```

## Build Distributables

Build all configured targets:

```bash
npm run dist
```

Linux AppImage build:

```bash
npm run dist:linux
```

Windows build:

```bash
npm run dist:win
```

## Android

Android support is provided through Capacitor.

```bash
npm run cap:android
npm run cap:sync
```

Detailed Android setup: `docs/android.md`

## Documentation
- User manual: `docs/USER_MANUAL.md`
- Backup and restore guide: `docs/BACKUP_RESTORE.md`
- Contributing and issue conventions: `CONTRIBUTING.md`
- Security checklist: `SECURITY.md`

## Feedback and Issues
- GitHub issues: <https://github.com/davidcit646/Workflow/issues>
- Repository: <https://github.com/davidcit646/Workflow>

When reporting a bug, include:
- app version
- OS/platform
- clear reproduction steps
- expected vs actual behavior
- screenshots/logs with sensitive data removed

## License

MIT (`LICENSE` if present in this repo, otherwise `package.json` license field).
