# Discord Mobile IDENTIFY Patcher

Independent Discord desktop patcher that inserts a small Electron loader before the existing `resources/app.asar` layer and rewrites Gateway `IDENTIFY` properties to Android-like values.

This project is experimental. Modifying Discord's client files may violate Discord's terms or break after Discord updates. Use it at your own risk and keep Discord closed while installing.

## MVP Scope

- Manual install against a Discord `resources` directory.
- Backup the current `app.asar` by renaming it to `app.mobile-status-backup.asar`.
- Place this patcher's loader as the new `app.asar`.
- Preserve existing patcher layers such as Vencord by loading the backed-up app as the next layer.
- Prevent double install using `marker.json`.
- Rewrite only Gateway `IDENTIFY` (`op: 2`) WebSocket payloads.

No uninstall, GUI, or automatic updater is included.

## One-Step Install

The installer auto-detects the Discord resources path for the selected branch, closes the matching Discord process if it is running, then installs the loader.

No-clone install. These commands download the latest project archive into a temporary directory, run the installer, then delete the temporary files.

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
node src/cli.mjs install --branch stable --force-close
```

## Safety Rules

- Existing `app.asar` is moved with `rename`, not copied and deleted.
- `app.mobile-status-backup.asar` is never overwritten.
- `_app.asar` and other existing patcher backup files are not touched.
- If `app.asar` is already this loader, install is treated as already complete.
- If backup exists but `app.asar` is not this loader, install aborts to avoid destroying the previous layer.
- The one-step scripts pass `--force-close`, so matching Discord processes are terminated before `app.asar` is renamed.

## Development

```bash
npm install
npm test
```

See [docs/design.md](docs/design.md) for the design source.
