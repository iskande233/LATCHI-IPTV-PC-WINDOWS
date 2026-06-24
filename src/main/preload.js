const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('minimize'),
  maximize: () => ipcRenderer.send('maximize'),
  close: () => ipcRenderer.send('close'),
  isMaximized: () => ipcRenderer.invoke('isMaximized'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, info) => cb(info)),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_, p) => cb(p)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', () => cb()),
  installUpdate: () => ipcRenderer.send('install-update'),
  startDownload: () => ipcRenderer.send('start-download'),
  openExternal: (url) => ipcRenderer.send('open-external', url)
});
