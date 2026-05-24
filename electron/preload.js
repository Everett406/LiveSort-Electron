const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  onBackendLog: (callback) => {
    ipcRenderer.on('backend-log', (_event, line) => callback(line));
  }
});
