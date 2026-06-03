# Design

The original design source is kept in `independent-discord-mobile-identify-patcher-design.md`.

The implemented MVP follows these requirements:

- Install a self-contained loader as `resources/app.asar`.
- Rename the previous `app.asar` to `app.mobile-status-backup.asar`.
- Do not inspect, move, or overwrite `_app.asar`.
- Detect this loader by `marker.json`.
- Load the backed-up app's `package.json#main` as the next Electron layer.
- Chain any existing `BrowserWindow.webPreferences.preload` by running this patcher's preload first, then the original preload.
- Hook `WebSocket.prototype.send` and rewrite only Gateway `IDENTIFY` payloads (`op: 2`).
