const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lofi', {
  onClaudeEvent: (callback) => {
    ipcRenderer.on('claude-event', (_evt, payload) => callback(payload));
  },
  onSetMuted: (callback) => {
    ipcRenderer.on('set-muted', (_evt, muted) => callback(muted));
  },
  getConfig: () => ipcRenderer.invoke('get-config'),
  loadSamples: () => ipcRenderer.invoke('load-samples'),
  setConfig: (partial) => ipcRenderer.send('set-config', partial),
  relaunch: () => ipcRenderer.send('relaunch'),
  setVolume: (v) => ipcRenderer.send('set-volume', v),
  setMuted: (muted) => ipcRenderer.send('set-muted', muted),
  dragStart: (offX, offY) => ipcRenderer.send('drag-start', offX, offY),
  dragEnd: () => ipcRenderer.send('drag-end'),
  sendTrayIcon: (dataURL) => ipcRenderer.send('tray-icon', dataURL),
  quit: () => ipcRenderer.send('app-quit'),
});
