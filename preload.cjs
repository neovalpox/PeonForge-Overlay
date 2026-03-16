const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  close: () => ipcRenderer.send('close-overlay'),
  focusNeonHub: () => ipcRenderer.send('focus-neonhub'),
});
