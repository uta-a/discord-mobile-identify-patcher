import path from "node:path";
import {
  APP_ASAR_NAME,
  BACKUP_ASAR_NAME,
  DISCORD_BODY_ASAR_NAME,
  MARKER_JSON_NAME,
  VENCORD_LOADER_ASAR_NAME
} from "../config.mjs";

export function getAppAsarPath(resourcesDir) {
  return path.join(resourcesDir, APP_ASAR_NAME);
}

export function getBackupAsarPath(resourcesDir) {
  return path.join(resourcesDir, BACKUP_ASAR_NAME);
}

export function getMarkerJsonPath(resourcesDir) {
  return path.join(resourcesDir, MARKER_JSON_NAME);
}

export function getDiscordBodyAsarPath(resourcesDir) {
  return path.join(resourcesDir, DISCORD_BODY_ASAR_NAME);
}

export function getVencordLoaderAsarPath(resourcesDir) {
  return path.join(resourcesDir, VENCORD_LOADER_ASAR_NAME);
}
