const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pai', {
  platform: process.platform,
  isElectron: true,
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  sidecar: (side) => ipcRenderer.invoke('window-sidecar', side || 'right'),
  hide: () => ipcRenderer.invoke('window-hide'),
});
