const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  focusSession: (sessionId) => ipcRenderer.send('companion:focus-session', sessionId),
  onUpdate: (cb) => ipcRenderer.on('companion-update', (e, data) => cb(data)),
  close: () => ipcRenderer.send('companion:close'),
});
