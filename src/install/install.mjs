import fs from "node:fs/promises";
import path from "node:path";
import { buildLoaderAsar } from "./buildLoaderAsar.mjs";
import { evaluateInstallState, isOurLoader } from "./guard.mjs";
import { getAppAsarPath, getBackupAsarPath } from "../utils/asarPaths.mjs";
import { sha256File } from "../utils/hash.mjs";
import { assertDiscordNotRunning } from "./processGuard.mjs";

export async function installToResources(resourcesDir, { skipProcessCheck = false } = {}) {
  if (!skipProcessCheck) {
    await assertDiscordNotRunning(resourcesDir);
  }

  const state = await evaluateInstallState(resourcesDir);

  if (state.action === "already-installed") {
    return { installed: false, alreadyInstalled: true, state };
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
    await fs.rename(appAsar, backupAsar);
    renamedOriginal = true;
    await fs.rename(tempLoaderAsar, appAsar);

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

    throw error;
  }
}
