# Errors README

This file lists user-facing error and warning text currently present in the app code.

Source snapshot used:
- `web/app.js`
- `web/app/local-api.js`
- `src-tauri/src/main.rs`

Notes:
- Some messages include dynamic values like candidate name, branch, size, or retry seconds.
- Some dialogs display backend error text directly as a detail line.
- Wording can change between app versions; this list documents the current source.

## Startup, Authentication, and Password
- `Missing password` -> `Enter your program password.`
- `Authentication unavailable` -> `Unable to check auth status.`
- `Too Many Attempts` -> `Try again in {N}s.` or `Please wait and try again.`
- `Authentication failed` -> `Invalid password.` (or backend error text) plus optional `Try again in {N}s.`
- `Authentication failed` -> `Unable to complete sign-in.`
- `Error` -> `Unable to authenticate.`
- `Authentication unavailable` -> `Required auth APIs are not available.`
- `Missing fields` -> `Please enter current and new password.`
- `Mismatch` -> `New password and confirmation do not match.`
- `Error` (change password flow) -> `{backend error}` plus optional retry text.
- `Updated` -> `Password changed successfully.`
- `Startup error` -> `The app failed to initialize correctly.`
- `Error` -> `Native desktop bridge is unavailable.`

Auth inline errors (not modal):
- `Enter your program password.`
- `Authentication bridge unavailable.`
- `Invalid password.`
- `Unable to complete sign-in.`
- `Unable to authenticate.`

## Biometrics
- `Biometrics Unavailable` -> `No biometric hardware detected.`
- `Biometric Failed` -> backend error or `Unable to authenticate with biometrics.`
- `Unable to Disable` -> backend error or `Unable to disable biometrics.`
- `Unable to Enable` -> backend error or `Unable to enable biometrics.`
- Button state text can show `Biometrics unavailable`.

## Kanban and Candidate Actions
- `Details Unavailable` -> `Unable to load candidate details. Please fully quit and relaunch the app.`
- `Invalid Format` -> `Neo Scheduled Date must be in MM/DD/YYYY format.`
- `Save Failed` -> `Unable to save Neo Scheduled Date. Please fully quit and relaunch the app.`
- `Invalid Time` -> `Enter arrival and departure time as 4 digits in 24H format (e.g., 0824).`
- `Missing Branch` -> `Branch is required when processing a candidate.`
- `Missing Column` -> `Select a column before adding a candidate.`
- `Missing Name` -> `Candidate Name is required.`
- `Invalid Format` -> `Contact Phone must be in 123-123-1234 format.`
- `Invalid Email` -> `Please enter a valid email address.`
- `Unable to add column. Please try again.`
- `Unable to delete column.`
- `Unable to update candidate.`
- `Unable to add candidate.`
- `Unable to process candidate. Please fully quit and relaunch the app.`
- `Unable to remove candidate. Please fully quit and relaunch the app.`

## PII Validation and Uniform Issuance
- `PII Unavailable` -> `PII handlers are not available. Please fully quit and relaunch the app.`
- `Invalid Format` -> `{field} must be in 123-123-1234 format.`
- `Invalid Format` -> `{field} must be in MM/DD/YY or MM/DD/YYYY format.`
- `Invalid Routing Number` -> `Routing Number must be 9 digits or fewer.`
- `Invalid Account Number` -> `Account Number must be 20 digits or fewer.`
- `Missing Dates` -> `DOB and EXP are required for the selected ID Type.`
- `Missing ID Type` -> `Other ID Type is required when ID Type is Other.`
- `Invalid Format` -> `Social must be in 123-45-6789 format.`
- `Invalid State` -> `State Abbreviation must be 2 letters.`
- `Invalid Shirt Size` -> `Shirt Size must be selected from the dropdown.`
- `Invalid Waist` -> `Waist must be selected from the dropdown.`
- `Invalid Inseam` -> `Inseam must be selected from the dropdown.`
- `Invalid Issued Shirt Size` -> `Issued Shirt Size must be selected from the dropdown.`
- `Invalid Issued Waist` -> `Issued Waist must be selected from the dropdown.`
- `Invalid Issued Inseam` -> `Issued Inseam must be selected from the dropdown.`
- `Invalid Shirts Given` -> `Issued Shirts Given must be selected as a number from 1 to 4.`
- `Invalid Pants Given` -> `Issued Pants Given must be selected as a number from 1 to 4.`
- `Invalid Pants Type` -> `Issued Pants Type must match available pants inventory.`
- `Invalid Shirt Type` -> `Issued Shirt Type(s) must match available shirt inventory.`
- `Invalid Uniform Status` -> `Uniforms Issued must come from the checkbox.`
- `Missing Uniform Counts` -> `Select Issued Shirts Given and/or Issued Pants Given when Uniforms Issued is checked.`
- `Missing Issued Shirt Size` -> `Select Issued Shirt Size when shirts are issued.`
- `No Shirts Available` -> `No shirts to give out.` or `No shirts to give out for {branch}.`
- `Missing Shirt Type` -> `Select one or more Issued Shirt Type(s).`
- `Missing Issued Pants Size` -> `Select Issued Waist and Issued Inseam when pants are issued.`
- `No Pants Available` -> `No pants to give out for {branch} in {waist}x{inseam}.`
- `Missing Pants Type` -> `Select Issued Pants Type when pants are issued.`
- `Save Failed` -> `Unable to save PII. Please fully quit and relaunch the app.`
- `Pre Neo Save Failed` -> `Candidate was saved, but Pre Neo fields could not be saved. Reopen Basic Info and try again.`

## Employee Database and Send Email
- `Database Unavailable` -> `Database handlers are not available. Please fully quit and relaunch the app.`
- `Read-only Database` -> `Imported databases are view-only. Switch back to the current database to delete rows.`
- `Unable to delete rows. Please fully quit and relaunch the app.`
- `Nothing to Export` -> `There are no rows to export for the current table.`
- `Export Failed` -> backend message or `Unable to export CSV.`
- `Export Failed` -> `Unable to export CSV. Please fully quit and relaunch the app.`
- `Unavailable` -> `Send Email is available only for the Employee candidate_data table.`
- `Selection Required` -> `Select one employee row first.`
- `Single Row Required` -> `Select only one employee row to send an email.`
- `Read-only Database` -> `This row is in a read-only database source. Switch to Current Database to add an email.`
- `Invalid Email` -> `Email is required.`
- `Invalid Email` -> `Email is too long.`
- `Invalid Email` -> `Email contains invalid control characters.`
- `Invalid Email` -> `Enter a single email address only.`
- `Invalid Email` -> `Please enter a valid email address.`
- `Update Failed` -> saved error or `Unable to save candidate email.`
- Backend email-save error -> `No candidate row selected.`
- Backend email-save error -> `This database source is read-only. Switch to Current Database to edit email.`
- Backend email-save error -> `Unable to locate candidate UUID for the selected row.`

## Uniform Inventory Page
- `Uniforms Unavailable` -> `Uniform database handlers are not available. Please fully quit and relaunch the app.`
- `Missing Fields` -> `Alteration, Type, and Branch are required.`
- `Missing Shirt Size` -> `Select a shirt size from the dropdown.`
- `Missing Pants Size` -> `Waist and Inseam are required for pants.`
- `Invalid Type` -> `Type must be Shirt or Pants.`
- `Invalid Quantity` -> `Quantity must be a number greater than 0.`
- `Save Failed` -> `Unable to add uniform inventory. Please fully quit and relaunch the app.`
- `Save Failed` -> backend error or `Unable to add uniform inventory.`
- `Unable to delete uniform rows. Please fully quit and relaunch the app.`
- `Nothing to Export` -> `There are no uniform rows to export.`
- `Export Failed` -> backend message or `Unable to export CSV.`
- `Export Failed` -> `Unable to export CSV. Please fully quit and relaunch the app.`

## Undo and Redo
- `Undo Failed` -> backend error or `Unable to restore.`
- `Redo Failed` -> backend error or `Unable to redo.`

## Email Template Dashboard
- `Nothing to Copy` -> `Click Update Info or enter an email template first.`
- `Copy Failed` -> `Unable to copy template to clipboard.`
- `Nothing to Send` -> `Click Update Info or enter an email template first.`
- `Token Name Required` -> `Enter a valid token name.`
- `Token Value Required` -> `Enter a token value.`
- `Save Failed` -> `Unable to save the token.`
- `Save Failed` -> `Unable to remove the token.`
- `Save Failed` -> `Unable to save email template settings.`
- `Delete Failed` -> `Unable to delete template settings.`
- `Template Name Required` -> `Enter a name to create a template.`
- `Template Error` -> `Unable to create a unique template ID.`
- `Save Failed` -> `Unable to create the new template.`

## Help and Manual Loading
- `Manual Unavailable` -> `Unable to load {manual label}. Please verify the manual files are present.`

## Database Import and Integrity Warnings
- `Unavailable` -> `Database import is not available.`
- `Import Failed` -> picker error or `Unable to open the import file.`
- `Invalid Password` -> backend error or `Password is incorrect.`
- `WARNING FROM THE DEV` -> `This database looks fraudulent or unsafe. We refused to import it to protect your data.`
- `WARNING FROM THE DEV` detail fallback -> `If you can’t figure out how to fix it manually, you probably shouldn’t.`
- `WARNING` -> `We won't import this database because it's broken. From the dev: Shit's broke.`
- `WARNING` detail fallback -> `Fix the file and try again.`
- `Database Integrity Warning` -> `Your current database failed the integrity check. Some data may be corrupt or unsafe.`
- `Database Integrity Warning` detail fallback -> `Please restore from a backup before continuing.`

Backend validation detail messages that can appear in import/integrity flows:
- `Database payload is not an object.`
- `Database version is newer than this app supports.`
- `Kanban data is missing or invalid.`
- `Kanban columns are missing.`
- `Kanban cards are missing.`
- `Candidate rows are missing.`
- `Uniform inventory is invalid.`
- `Weekly data is invalid.`
- `Todo data is invalid.`
- `Recycle data is invalid.`
- `Column IDs are invalid.`
- `Card IDs are invalid.`
- `Card column references are invalid.`
- `Candidate UUIDs are missing.`

Other backend import/database errors that can surface:
- `Import file is not valid JSON.`
- `Unable to decrypt the import file.`
- `Invalid import action.`
- `Invalid password.`
- `Column name is required.`
- `Invalid column.`
- `Invalid table.`
- `Nothing to undo.`
- `Nothing to redo.`
- `Unable to restore.`
- `Unable to redo.`
- `Please remove candidate cards from the last remaining column before deleting it.`
- `Missing candidate.`
- `Candidate not found.`
- `Branch is required.`
- `Invalid time format. Use 4-digit 24H time.`
- `Alteration, type, and branch are required.`
- `Shirt size is required for shirt inventory.`
- `Waist and inseam are required for pants inventory.`
- `Quantity must be greater than 0.`
- `Unable to add uniform inventory.`

## Local API Fallback Messages
These are fallback strings in `web/app/local-api.js` and may surface when native bridges fail:
- `Auth unavailable.`
- `Biometrics unavailable.`
- `Too many attempts`
- `Password is required.`
- `Missing password.`
- `Missing column.`
- `Missing candidate.`
- `Read-only database.`
- `Export unavailable.`
- `Export failed.`
- `Import unavailable.`
- `Validation unavailable.`
- `Billing unavailable.`
- `Unable to configure authentication.`
- `Unable to process candidate.`
- `Unable to save email.`

## Legacy and Build-Variant Messages
- `Candidate data columns do not match this app.` can appear in some builds during integrity/schema checks.
