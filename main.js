const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron/main');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let activePassword = null;

function createWindow() {
  console.log('Creating main window...');
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    maximized: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    titleBarStyle: 'default'
  });

  console.log('Loading local UI...');
  const indexPath = path.join(__dirname, 'web', 'index.html');
  mainWindow.loadFile(indexPath).then(() => {
    console.log('UI loaded successfully');
    mainWindow.show();
  }).catch(error => {
    console.error('Failed to load UI:', error);
    mainWindow.loadURL('data:text/html,<html><body style="font-family: Arial; padding: 24px;"><h2>Failed to load UI</h2><pre>' + String(error && error.stack ? error.stack : error) + '</pre></body></html>');
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    console.log('Main window closed, keeping for tray reuse...');
    // Don't destroy the window - just hide it so tray can reuse it
    // BUT don't nullify mainWindow immediately - wait a bit to ensure redirects complete
    setTimeout(() => {
      mainWindow = null;
    }, 1000);
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log('External link requested:', url);
    shell.openExternal(url);
    return { action: 'deny' };
  });
  
  // Track navigation events
  mainWindow.webContents.on('did-start-loading', () => {
    console.log('Page started loading:', mainWindow.webContents.getURL());
  });
  
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Page finished loading:', mainWindow.webContents.getURL());
  });
  
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Page failed to load:', errorCode, errorDescription);
    console.error('URL:', mainWindow.webContents.getURL());
  });
  
  // Track console messages from renderer
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`Renderer [${level}]: ${message}`);
  });
}

ipcMain.handle('workflow:api', async (event, request) => {
  const pythonExecutable = process.platform === 'win32' ? 'python' : 'python3';
  const bridgePath = path.join(__dirname, 'python_api.py');

  const payload = {
    request,
    context: {
      activePassword,
    },
  };

  return await new Promise((resolve) => {
    const child = spawn(pythonExecutable, [bridgePath], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONPATH: __dirname }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('error', (error) => {
      resolve({ ok: false, status: 500, error: `python_api.py spawn error: ${String(error)}` });
    });

    child.on('close', (code, signal) => {
      if (code !== 0) {
        const details = stderr || stdout || `python_api.py exited with ${code}${signal ? ` (signal ${signal})` : ''}`;
        resolve({ ok: false, status: 500, error: details });
        return;
      }
      try {
        const result = JSON.parse(stdout || '{}');
        if (result && result.context && Object.prototype.hasOwnProperty.call(result.context, 'activePassword')) {
          activePassword = result.context.activePassword;
        }
        resolve(result);
      } catch (e) {
        resolve({ ok: false, status: 500, error: `Invalid JSON from python_api.py: ${String(e)}`, raw: stdout, stderr });
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
});

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Quit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(async () => {
  console.log('App ready, initializing...');
  
  // Create window
  createWindow();
  createMenu();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  console.log('App is quitting, cleaning up...');

  // No HTTP server to clean up in Option B
});

app.on('window-all-closed', () => {
  // Standard Electron behavior: quit app when all windows closed (except on macOS).
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
