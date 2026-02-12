# Backup and Restore Guide

This app stores data locally and encrypts it with your program password. Backups are just copies of the encrypted database files and can be restored by placing them back into the app's data folder.

## Quick Tips
- Always close the app before copying or replacing database files.
- Keep backups in a separate folder or drive.
- If you sync with tools like Syncthing or Google Drive, avoid opening the app on two devices at the same time.

## Where Your Data Lives

Desktop (Electron):
- The app stores data in the OS user data folder for the app.
- The primary database file is `workflow.enc`.
- Imported view-only databases are stored in `dbs/`.
- Metadata (import list, active database) is stored in `meta.json`.

Typical locations (your path may vary based on install name):
- Windows: `%APPDATA%\\Workflow` or `%APPDATA%\\Workflow Tracker`
- macOS: `~/Library/Application Support/Workflow` or `~/Library/Application Support/Workflow Tracker`
- Linux: `~/.config/Workflow` or `~/.config/Workflow Tracker`

If you are unsure, search your drive for `workflow.enc`.

Android:
- Primary location: `Documents/Workflow`
- If the app falls back to app-only storage, the folder will be under the app's private data directory. In that case, the setup screen will warn you.

## How to Back Up
1. Close the app.
2. Copy these items to a safe location.

- `workflow.enc`
- `meta.json`
- `dbs/` (folder)
3. Keep at least one backup on a different drive or cloud storage.

## How to Restore
1. Close the app.
2. Copy your backup files back into the app's data folder.
3. Make sure `workflow.enc` is present (this is your active database).
4. Relaunch the app and sign in.

## Manual Replace (Advanced)
If you intentionally want to replace the active database outside the app:
1. Close the app.
2. Place the encrypted database you want to use in the data folder.
3. Rename it to `workflow.enc` (overwrite the existing file if needed).
4. Relaunch the app and sign in.

Note: This bypasses in-app validation, so only do this if you know the file is valid and trusted.
