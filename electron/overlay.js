'use strict';

// Region-selection overlay: a transparent, always-on-top window covering the
// primary display. The user drags a rectangle; we translate the CSS-pixel rect to
// physical screen pixels (what mss/pyautogui use later) and resolve it.

const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

function selectRegion() {
  return new Promise((resolve) => {
    const display = screen.getPrimaryDisplay();
    const { bounds, scaleFactor } = display;

    const win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      hasShadow: false,
      fullscreenable: false,
      enableLargerThanScreen: true,
      webPreferences: {
        preload: path.join(__dirname, 'overlay-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadFile(path.join(__dirname, 'overlay.html'));
    win.once('ready-to-show', () => {
      win.show();
      win.focus();
    });

    let settled = false;
    const onSubmit = (_e, cssRect) => finish(toRegion(cssRect));
    const onCancel = () => finish(null);

    function finish(region) {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('overlay:submit', onSubmit);
      ipcMain.removeListener('overlay:cancel', onCancel);
      if (!win.isDestroyed()) win.close();
      resolve(region);
    }

    function toRegion(cssRect) {
      // Ignore stray clicks / tiny drags.
      if (!cssRect || cssRect.width < 3 || cssRect.height < 3) return null;
      // CSS px are display-relative DIPs; convert to absolute physical pixels.
      return {
        x: Math.round((bounds.x + cssRect.x) * scaleFactor),
        y: Math.round((bounds.y + cssRect.y) * scaleFactor),
        width: Math.round(cssRect.width * scaleFactor),
        height: Math.round(cssRect.height * scaleFactor),
        scaleFactor,
        displayId: display.id,
      };
    }

    ipcMain.on('overlay:submit', onSubmit);
    ipcMain.on('overlay:cancel', onCancel);
    win.on('closed', () => finish(null));
  });
}

module.exports = { selectRegion };
