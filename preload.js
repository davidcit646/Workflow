const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => process.platform,

  // Backend API (no HTTP server)
  apiRequest: (request) => ipcRenderer.invoke('workflow:api', request),
});

// Handle any DOM events that need to communicate with the main process
window.addEventListener('DOMContentLoaded', () => {
  // Add any DOM manipulation or event handling here
  console.log('Electron app loaded successfully');
});
