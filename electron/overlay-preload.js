'use strict';

// Minimal bridge for the region-selection overlay window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayApi', {
  submit: (rect) => ipcRenderer.send('overlay:submit', rect),
  cancel: () => ipcRenderer.send('overlay:cancel'),
});
