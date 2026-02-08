# Workflow Electron App

A desktop application built with Electron that wraps the Workflow web application.

## Installation

1. Install Node.js dependencies:
```bash
npm install
```

2. Install Python dependencies:
```bash
pip install -r requirements.txt
```

## Development

Run the application:
```bash
npm start
```

## Building

Build the application for distribution:
```bash
npm run build
```

The built application will be available in the `electron-dist` directory.

## Running

After installation, you can run the app with:
```bash
npm start
```

## Features

- Desktop wrapper for the Workflow web application
- Native menu bar with standard application menus
- Window management (minimize, maximize, close)
- External link handling
- Development tools support

## Structure

- `main.js` - Main Electron process
- `preload.js` - Preload script for security
- `web/` - Frontend web assets
- `python_api.py` - Python IPC bridge used by Electron (no HTTP server)
