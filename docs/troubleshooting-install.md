# Install Troubleshooting Notes

Last updated: 2026-06-04

This document records the installation issues found while testing the Windows no-clone installer and the fixes made for them.

## Environment Used During Investigation

- OS: Windows
- Target Discord resources path:
  - `C:\Users\utaaa\AppData\Local\Discord\app-1.0.9239\resources`
- Target file:
  - `app.asar`
- No-clone installer:
  - `scripts/bootstrap-windows.ps1`

## Symptom: Temporary Directory Could Not Be Deleted

Example:

```text
Remove-Item : 'C:\Users\utaaa\AppData\Local\Temp\discord-mobile-identify-patcher-...' is in use and cannot be removed.
```

### Cause

`install-windows.ps1` changed the current directory into the temporary extracted repository and did not restore the original location before `bootstrap-windows.ps1` tried to delete the temporary directory.

On Windows, deleting the current working directory fails because the shell still holds it.

### Fix

- Save the previous location before changing directories.
- Restore it in `finally`.
- Delete the temporary directory only after returning to the previous location.
- Add retry-based temporary directory cleanup so a short-lived lock does not mask the real install error.

Related commits:

- `f1bede3` - Restore the previous PowerShell location before deleting temp files.
- `6709628` - Improve Windows cleanup after install failures.

## Symptom: `EBUSY` When Renaming `app.asar`

Example:

```text
EBUSY: resource busy or locked, rename
'...\resources\app.asar' ->
'...\resources\app.mobile-status-backup.asar'
```

### Initial Assumption

The first assumption was that Discord or `DiscordSystemHelper` was still running and holding `app.asar`.

The installer already checked Discord process names, but this was not enough because the actual lock can come from a different process.

### Investigation

Normal process checks did not show Discord:

```powershell
Get-Process | Where-Object { $_.ProcessName -like "*Discord*" }
```

Windows Restart Manager was then used to query the process locking the specific file.

Diagnostic script added:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\find-locking-processes.ps1 -Path "C:\Users\utaaa\AppData\Local\Discord\app-1.0.9239\resources\app.asar"
```

Result:

```text
Id          : 11256
AppName     : Visual Studio Code
ProcessName : Code
Path        : C:\Users\utaaa\AppData\Local\Programs\Microsoft VS Code\Code.exe
Restartable : False
Type        : RmMainWindow
```

### Cause

Visual Studio Code had opened or was watching Discord's `app.asar` or the surrounding `resources` directory. That file handle blocked the rename.

### Fixes / Mitigations

- Added `scripts/find-locking-processes.ps1` to identify the exact process locking `app.asar`.
- Added `--force-close` support to close matching Discord processes before install.
- One-step Windows/macOS installers now pass `--force-close` by default.
- Added retry logic around `fs.rename()` to handle short-lived locks after process termination.

Important limitation:

The installer does not automatically kill unrelated processes such as VS Code. Closing a user's editor can lose work, so the safer behavior is to diagnose and report. If Restart Manager reports VS Code, close the relevant VS Code window or quit VS Code before retrying.

Related commits:

- `83ab5c6` - Add force-close support before install.
- `d5f714b` - Add the locking-process diagnostic script.

## Symptom: `installed app.asar marker verification failed`

Example:

```text
installed app.asar marker verification failed; close Discord completely and retry because another process may have replaced app.asar
```

### Observed State After Failure

After the failure, the resources directory had rolled back to the original state:

```text
resources/
  app.asar
  build_info.json
  bootstrap/
```

There was no `app.mobile-status-backup.asar`, and `app.asar` had no `marker.json`.

This showed that rollback worked and no broken backup state remained.

### Investigation

A loader archive was generated directly in the real `resources` directory and verified successfully:

```powershell
$tmp = "C:\Users\utaaa\AppData\Local\Discord\app-1.0.9239\resources\.loader-marker-test-$PID.asar"
node -e "import('./src/install/buildLoaderAsar.mjs').then(async m=>{await m.buildLoaderAsar(process.argv[1]); const g=await import('./src/install/guard.mjs'); console.log('isOurLoader='+await g.isOurLoader(process.argv[1]));})" $tmp
Remove-Item -LiteralPath $tmp -Force
```

Result:

```text
isOurLoader=true
```

So the loader archive itself was valid.

### Cause

`@electron/asar` caches parsed ASAR filesystem metadata by archive path.

The failing sequence was:

1. `evaluateInstallState()` read the original official `app.asar`.
2. `@electron/asar` cached metadata for `...\resources\app.asar`.
3. The installer renamed official `app.asar` to backup.
4. The installer renamed the generated loader ASAR to the same `app.asar` path.
5. Marker verification read `app.asar` again.
6. `@electron/asar` reused the stale metadata from the original official archive.
7. The marker lookup incorrectly failed because the old archive did not contain `marker.json`.

### Fix

`readMarker()` now calls:

```js
asar.uncache(appAsarPath);
```

before extracting `marker.json`.

A regression test was added to verify that replacing an official ASAR with the loader ASAR at the same path does not reuse stale ASAR cache metadata.

Related commit:

- `c0999ca` - Clear stale ASAR cache before marker verification.

## Current Recommended Retry Flow

1. Run the no-clone installer:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/uta-a/discord-mobile-identify-patcher/main/scripts/bootstrap-windows.ps1 | iex"
```

2. If `EBUSY` still appears, identify the lock owner:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/uta-a/discord-mobile-identify-patcher/main/scripts/find-locking-processes.ps1 | Set-Content \"$env:TEMP\find-locking-processes.ps1\"; powershell -NoProfile -ExecutionPolicy Bypass -File \"$env:TEMP\find-locking-processes.ps1\" -Path \"C:\Users\utaaa\AppData\Local\Discord\app-1.0.9239\resources\app.asar\"; Remove-Item \"$env:TEMP\find-locking-processes.ps1\" -Force"
```

3. Close the reported process if it is not Discord and retry.

## Test Status

After the cache fix:

```text
npm test
20 tests passed
```
