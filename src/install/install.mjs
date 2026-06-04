import fs from "node:fs/promises";
import path from "node:path";
import { buildLoaderAsar } from "./buildLoaderAsar.mjs";
import { evaluateInstallState, isOurLoader } from "./guard.mjs";
import {
  getAppAsarPath,
  getBackupAsarPath,
  getDiscordBodyAsarPath,
  getVencordLoaderAsarPath
} from "../utils/asarPaths.mjs";
import { sha256File } from "../utils/hash.mjs";
import { assertDiscordNotRunning, closeDiscordForInstall } from "./processGuard.mjs";

const INSTALL_MODES = new Set(["auto", "preserve-existing", "direct-discord"]);

export async function installToResources(
  resourcesDir,
  { forceClose = false, skipProcessCheck = false, installMode = "auto" } = {}
) {
  if (!INSTALL_MODES.has(installMode)) {
    throw new Error(`Unsupported install mode: ${installMode}`);
  }

  let closedProcesses = [];

  if (forceClose) {
    const closeResult = await closeDiscordForInstall(resourcesDir);
    closedProcesses = closeResult.processes;
  } else if (!skipProcessCheck) {
    await assertDiscordNotRunning(resourcesDir);
  }

  const state = await evaluateInstallState(resourcesDir);

  if (installMode === "direct-discord") {
    return installDirectDiscordMode(resourcesDir, { closedProcesses, state });
  }

  if ((installMode === "auto" || installMode === "preserve-existing")
    && (await exists(getDiscordBodyAsarPath(resourcesDir)))) {
    return installVencordChain(resourcesDir, { closedProcesses, installMode: "vencord-chain" });
  }

  if (state.action === "already-installed") {
    return repairExistingInstall(resourcesDir, { closedProcesses, state });
  }

  if (state.action !== "install") {
    throw new Error(state.reason ?? "install guard failed");
  }

  return installFreshOfficial(resourcesDir, { closedProcesses });
}

async function installDirectDiscordMode(resourcesDir, { closedProcesses, state }) {
  if (state.state === "vencord-only") {
    return installDirectDiscord(resourcesDir, { closedProcesses });
  }

  if (state.state === "mobile-then-vencord") {
    return uninstallVencordLayerFromResources(resourcesDir, {
      skipProcessCheck: true
    });
  }

  if (state.state === "vencord-then-mobile") {
    await removeWithBusyRetry(getVencordLoaderAsarPath(resourcesDir));
    const result = await repairActiveLoader(resourcesDir, { closedProcesses, state });
    return { ...result, removedVencordLayer: true };
  }

  if (state.alreadyInstalled) {
    return repairActiveLoader(resourcesDir, { closedProcesses, state });
  }

  if (await exists(getDiscordBodyAsarPath(resourcesDir))) {
    return installDirectDiscord(resourcesDir, { closedProcesses });
  }

  if (state.action !== "install") {
    throw new Error(state.reason ?? "install guard failed");
  }

  return installFreshOfficial(resourcesDir, { closedProcesses });
}

async function installFreshOfficial(resourcesDir, { closedProcesses }) {
  const appAsar = getAppAsarPath(resourcesDir);
  const backupAsar = getDiscordBodyAsarPath(resourcesDir);
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
    await copyFallbackBackupIfMissing(backupAsar, getBackupAsarPath(resourcesDir));
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

export async function uninstallSelfFromResources(
  resourcesDir,
  { forceClose = false, skipProcessCheck = false } = {}
) {
  const closedProcesses = await prepareForAsarChanges(resourcesDir, { forceClose, skipProcessCheck });
  const state = await evaluateInstallState(resourcesDir);
  const appAsar = getAppAsarPath(resourcesDir);
  const discordBodyAsar = getDiscordBodyAsarPath(resourcesDir);
  const backupAsar = getBackupAsarPath(resourcesDir);
  const vencordLoaderAsar = getVencordLoaderAsarPath(resourcesDir);

  if (!state.canUninstallSelf) {
    throw new Error(`self layer is not installed in current state: ${state.state}`);
  }

  if (state.state === "mobile-only") {
    const officialSource = await exists(discordBodyAsar) ? discordBodyAsar : backupAsar;
    if (!(await exists(officialSource))) {
      throw new Error("official Discord body was not found for uninstall-self");
    }

    await removeWithBusyRetry(appAsar);
    await renameWithBusyRetry(officialSource, appAsar);
    await removeWithBusyRetry(backupAsar);
    return { uninstalled: true, command: "uninstall-self", state: state.state, closedProcesses };
  }

  if (state.state === "vencord-then-mobile") {
    await removeWithBusyRetry(appAsar);
    await renameWithBusyRetry(vencordLoaderAsar, appAsar);
    await removeWithBusyRetry(backupAsar);
    return { uninstalled: true, command: "uninstall-self", state: state.state, closedProcesses };
  }

  if (state.state === "mobile-then-vencord") {
    await removeWithBusyRetry(discordBodyAsar);
    await renameWithBusyRetry(backupAsar, discordBodyAsar);
    return { uninstalled: true, command: "uninstall-self", state: state.state, closedProcesses };
  }

  throw new Error(`unsupported uninstall-self state: ${state.state}`);
}

export async function uninstallVencordLayerFromResources(
  resourcesDir,
  { forceClose = false, skipProcessCheck = false } = {}
) {
  const closedProcesses = await prepareForAsarChanges(resourcesDir, { forceClose, skipProcessCheck });
  const state = await evaluateInstallState(resourcesDir);
  const appAsar = getAppAsarPath(resourcesDir);
  const discordBodyAsar = getDiscordBodyAsarPath(resourcesDir);
  const backupAsar = getBackupAsarPath(resourcesDir);
  const vencordLoaderAsar = getVencordLoaderAsarPath(resourcesDir);

  if (!state.canUninstallVencordLayer) {
    throw new Error(`Vencord layer is not installed in current state: ${state.state}`);
  }

  if (state.state === "vencord-only") {
    await removeWithBusyRetry(appAsar);
    await renameWithBusyRetry(discordBodyAsar, appAsar);
    return { uninstalled: true, command: "uninstall-vencord-layer", state: state.state, closedProcesses };
  }

  if (state.state === "vencord-then-mobile") {
    await removeWithBusyRetry(vencordLoaderAsar);
    return { uninstalled: true, command: "uninstall-vencord-layer", state: state.state, closedProcesses };
  }

  if (state.state === "mobile-then-vencord") {
    await removeWithBusyRetry(appAsar);
    await renameWithBusyRetry(discordBodyAsar, appAsar);
    if (!(await exists(discordBodyAsar))) {
      await fs.copyFile(backupAsar, discordBodyAsar);
    }
    return { uninstalled: true, command: "uninstall-vencord-layer", state: state.state, closedProcesses };
  }

  throw new Error(`unsupported uninstall-vencord-layer state: ${state.state}`);
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

async function installDirectDiscord(resourcesDir, { closedProcesses }) {
  const appAsar = getAppAsarPath(resourcesDir);
  const backupAsar = getBackupAsarPath(resourcesDir);
  const legacyVencordBodyAsar = getDiscordBodyAsarPath(resourcesDir);
  const originalHash = await sha256File(legacyVencordBodyAsar);
  const tempLoaderAsar = path.join(
    resourcesDir,
    `.app.asar.mobile-identify-loader-${process.pid}-${Date.now()}.tmp`
  );

  await buildLoaderAsar(tempLoaderAsar);
  if (!(await isOurLoader(tempLoaderAsar))) {
    throw new Error(`built loader marker verification failed: ${tempLoaderAsar}`);
  }

  let movedDiscordBody = false;
  try {
    await removeWithBusyRetry(backupAsar);
    await renameWithBusyRetry(legacyVencordBodyAsar, backupAsar);
    movedDiscordBody = true;
    await removeWithBusyRetry(appAsar);
    await renameWithBusyRetry(tempLoaderAsar, appAsar);

    if (!(await isOurLoader(appAsar))) {
      throw new Error("direct Discord app.asar marker verification failed");
    }

    return {
      installed: true,
      alreadyInstalled: false,
      installMode: "direct-discord",
      appAsar,
      backupAsar,
      disabledExistingLayer: true,
      closedProcesses,
      originalHash
    };
  } catch (error) {
    await fs.rm(tempLoaderAsar, { force: true });

    if (movedDiscordBody && !(await exists(appAsar))) {
      try {
        await fs.rename(backupAsar, appAsar);
      } catch {
        error.message = `${error.message}; rollback failed, Discord body remains at ${backupAsar}`;
      }
    } else if (movedDiscordBody && !(await exists(legacyVencordBodyAsar))) {
      try {
        await fs.rename(backupAsar, legacyVencordBodyAsar);
      } catch {
        error.message = `${error.message}; rollback failed, Discord body remains at ${backupAsar}`;
      }
    }

    throw error;
  }
}

async function installVencordChain(resourcesDir, { closedProcesses, installMode }) {
  const appAsar = getAppAsarPath(resourcesDir);
  const discordBodyAsar = getDiscordBodyAsarPath(resourcesDir);
  const backupAsar = getBackupAsarPath(resourcesDir);
  const vencordLoaderAsar = getVencordLoaderAsarPath(resourcesDir);
  const originalHash = await sha256File(appAsar);
  const tempLoaderAsar = path.join(
    resourcesDir,
    `.app.asar.mobile-identify-loader-${process.pid}-${Date.now()}.tmp`
  );

  if (await isOurLoader(appAsar)) {
    return repairActiveLoader(resourcesDir, {
      closedProcesses,
      state: await evaluateInstallState(resourcesDir)
    });
  }

  const normalizedExistingMobileLoader = await isOurLoader(discordBodyAsar);
  if (normalizedExistingMobileLoader) {
    if (!(await exists(backupAsar))) {
      throw new Error(
        "_app.asar is already this loader, but app.dmi.asar was not found; cannot recover Discord body"
      );
    }
    await removeWithBusyRetry(discordBodyAsar);
    await renameWithBusyRetry(backupAsar, discordBodyAsar);
  }

  await buildLoaderAsar(tempLoaderAsar);
  if (!(await isOurLoader(tempLoaderAsar))) {
    throw new Error(`built loader marker verification failed: ${tempLoaderAsar}`);
  }

  let movedVencordLoader = false;
  try {
    await removeWithBusyRetry(vencordLoaderAsar);
    await renameWithBusyRetry(appAsar, vencordLoaderAsar);
    movedVencordLoader = true;
    await renameWithBusyRetry(tempLoaderAsar, appAsar);

    if (!(await isOurLoader(appAsar))) {
      throw new Error("Vencord chain app.asar marker verification failed");
    }

    return {
      installed: true,
      alreadyInstalled: false,
      installMode,
      appAsar,
      discordBodyAsar,
      vencordLoaderAsar,
      normalizedExistingMobileLoader,
      closedProcesses,
      originalHash
    };
  } catch (error) {
    await fs.rm(tempLoaderAsar, { force: true });

    if (movedVencordLoader && !(await exists(appAsar))) {
      try {
        await fs.rename(vencordLoaderAsar, appAsar);
      } catch {
        error.message = `${error.message}; rollback failed, Vencord loader remains at ${vencordLoaderAsar}`;
      }
    }

    throw error;
  }
}

async function repairExistingInstall(resourcesDir, { closedProcesses, state }) {
  const appAsar = getAppAsarPath(resourcesDir);
  const backupAsar = getBackupAsarPath(resourcesDir);
  const tempLoaderAsar = path.join(
    resourcesDir,
    `.app.asar.mobile-identify-loader-${process.pid}-${Date.now()}.tmp`
  );

  const backupExists = await exists(backupAsar);

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
      migratedLegacyBackup: false,
      closedProcesses,
      state
    };
  } catch (error) {
    await fs.rm(tempLoaderAsar, { force: true });
    throw error;
  }
}

async function repairActiveLoader(resourcesDir, { closedProcesses, state }) {
  const appAsar = getAppAsarPath(resourcesDir);
  const tempLoaderAsar = path.join(
    resourcesDir,
    `.app.asar.mobile-identify-loader-${process.pid}-${Date.now()}.tmp`
  );

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

async function copyFallbackBackupIfMissing(from, to) {
  if (await exists(to)) return;
  await fs.copyFile(from, to);
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
