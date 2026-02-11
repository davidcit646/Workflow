# Security Checklist

- Keep `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false` in all BrowserWindows.
- Block untrusted navigation and `window.open`; only allow `file://` internally and open external links via `shell.openExternal`.
- Maintain a restrictive CSP in `web/index.html` (no remote scripts/styles by default).
- Store auth and data files with restrictive permissions (`0600` where supported).
- Neutralize CSV formula injection before writing exports.
- Use parameterized SQL queries only; avoid string interpolation for SQL.
- Review new IPC handlers for input validation and least-privilege access.
- Run dependency audits regularly (npm + Python) and address high/critical findings.
