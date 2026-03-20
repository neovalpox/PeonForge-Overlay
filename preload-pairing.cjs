const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  close: () => ipcRenderer.send('pairing:close'),
  onPairingData: (cb) => ipcRenderer.on('pairing-data', (e, data) => cb(data)),
});
