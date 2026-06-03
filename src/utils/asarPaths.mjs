import path from "node:path";
import { APP_ASAR_NAME, BACKUP_ASAR_NAME, LEGACY_BACKUP_ASAR_NAME } from "../config.mjs";

export function getAppAsarPath(resourcesDir) {
  return path.join(resourcesDir, APP_ASAR_NAME);
}

export function getBackupAsarPath(resourcesDir) {
  return path.join(resourcesDir, BACKUP_ASAR_NAME);
}

export function getLegacyBackupAsarPath(resourcesDir) {
  return path.join(resourcesDir, LEGACY_BACKUP_ASAR_NAME);
}
