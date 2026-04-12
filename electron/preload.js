const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('brian', {
  platform: process.platform,
  isElectron: true,
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  minimize: () => ipcRenderer.invoke('window-minimize'),
  close: () => ipcRenderer.invoke('window-close'),
  sidecar: (side) => ipcRenderer.invoke('window-sidecar', side || 'right'),
  companion: () => ipcRenderer.invoke('window-companion'),
  hide: () => ipcRenderer.invoke('window-hide'),
  notify: (title, body) => ipcRenderer.invoke('show-notification', title, body),
  isVisible: () => ipcRenderer.invoke('window-is-visible'),
});
