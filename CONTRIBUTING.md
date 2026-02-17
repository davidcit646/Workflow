# Contributing to Workflow Tracker

Thanks for helping improve Workflow Tracker.

Repository: <https://github.com/davidcit646/Workflow>  
Issue tracker: <https://github.com/davidcit646/Workflow/issues>

## Report an Issue (Step by Step)
1. Open the issues page: <https://github.com/davidcit646/Workflow/issues>.
2. Search existing issues first using keywords from your problem.
3. If no match exists, click `New issue`.
4. Use a clear title, for example:
   - `[Bug] Import fails when replacing current database`
   - `[Feature] Add filter chips to Database page`
5. Add the core details:
   - App version (from Help & Feedback page)
   - Platform/OS (Windows/Linux/Android + version)
   - Exact steps to reproduce (numbered)
   - Expected result
   - Actual result
6. Attach screenshots/log output if helpful.
7. Remove sensitive data (passwords, PII, tokens, IDs) before posting.
8. Submit the issue and monitor notifications for follow-up questions.

## Issue Conventions
- One issue per bug or feature request.
- Keep titles specific and action-oriented.
- Prefer reproducible reports over broad summaries.
- Include impact (how often it happens, who it affects, blocker/non-blocker).
- If possible, include regression info:
  - Last known working version
  - First version where the issue appears

## Contributing Code (Basic Flow)
1. Fork the repo and create a branch:
   - `fix/<short-description>`
   - `feat/<short-description>`
2. Install dependencies:

```bash
npm install
```

3. Make focused changes (avoid unrelated refactors in the same PR).
4. Run lint:

```bash
npm run lint
```

5. Build or run locally as needed:

```bash
npm start
```

6. Open a pull request that includes:
   - What changed
   - Why it changed
   - How it was tested
   - Related issue link (if applicable)

## Pull Request Conventions
- Keep PRs small enough to review quickly.
- Reference issues with `Closes #<issue-number>` when appropriate.
- Include UI screenshots for visual changes.
- Note any migration or manual verification steps.

## Security Reports

For security-sensitive issues, review `SECURITY.md` before public disclosure.
