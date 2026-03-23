const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  setFaction: (f) => ipcRenderer.send('settings:set-faction', f),
  setSound: (v) => ipcRenderer.send('settings:set-sound', v),
  setWatching: (v) => ipcRenderer.send('settings:set-watching', v),
  setVolume: (v) => ipcRenderer.send('settings:set-volume', v),
  setUsername: (name) => ipcRenderer.send('settings:set-username', name),
  setPassword: (pwd) => ipcRenderer.send('settings:set-password', pwd),
  setShowCompanion: (v) => ipcRenderer.send('settings:set-show-companion', v),
  setShowNotifications: (v) => ipcRenderer.send('settings:set-show-notifications', v),
  test: () => ipcRenderer.send('settings:test'),
  close: () => ipcRenderer.send('settings:close'),
  getHistory: () => ipcRenderer.sendSync('settings:get-history'),
  getCharacters: () => ipcRenderer.sendSync('settings:get-characters'),
  getUsername: () => ipcRenderer.sendSync('settings:get-username'),
  onConfigUpdate: (cb) => ipcRenderer.on('config-update', (e, data) => cb(data)),
});
