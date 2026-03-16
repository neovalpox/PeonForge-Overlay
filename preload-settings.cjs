const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  setFaction: (f) => ipcRenderer.send('settings:set-faction', f),
  setSound: (v) => ipcRenderer.send('settings:set-sound', v),
  setWatching: (v) => ipcRenderer.send('settings:set-watching', v),
  setVolume: (v) => ipcRenderer.send('settings:set-volume', v),
  test: () => ipcRenderer.send('settings:test'),
  close: () => ipcRenderer.send('settings:close'),
  getHistory: () => ipcRenderer.sendSync('settings:get-history'),
  onConfigUpdate: (cb) => ipcRenderer.on('config-update', (e, data) => cb(data)),
});
