const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = false;

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 780,
    minWidth: 960, minHeight: 640,
    frame: false, titleBarStyle: 'hidden',
    backgroundColor: '#0A0E27',
    icon: path.join(__dirname, '../../public/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url); return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  autoUpdater.checkForUpdates().catch(() => {});
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC - Window controls
ipcMain.on('minimize', () => mainWindow?.minimize());
ipcMain.on('maximize', () => {
  mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize();
});
ipcMain.on('close', () => mainWindow?.close());
ipcMain.on('toggle-fullscreen', () => { if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen()); });
ipcMain.handle('isMaximized', () => mainWindow?.isMaximized() || false);

// IPC - Update
ipcMain.on('install-update', () => autoUpdater.quitAndInstall());
ipcMain.on('start-download', () => autoUpdater.downloadUpdate());

// Auto updater events
autoUpdater.on('update-available', (info) => {
  mainWindow?.webContents.send('update-available', info);
});
autoUpdater.on('download-progress', (progress) => {
  mainWindow?.webContents.send('download-progress', progress);
});
autoUpdater.on('update-downloaded', () => {
  mainWindow?.webContents.send('update-downloaded');
});
