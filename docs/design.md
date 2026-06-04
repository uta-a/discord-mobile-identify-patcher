# Design

The original design source is kept in `independent-discord-mobile-identify-patcher-design.md`.

The implemented MVP follows these requirements:

- Install a self-contained loader as `resources/app.asar`.
- Rename the official Discord `app.asar` to `_app.asar`.
- When `_app.asar` already exists, treat the current `app.asar` as a Vencord-style loader and move it to `app.vc.asar`.
- Keep `app.mobile-status-backup.asar` as a legacy migration and fallback file for older installs or Vencord-after-mobile installs.
- Detect this loader by `marker.json`.
- Load `app.vc.asar` as the next Electron layer when present; otherwise load `_app.asar`.
- Chain any existing `BrowserWindow.webPreferences.preload` by running this patcher's preload first, then the original preload.
- Hook `WebSocket.prototype.send` and rewrite only Gateway `IDENTIFY` payloads (`op: 2`).
