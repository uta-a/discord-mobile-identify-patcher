import fs from "node:fs/promises";
import path from "node:path";
import {
  BACKUP_ASAR_NAME,
  DIRECT_PATCH_MODE,
  DISPLAY_NAME,
  MARKER_JSON_NAME,
  PATCHER_NAME,
  VERSION
} from "../config.mjs";
import { buildPatchedDiscordAsar } from "./directPatch.mjs";
import { evaluateInstallState } from "./guard.mjs";
import {
  getAppAsarPath,
  getBackupAsarPath,
  getMarkerJsonPath
} from "../utils/asarPaths.mjs";
import { sha256File } from "../utils/hash.mjs";
import { assertDiscordNotRunning, closeDiscordForInstall } from "./processGuard.mjs";

export async function installToResources(
  resourcesDir,
  { forceClose = false, skipProcessCheck = false } = {}
) {
  const closedProcesses = await prepareForAsarChanges(resourcesDir, { forceClose, skipProcessCheck });
  const state = await evaluateInstallState(resourcesDir);

  if (state.state === "dmi-only") {
    return { installed: false, alreadyInstalled: true, repaired: false, state, closedProcesses };
  }

  if (state.action !== "install") {
    throw new Error(state.reason ?? `DMI install is not supported for state: ${state.state}`);
  }

  return installFreshOfficial(resourcesDir, { closedProcesses });
}

export async function uninstallSelfFromResources(
  resourcesDir,
  { forceClose = false, skipProcessCheck = false } = {}
) {
  const closedProcesses = await prepareForAsarChanges(resourcesDir, { forceClose, skipProcessCheck });
  const state = await evaluateInstallState(resourcesDir);
  const appAsar = getAppAsarPath(resourcesDir);
  const backupAsar = getBackupAsarPath(resourcesDir);
  const markerJson = getMarkerJsonPath(resourcesDir);

  if (state.state === "vencord-over-dmi") {
    throw new Error("DMI appears to be installed under Vencord. Uninstall Vencord first, then run DMI uninstall.");
  }

  if (state.state !== "dmi-only") {
    throw new Error(state.reason ?? `DMI uninstall is not supported for state: ${state.state}`);
  }

  const marker = JSON.parse(await fs.readFile(markerJson, "utf8"));
  const currentHash = await sha256File(appAsar);
  if (marker.patchedSha256 && marker.patchedSha256 !== currentHash) {
    throw new Error("current app.asar hash does not match the DMI marker; refusing to overwrite a modified app.asar");
  }

  const backupHash = await sha256File(backupAsar);
  if (marker.originalSha256 && marker.originalSha256 !== backupHash) {
    throw new Error("backup app.asar hash does not match the DMI marker; refusing to restore an unexpected backup");
  }

  const restoreTemp = path.join(resourcesDir, `.app.asar.dmi-restore-${process.pid}-${Date.now()}.tmp`);

  try {
    await fs.copyFile(backupAsar, restoreTemp);
    await removeWithBusyRetry(appAsar);
    await renameWithBusyRetry(restoreTemp, appAsar);
    await removeWithBusyRetry(backupAsar);
    await removeWithBusyRetry(markerJson);

    return {
      uninstalled: true,
      command: "uninstall",
      state: state.state,
      appAsar,
      closedProcesses
    };
  } catch (error) {
    await fs.rm(restoreTemp, { force: true });
    throw error;
  }
}

export async function uninstallVencordLayerFromResources() {
  throw new Error("DMI no longer manages Vencord layers. Uninstall Vencord with Vencord first.");
}

async function installFreshOfficial(resourcesDir, { closedProcesses }) {
  const appAsar = getAppAsarPath(resourcesDir);
  const backupAsar = getBackupAsarPath(resourcesDir);
  const markerJson = getMarkerJsonPath(resourcesDir);
  const patchedTemp = path.join(resourcesDir, `.app.asar.dmi-new-${process.pid}-${Date.now()}.tmp`);
  const originalHash = await sha256File(appAsar);

  let renamedOriginal = false;
  try {
    await renameWithBusyRetry(appAsar, backupAsar);
    renamedOriginal = true;

    await buildPatchedDiscordAsar(backupAsar, patchedTemp);
    const patchedHash = await sha256File(patchedTemp);
    await renameWithBusyRetry(patchedTemp, appAsar);

    const marker = {
      tool: PATCHER_NAME,
      name: DISPLAY_NAME,
      version: VERSION,
      mode: DIRECT_PATCH_MODE,
      backup: BACKUP_ASAR_NAME,
      marker: MARKER_JSON_NAME,
      installedAt: new Date().toISOString(),
      originalSha256: originalHash,
      patchedSha256: patchedHash
    };
    await fs.writeFile(markerJson, `${JSON.stringify(marker, null, 2)}\n`, "utf8");

    return {
      installed: true,
      alreadyInstalled: false,
      installMode: DIRECT_PATCH_MODE,
      appAsar,
      backupAsar,
      markerJson,
      closedProcesses,
      originalHash,
      patchedHash
    };
  } catch (error) {
    await fs.rm(patchedTemp, { force: true });

    if (renamedOriginal && !(await exists(appAsar))) {
      try {
        await fs.rename(backupAsar, appAsar);
      } catch {
        error.message = `${error.message}; rollback failed, original remains at ${backupAsar}`;
      }
    }

    if (error?.code === "EBUSY") {
      throw new Error(
        `app.asar is locked and could not be renamed. Close Discord completely, wait a few seconds, then retry. Original error: ${error.message}`
      );
    }

    throw error;
  }
}

async function prepareForAsarChanges(resourcesDir, { forceClose, skipProcessCheck }) {
  if (forceClose) {
    const closeResult = await closeDiscordForInstall(resourcesDir);
    return closeResult.processes;
  }

  if (!skipProcessCheck) {
    await assertDiscordNotRunning(resourcesDir);
  }

  return [];
}

async function renameWithBusyRetry(from, to, { attempts = 12, delayMs = 500 } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      lastError = error;

      if (error?.code !== "EBUSY" && error?.code !== "EPERM") {
        throw error;
      }

      if (attempt < attempts) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

async function removeWithBusyRetry(filePath, { attempts = 12, delayMs = 500 } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await fs.rm(filePath, { force: true });
      return;
    } catch (error) {
      lastError = error;

      if (error?.code !== "EBUSY" && error?.code !== "EPERM") {
        throw error;
      }

      if (attempt < attempts) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
