# Discord Mobile IDENTIFY Patcher

Independent Discord desktop patcher that inserts a small Electron loader before the existing `resources/app.asar` layer and rewrites Gateway `IDENTIFY` properties to Android-like values.

This project is experimental. Modifying Discord's client files may violate Discord's terms or break after Discord updates. Use it at your own risk and keep Discord closed while installing.

## MVP Scope

- Manual install against a Discord `resources` directory.
- Backup the current `app.asar` by renaming it to `app.mobile-status-backup.asar`.
- Place this patcher's loader as the new `app.asar`.
- By default, keep the backup as Discord's original app body. If Vencord is installed and `_app.asar` exists, the installer disables the Vencord loader layer and backs up `_app.asar` instead.
- Prevent double install using `marker.json`.
- Rewrite only Gateway `IDENTIFY` (`op: 2`) WebSocket payloads.

No first-class uninstall command, GUI, or automatic updater is included.

## One-Step Install

The installer opens an interactive prompt, lists detected Discord installs, lets you choose the install mode, closes the matching Discord process if requested, then installs the loader.

No-clone install. These commands download the latest project archive into a temporary directory, run the installer, then delete the temporary files.

Default install mode is `direct-discord`: `app.mobile-status-backup.asar` is kept as the original Discord app body, not Vencord or another client-mod loader. This keeps the runtime chain short and avoids leaving extra active layers. Vencord settings are not deleted; reinstall or repair Vencord later if you want it again.

Set `DMI_NONINTERACTIVE=1` to skip prompts and use the selected branch plus `DMI_INSTALL_MODE` or the default mode.

Windows PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/uta-a/discord-mobile-identify-patcher/main/scripts/bootstrap-windows.ps1 | iex"
```

macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/uta-a/discord-mobile-identify-patcher/main/scripts/bootstrap-macos.sh | bash
```

Pass `canary` or `ptb` when needed:

```powershell
$env:DMI_BRANCH = "canary"; powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/uta-a/discord-mobile-identify-patcher/main/scripts/bootstrap-windows.ps1 | iex"; Remove-Item Env:\DMI_BRANCH
```

```bash
curl -fsSL https://raw.githubusercontent.com/uta-a/discord-mobile-identify-patcher/main/scripts/bootstrap-macos.sh | bash -s -- canary
```

To explicitly keep an existing loader layer such as Vencord active, set `DMI_INSTALL_MODE=preserve-existing`. This mode is best treated as experimental because Discord and Vencord updates can replace each other's `app.asar` chain.

Windows PowerShell:

```powershell
$env:DMI_INSTALL_MODE = "preserve-existing"; powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/uta-a/discord-mobile-identify-patcher/main/scripts/bootstrap-windows.ps1 | iex"; Remove-Item Env:\DMI_INSTALL_MODE
```

macOS:

```bash
DMI_INSTALL_MODE=preserve-existing curl -fsSL https://raw.githubusercontent.com/uta-a/discord-mobile-identify-patcher/main/scripts/bootstrap-macos.sh | bash
```

Local checkout install:

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
```

macOS:

```bash
chmod +x ./scripts/install-macos.sh
./scripts/install-macos.sh
```

Both scripts default to Stable Discord. Pass `canary` or `ptb` to target another branch:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -Branch canary
```

```bash
./scripts/install-macos.sh canary
```

## Manual Usage

```bash
npm install
node src/cli.mjs check --discord-path "C:\Users\you\AppData\Local\Discord\app-1.0.x\resources"
node src/cli.mjs install --discord-path "C:\Users\you\AppData\Local\Discord\app-1.0.x\resources"
```

`--discord-path` must point to the `resources` directory that contains `app.asar`.

If you omit `--discord-path`, the CLI searches common Discord locations for the selected branch:

```bash
node src/cli.mjs check --branch stable
node src/cli.mjs check --branch canary
node src/cli.mjs check --branch ptb
node src/cli.mjs install --interactive
node src/cli.mjs install --branch stable --force-close
node src/cli.mjs install --branch stable --force-close --install-mode direct-discord
node src/cli.mjs install --branch stable --force-close --install-mode preserve-existing
```

## Safety Rules

- Existing `app.asar` is moved with `rename`, not copied and deleted.
- `app.mobile-status-backup.asar` is not overwritten during normal repeated installs. In default `direct-discord` mode, a Vencord-style chain with `_app.asar` is normalized so this backup contains Discord's original app body.
- In default `direct-discord` mode, if `_app.asar` exists, it is treated as Discord's original app body and moved to `app.mobile-status-backup.asar`; the existing active loader layer is removed from the chain.
- In `preserve-existing` mode, `_app.asar` and other existing patcher backup files are not touched.
- If `app.asar` is already this loader, install is treated as already complete.
- If backup exists but `app.asar` is not this loader, install aborts to avoid destroying the previous layer.
- The one-step scripts pass `--force-close`, so matching Discord processes are terminated before `app.asar` is renamed.

## Vencord Compatibility

Vencord's installer is available for Windows and macOS and writes its own `app.asar` loader. The current Vencord installer source creates a minimal ASAR whose `index.js` requires the downloaded Vencord patcher, and the Vencord download page documents Windows and macOS installers.

This patcher supports two modes:

- `direct-discord` (default): disables the active Vencord loader layer and patches Discord directly. Backup contains only Discord's original app body. This is the least surprising production mode.
- `preserve-existing`: installs this loader in front of the existing `app.asar`, so the chain can become `mobile loader -> Vencord loader -> Discord body`. This can work, but updates or repair tools from either side may break the chain.

If Vencord is needed again after `direct-discord`, run Vencord's installer repair/reinstall. User Vencord settings under the user's application data directory are not removed by this patcher.

## Development

```bash
npm install
npm test
```

See [docs/design.md](docs/design.md) for the design source.
