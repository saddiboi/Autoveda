# Frontend ↔ backend contract (M0)

The single source of truth for how the Electron shell and the FastAPI backend
agree on a port and confirm liveness. Keep this in sync with both sides.

## Port negotiation

1. Electron computes the handshake file path: `<userData>/autoveda-port.json`.
2. Electron deletes any stale handshake file, then spawns the backend with env:
   - `AUTOVEDA_PORT_FILE` — absolute path to the handshake file to write.
   - `AUTOVEDA_PREFERRED_PORT` — preferred port (default `8756`).
3. The backend tries to bind the preferred port; if taken, the OS assigns a free one.
4. The backend writes the handshake file **atomically** (temp file + rename) so
   Electron never reads a partial value.
5. Electron polls for the file, parses it, and hands `baseUrl` to the renderer
   (via `window.autoveda.getBackendInfo()` / the `backendReady` event).

### Handshake file shape (`autoveda-port.json`)

```json
{
  "host": "127.0.0.1",
  "port": 8756,
  "pid": 12345,
  "version": "0.1.0"
}
```

## Health check

`GET http://<host>:<port>/health` →

```json
{
  "status": "ok",
  "service": "autoveda-backend",
  "version": "0.1.0",
  "pid": 12345,
  "uptime_seconds": 12.34
}
```

The renderer polls `/health` every 3s and shows the result. A failed poll after a
successful handshake is treated as a transient blip (UI shows "connecting"), not a
hard error.

## Renderer API (exposed by preload)

```js
window.autoveda.getBackendInfo() // -> { ok, baseUrl, host, port, version, pid } | { pending: true } | { ok:false, error }
window.autoveda.onBackendReady(cb)
window.autoveda.onBackendError(cb)
window.autoveda.appVersion()
```
