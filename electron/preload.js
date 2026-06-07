'use strict';

// Bridge a tiny, explicit API into the renderer. No Node access leaks through —
// the renderer only sees these methods. Keys/credentials never touch this layer.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('autoveda', {
  // Returns { ok, baseUrl, host, port, version, pid } once the backend is up,
  // { pending: true } while it's still starting, or { ok: false, error } on failure.
  getBackendInfo: () => ipcRenderer.invoke('autoveda:getBackendInfo'),

  // Push notifications so the UI updates the moment the handshake resolves.
  onBackendReady: (cb) =>
    ipcRenderer.on('autoveda:backendReady', (_e, info) => cb(info)),
  onBackendError: (cb) =>
    ipcRenderer.on('autoveda:backendError', (_e, err) => cb(err)),

  appVersion: () => ipcRenderer.invoke('autoveda:appVersion'),

  // Opens the rectangle overlay; resolves to a physical-pixel region or null if cancelled.
  selectRegion: () => ipcRenderer.invoke('autoveda:selectRegion'),
});
