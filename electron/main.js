'use strict';

// Autoveda Electron main process (M0).
// Responsibilities: spawn the Python backend, perform the port handshake, host the
// React UI window, and keep a system-tray presence. No automation features yet.

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } = require('electron');
const path = require('path');
const { startBackend, stopBackend } = require('./backend');
const { selectRegion } = require('./overlay');

const isDev = !app.isPackaged;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.png');
const TRAY_ICON_PATH = path.join(__dirname, '..', 'assets', 'tray.png');

let mainWindow = null;
let tray = null;
let backendInfo = null; // resolved handshake payload
let backendError = null;

// Single-instance: focus the existing window instead of opening a second one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    title: 'Autoveda',
    icon: ICON_PATH,
    backgroundColor: '#0b1020',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
  }

  // Open external links in the system browser, not inside the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Closing the window hides to tray (app keeps running) unless we're really quitting.
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  let image = nativeImage.createFromPath(TRAY_ICON_PATH);
  if (image.isEmpty()) image = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('Autoveda');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Autoveda', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: 'Quit Autoveda',
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('click', () => showMainWindow());
}

// --- IPC: expose backend handshake state to the renderer ---
ipcMain.handle('autoveda:getBackendInfo', () => {
  if (backendInfo) return { ok: true, ...backendInfo };
  if (backendError) return { ok: false, error: backendError };
  return { ok: false, pending: true };
});
ipcMain.handle('autoveda:appVersion', () => app.getVersion());

// Region picker: hide our window so the overlay can cover the screen, draw, restore.
ipcMain.handle('autoveda:selectRegion', async () => {
  const wasVisible = mainWindow && mainWindow.isVisible();
  if (wasVisible) mainWindow.hide();
  // Give the OS a beat to actually hide the window before the overlay appears.
  await new Promise((r) => setTimeout(r, 180));
  try {
    return await selectRegion();
  } finally {
    if (wasVisible && mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  }
});

app.whenReady().then(async () => {
  createTray();
  createWindow();

  try {
    backendInfo = await startBackend();
    console.log('[main] backend ready at', backendInfo.baseUrl);
    if (mainWindow) mainWindow.webContents.send('autoveda:backendReady', backendInfo);
  } catch (err) {
    backendError = err.message;
    console.error('[main] backend failed:', err.message);
    if (mainWindow) mainWindow.webContents.send('autoveda:backendError', backendError);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Keep the app alive in the tray when all windows are closed (all platforms).
app.on('window-all-closed', () => {
  /* intentionally no-op: quit via the tray menu */
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopBackend();
});
