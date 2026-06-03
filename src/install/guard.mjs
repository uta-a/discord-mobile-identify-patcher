import fs from "node:fs/promises";
import asar from "@electron/asar";
import { LOADER_KIND } from "../config.mjs";
import { getAppAsarPath, getBackupAsarPath } from "../utils/asarPaths.mjs";
import { pathExists } from "../utils/fileOps.mjs";

export async function readMarker(appAsarPath) {
  try {
    const stat = await fs.stat(appAsarPath);
    if (stat.isDirectory()) {
      const marker = await fs.readFile(`${appAsarPath}/marker.json`, "utf8");
      return JSON.parse(marker);
    }

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

export async function evaluateInstallState(resourcesDir) {
  const appAsar = getAppAsarPath(resourcesDir);
  const backupAsar = getBackupAsarPath(resourcesDir);

  if (!(await pathExists(appAsar))) {
    return {
      action: "abort",
      canInstall: false,
      alreadyInstalled: false,
      backupExists: await pathExists(backupAsar),
      reason: "app.asar not found"
    };
  }

  if (await isOurLoader(appAsar)) {
    return {
      action: "already-installed",
      canInstall: false,
      alreadyInstalled: true,
      backupExists: await pathExists(backupAsar),
      reason: null
    };
  }

  if (await pathExists(backupAsar)) {
    return {
      action: "abort",
      canInstall: false,
      alreadyInstalled: false,
      backupExists: true,
      reason: "backup already exists and app.asar is not our loader"
    };
  }

  return {
    action: "install",
    canInstall: true,
    alreadyInstalled: false,
    backupExists: false,
    reason: null
  };
}
