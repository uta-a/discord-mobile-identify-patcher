import fs from "node:fs/promises";
import asar from "@electron/asar";
import { LOADER_KIND } from "../config.mjs";
import {
  getAppAsarPath,
  getBackupAsarPath,
  getDiscordBodyAsarPath,
  getVencordLoaderAsarPath
} from "../utils/asarPaths.mjs";
import { pathExists } from "../utils/fileOps.mjs";

export async function readMarker(appAsarPath) {
  try {
    const stat = await fs.stat(appAsarPath);
    if (stat.isDirectory()) {
      const marker = await fs.readFile(`${appAsarPath}/marker.json`, "utf8");
      return JSON.parse(marker);
    }

    asar.uncache(appAsarPath);
    const marker = asar.extractFile(appAsarPath, "marker.json").toString("utf8");
    return JSON.parse(marker);
  } catch {
    return null;
  }
}

export async function isOurLoader(appAsarPath) {
  const marker = await readMarker(appAsarPath);
  return marker?.kind === LOADER_KIND;
}

export async function isVencordLoader(appAsarPath) {
  try {
    const stat = await fs.stat(appAsarPath);
    let source = "";

    if (stat.isDirectory()) {
      source = await fs.readFile(`${appAsarPath}/index.js`, "utf8");
    } else {
      asar.uncache(appAsarPath);
      source = asar.extractFile(appAsarPath, "index.js").toString("utf8");
    }

    return /Vencord/i.test(source) && /patcher\.js|vencord/i.test(source);
  } catch {
    return false;
  }
}

export async function evaluateInstallState(resourcesDir) {
  const appAsar = getAppAsarPath(resourcesDir);
  const backupAsar = getBackupAsarPath(resourcesDir);
  const discordBodyAsar = getDiscordBodyAsarPath(resourcesDir);
  const vencordLoaderAsar = getVencordLoaderAsarPath(resourcesDir);

  const appExists = await pathExists(appAsar);
  const backupExists = await pathExists(backupAsar);
  const discordBodyExists = await pathExists(discordBodyAsar);
  const vencordLoaderExists = await pathExists(vencordLoaderAsar);

  if (!appExists) {
    return withLegacyFields({
      state: "missing-app",
      activeChain: [],
      canInstallSelf: false,
      canUninstallSelf: false,
      canUninstallVencordLayer: false,
      backupExists,
      reason: "app.asar not found"
    });
  }

  const appIsOurLoader = await isOurLoader(appAsar);
  const discordBodyIsOurLoader = discordBodyExists && await isOurLoader(discordBodyAsar);
  const appIsVencordLoader = await isVencordLoader(appAsar);
  const vencordBackupIsVencordLoader = vencordLoaderExists && await isVencordLoader(vencordLoaderAsar);

  if (appIsVencordLoader && discordBodyIsOurLoader && !backupExists) {
    return withLegacyFields({
      state: "mobile-then-vencord-missing-official",
      activeChain: ["vencord", "mobile"],
      canInstallSelf: false,
      canUninstallSelf: false,
      canUninstallVencordLayer: false,
      backupExists,
      reason: "app.dmi.asar not found for mobile-then-vencord state"
    });
  }

  if (appIsVencordLoader && discordBodyIsOurLoader && backupExists) {
    return withLegacyFields({
      state: "mobile-then-vencord",
      activeChain: ["vencord", "mobile", "official"],
      canInstallSelf: true,
      canUninstallSelf: true,
      canUninstallVencordLayer: true,
      backupExists,
      reason: null
    });
  }

  if (appIsOurLoader && vencordBackupIsVencordLoader && !discordBodyExists) {
    return withLegacyFields({
      state: "vencord-then-mobile-missing-body",
      activeChain: ["mobile", "vencord"],
      canInstallSelf: false,
      canUninstallSelf: false,
      canUninstallVencordLayer: false,
      backupExists,
      reason: "_app.asar not found for vencord-then-mobile state"
    });
  }

  if (appIsOurLoader && vencordBackupIsVencordLoader) {
    return withLegacyFields({
      state: "vencord-then-mobile",
      activeChain: ["mobile", "vencord", "official"],
      canInstallSelf: true,
      canUninstallSelf: true,
      canUninstallVencordLayer: true,
      backupExists,
      reason: null
    });
  }

  if (appIsOurLoader && !discordBodyExists && !backupExists) {
    return withLegacyFields({
      state: "mobile-missing-official",
      activeChain: ["mobile"],
      canInstallSelf: false,
      canUninstallSelf: false,
      canUninstallVencordLayer: false,
      backupExists,
      reason: "Discord body ASAR not found for mobile loader"
    });
  }

  if (appIsOurLoader) {
    return withLegacyFields({
      state: "mobile-only",
      activeChain: ["mobile", "official"],
      canInstallSelf: true,
      canUninstallSelf: true,
      canUninstallVencordLayer: false,
      backupExists,
      reason: null
    });
  }

  if (appIsVencordLoader && discordBodyExists) {
    return withLegacyFields({
      state: "vencord-only",
      activeChain: ["vencord", "official"],
      canInstallSelf: true,
      canUninstallSelf: false,
      canUninstallVencordLayer: true,
      backupExists,
      reason: null
    });
  }

  if (backupExists) {
    return withLegacyFields({
      state: "official-with-dmi-backup",
      activeChain: ["official"],
      canInstallSelf: true,
      canUninstallSelf: false,
      canUninstallVencordLayer: false,
      backupExists,
      reason: null
    });
  }

  return withLegacyFields({
    state: "official-only",
    activeChain: ["official"],
    canInstallSelf: true,
    canUninstallSelf: false,
    canUninstallVencordLayer: false,
    backupExists,
    reason: null
  });
}

function withLegacyFields(state) {
  const alreadyInstalled = state.activeChain.includes("mobile");
  const action = getLegacyAction(state);
  return {
    ...state,
    action,
    canInstall: state.canInstallSelf,
    alreadyInstalled,
    backupExists: state.backupExists,
    reason: state.reason
  };
}

function getLegacyAction(state) {
  if (state.reason) return "abort";
  if (state.state === "mobile-only" || state.state === "vencord-then-mobile") {
    return "already-installed";
  }
  return state.canInstallSelf ? "install" : "abort";
}
