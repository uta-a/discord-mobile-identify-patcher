import fs from "node:fs/promises";
import asar from "@electron/asar";
import { LOADER_KIND } from "../config.mjs";
import { inspectDiscordAsar, isDmiPatchedAsar } from "./directPatch.mjs";
import {
  getAppAsarPath,
  getBackupAsarPath,
  getDiscordBodyAsarPath,
  getMarkerJsonPath,
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
  return marker?.kind === LOADER_KIND || await isDmiPatchedAsar(appAsarPath);
}

export async function isVencordLoader(appAsarPath) {
  return (await inspectDiscordAsar(appAsarPath)).kind === "vencord-loader";
}

export async function readInstallMarker(resourcesDir) {
  try {
    return JSON.parse(await fs.readFile(getMarkerJsonPath(resourcesDir), "utf8"));
  } catch {
    return null;
  }
}

export async function evaluateInstallState(resourcesDir) {
  const appAsar = getAppAsarPath(resourcesDir);
  const backupAsar = getBackupAsarPath(resourcesDir);
  const markerJson = getMarkerJsonPath(resourcesDir);
  const discordBodyAsar = getDiscordBodyAsarPath(resourcesDir);
  const vencordLoaderAsar = getVencordLoaderAsarPath(resourcesDir);

  const appExists = await pathExists(appAsar);
  const backupExists = await pathExists(backupAsar);
  const markerExists = await pathExists(markerJson);
  const discordBodyExists = await pathExists(discordBodyAsar);
  const legacyVencordLoaderExists = await pathExists(vencordLoaderAsar);

  if (!appExists) {
    return withLegacyFields({
      state: "missing-app",
      activeChain: [],
      canInstallSelf: false,
      canUninstallSelf: false,
      canUninstallVencordLayer: false,
      backupExists,
      markerExists,
      reason: "app.asar not found"
    });
  }

  if (legacyVencordLoaderExists || backupExists !== markerExists) {
    return broken({
      backupExists,
      markerExists,
      reason: legacyVencordLoaderExists
        ? "legacy app.vc.asar was found"
        : "DMI backup and marker files are inconsistent"
    });
  }

  const appInfo = await inspectDiscordAsar(appAsar);
  const bodyInfo = discordBodyExists ? await inspectDiscordAsar(discordBodyAsar) : null;

  if (backupExists && markerExists) {
    if (discordBodyExists) {
      if (appInfo.kind === "vencord-loader" && bodyInfo?.kind === "dmi-patched") {
        return withLegacyFields({
          state: "vencord-over-dmi",
          activeChain: ["vencord", "dmi", "official"],
          canInstallSelf: false,
          canUninstallSelf: false,
          canUninstallVencordLayer: false,
          backupExists,
          markerExists,
          reason: "DMI appears to be installed under Vencord. Uninstall Vencord first, then run DMI uninstall."
        });
      }

      return broken({
        backupExists,
        markerExists,
        reason: "_app.asar exists but app.asar is not a recognized Vencord-over-DMI loader"
      });
    }

    if (appInfo.kind !== "dmi-patched") {
      return broken({
        backupExists,
        markerExists,
        reason: "DMI marker exists but app.asar is not DMI patched"
      });
    }

    return withLegacyFields({
      state: "dmi-only",
      activeChain: ["dmi", "official"],
      canInstallSelf: false,
      canUninstallSelf: true,
      canUninstallVencordLayer: false,
      backupExists,
      markerExists,
      reason: null
    });
  }

  if (discordBodyExists) {
    if (appInfo.kind === "vencord-loader") {
      return withLegacyFields({
        state: "vencord-only",
        activeChain: ["vencord", "official"],
        canInstallSelf: false,
        canUninstallSelf: false,
        canUninstallVencordLayer: false,
        backupExists,
        markerExists,
        reason: "Vencord or another third-party loader appears to be installed. DMI only supports installation on a clean official Discord app.asar."
      });
    }

    return broken({
      backupExists,
      markerExists,
      reason: "_app.asar exists without a recognized Vencord loader"
    });
  }

  if (appInfo.kind === "official") {
    return withLegacyFields({
      state: "official-only",
      activeChain: ["official"],
      canInstallSelf: true,
      canUninstallSelf: false,
      canUninstallVencordLayer: false,
      backupExists,
      markerExists,
      reason: null
    });
  }

  if (appInfo.kind === "vencord-loader") {
    return withLegacyFields({
      state: "vencord-only",
      activeChain: ["vencord"],
      canInstallSelf: false,
      canUninstallSelf: false,
      canUninstallVencordLayer: false,
      backupExists,
      markerExists,
      reason: "Vencord or another third-party loader appears to be installed. DMI only supports installation on a clean official Discord app.asar."
    });
  }

  return withLegacyFields({
    state: "unknown-third-party-loader",
    activeChain: [appInfo.kind],
    canInstallSelf: false,
    canUninstallSelf: false,
    canUninstallVencordLayer: false,
    backupExists,
    markerExists,
    reason: "DMI cannot safely modify this Discord installation. Please restore official Discord first."
  });
}

function broken({ backupExists, markerExists, reason }) {
  return withLegacyFields({
    state: "broken-or-partial",
    activeChain: [],
    canInstallSelf: false,
    canUninstallSelf: false,
    canUninstallVencordLayer: false,
    backupExists,
    markerExists,
    reason
  });
}

function withLegacyFields(state) {
  const alreadyInstalled = state.activeChain.includes("dmi");
  const action = getLegacyAction(state);
  return {
    ...state,
    action,
    canInstall: state.canInstallSelf,
    alreadyInstalled,
    backupExists: state.backupExists,
    markerExists: state.markerExists,
    reason: state.reason
  };
}

function getLegacyAction(state) {
  if (state.state === "official-only") return "install";
  if (state.state === "dmi-only") return "already-installed";
  return "abort";
}
