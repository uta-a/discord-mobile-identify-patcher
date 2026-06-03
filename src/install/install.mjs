import fs from "node:fs/promises";
import path from "node:path";
import { buildLoaderAsar } from "./buildLoaderAsar.mjs";
import { evaluateInstallState, isOurLoader } from "./guard.mjs";
import { getAppAsarPath, getBackupAsarPath, getLegacyBackupAsarPath } from "../utils/asarPaths.mjs";
import { sha256File } from "../utils/hash.mjs";
import { assertDiscordNotRunning, closeDiscordForInstall } from "./processGuard.mjs";

export async function installToResources(resourcesDir, { forceClose = false, skipProcessCheck = false } = {}) {
  let closedProcesses = [];

  if (forceClose) {
    const closeResult = await closeDiscordForInstall(resourcesDir);
    closedProcesses = closeResult.processes;
  } else if (!skipProcessCheck) {
    await assertDiscordNotRunning(resourcesDir);
  }

  const state = await evaluateInstallState(resourcesDir);

  if (state.action === "already-installed") {
    return repairExistingInstall(resourcesDir, { closedProcesses, state });
  }

  if (state.action !== "install") {
    throw new Error(state.reason ?? "install guard failed");
  }

  const appAsar = getAppAsarPath(resourcesDir);
  const backupAsar = getBackupAsarPath(resourcesDir);
  const originalHash = await sha256File(appAsar);
  const tempLoaderAsar = path.join(
    resourcesDir,
    `.app.asar.mobile-identify-loader-${process.pid}-${Date.now()}.tmp`
  );

  await buildLoaderAsar(tempLoaderAsar);
  if (!(await isOurLoader(tempLoaderAsar))) {
    throw new Error(`built loader marker verification failed: ${tempLoaderAsar}`);
  }

  let renamedOriginal = false;
  try {
    await renameWithBusyRetry(appAsar, backupAsar);
    renamedOriginal = true;
    await renameWithBusyRetry(tempLoaderAsar, appAsar);

    if (!(await isOurLoader(appAsar))) {
      throw new Error(
        "installed app.asar marker verification failed; close Discord completely and retry because another process may have replaced app.asar"
      );
    }

    return {
      installed: true,
      alreadyInstalled: false,
      appAsar,
      backupAsar,
      closedProcesses,
      originalHash
    };
  } catch (error) {
    await fs.rm(tempLoaderAsar, { force: true });

    if (renamedOriginal) {
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

async function repairExistingInstall(resourcesDir, { closedProcesses, state }) {
  const appAsar = getAppAsarPath(resourcesDir);
  const backupAsar = getBackupAsarPath(resourcesDir);
  const legacyBackupAsar = getLegacyBackupAsarPath(resourcesDir);
  const tempLoaderAsar = path.join(
    resourcesDir,
    `.app.asar.mobile-identify-loader-${process.pid}-${Date.now()}.tmp`
  );

  const backupExists = await exists(backupAsar);
  const legacyBackupExists = await exists(legacyBackupAsar);

  if (!backupExists && legacyBackupExists) {
    await renameWithBusyRetry(legacyBackupAsar, backupAsar);
  }

  if (!(await exists(backupAsar))) {
    return { installed: false, alreadyInstalled: true, repaired: false, closedProcesses, state };
  }

  await buildLoaderAsar(tempLoaderAsar);
  if (!(await isOurLoader(tempLoaderAsar))) {
    throw new Error(`built loader marker verification failed: ${tempLoaderAsar}`);
  }

  try {
    await removeWithBusyRetry(appAsar);
    await renameWithBusyRetry(tempLoaderAsar, appAsar);

    if (!(await isOurLoader(appAsar))) {
      throw new Error("repaired app.asar marker verification failed");
    }

    return {
      installed: false,
      alreadyInstalled: true,
      repaired: true,
      appAsar,
      backupAsar,
      migratedLegacyBackup: legacyBackupExists && !backupExists,
      closedProcesses,
      state
    };
  } catch (error) {
    await fs.rm(tempLoaderAsar, { force: true });
    throw error;
  }
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
