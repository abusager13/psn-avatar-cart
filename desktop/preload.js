const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  resolve: (input, region) => ipcRenderer.invoke('resolve', { input, region }),
  open: (url) => ipcRenderer.invoke('open', url),
  copy: (text) => ipcRenderer.invoke('copy', text),
  pickEdat: () => ipcRenderer.invoke('pick-edat'),
  resize: (height) => ipcRenderer.invoke('resize', height),
  snapshotReady: () => ipcRenderer.invoke('snapshot-ready'),
  onFocusInput: (cb) => ipcRenderer.on('focus-input', cb),
});
