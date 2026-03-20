const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  close: () => ipcRenderer.send('close-progress'),
  focusTerminal: () => ipcRenderer.send('focus-terminal'),
  onUpdate: (cb) => ipcRenderer.on('progress-update', (e, data) => cb(data)),
});
