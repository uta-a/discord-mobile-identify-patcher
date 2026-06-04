import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import asar from "@electron/asar";
import { BACKUP_ASAR_NAME, LEGACY_BACKUP_ASAR_NAME } from "../src/config.mjs";
import { buildLoaderAsar } from "../src/install/buildLoaderAsar.mjs";
import { installToResources } from "../src/install/install.mjs";
import { evaluateInstallState, isOurLoader } from "../src/install/guard.mjs";

test("install renames current app.asar to backup and places loader", async () => {
  await usingFixture(async (resourcesDir) => {
    await fs.writeFile(path.join(resourcesDir, "app.asar"), "official");

    const result = await installToResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(result.installed, true);
    assert.equal(await isOurLoader(path.join(resourcesDir, "app.asar")), true);
    assert.equal(await fs.readFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "utf8"), "official");
  });
});

test("install does not touch _app.asar in Vencord-like resources", async () => {
  await usingFixture(async (resourcesDir) => {
    await fs.writeFile(path.join(resourcesDir, "app.asar"), "vencord loader");
    await fs.writeFile(path.join(resourcesDir, "_app.asar"), "official discord");

    await installToResources(resourcesDir, { skipProcessCheck: true, installMode: "preserve-existing" });

    assert.equal(await fs.readFile(path.join(resourcesDir, "_app.asar"), "utf8"), "official discord");
    assert.equal(await fs.readFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "utf8"), "vencord loader");
  });
});

test("direct-discord mode removes Vencord-like active layer and backs up Discord body", async () => {
  await usingFixture(async (resourcesDir) => {
    await fs.writeFile(path.join(resourcesDir, "app.asar"), "vencord loader");
    await fs.writeFile(path.join(resourcesDir, "_app.asar"), "official discord");

    const result = await installToResources(resourcesDir, {
      skipProcessCheck: true,
      installMode: "direct-discord"
    });

    assert.equal(result.installed, true);
    assert.equal(result.installMode, "direct-discord");
    assert.equal(result.disabledExistingLayer, true);
    assert.equal(await isOurLoader(path.join(resourcesDir, "app.asar")), true);
    assert.equal(await fs.readFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "utf8"), "official discord");
    assert.equal(await pathExists(path.join(resourcesDir, "_app.asar")), false);
  });
});

test("default install mode backs up Discord body from Vencord-like _app.asar", async () => {
  await usingFixture(async (resourcesDir) => {
    await fs.writeFile(path.join(resourcesDir, "app.asar"), "vencord loader");
    await fs.writeFile(path.join(resourcesDir, "_app.asar"), "official discord");

    await installToResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(await isOurLoader(path.join(resourcesDir, "app.asar")), true);
    assert.equal(await fs.readFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "utf8"), "official discord");
    assert.equal(await pathExists(path.join(resourcesDir, "_app.asar")), false);
  });
});

test("direct-discord mode converts an existing preserve install without leaving Vencord layer active", async () => {
  await usingFixture(async (resourcesDir) => {
    await buildLoaderAsar(path.join(resourcesDir, "app.asar"));
    await fs.writeFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "vencord loader");
    await fs.writeFile(path.join(resourcesDir, "_app.asar"), "official discord");

    const result = await installToResources(resourcesDir, {
      skipProcessCheck: true,
      installMode: "direct-discord"
    });

    assert.equal(result.installed, true);
    assert.equal(await isOurLoader(path.join(resourcesDir, "app.asar")), true);
    assert.equal(await fs.readFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "utf8"), "official discord");
    assert.equal(await pathExists(path.join(resourcesDir, "_app.asar")), false);
  });
});

test("second install does not overwrite backup", async () => {
  await usingFixture(async (resourcesDir) => {
    await fs.writeFile(path.join(resourcesDir, "app.asar"), "official");

    await installToResources(resourcesDir, { skipProcessCheck: true });
    const firstBackup = await fs.readFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "utf8");
    const second = await installToResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(second.alreadyInstalled, true);
    assert.equal(await fs.readFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "utf8"), firstBackup);
  });
});

test("already installed legacy backup is migrated and loader is repaired", async () => {
  await usingFixture(async (resourcesDir) => {
    const appAsar = path.join(resourcesDir, "app.asar");
    const legacyBackupAsar = path.join(resourcesDir, LEGACY_BACKUP_ASAR_NAME);
    const backupAsar = path.join(resourcesDir, BACKUP_ASAR_NAME);

    await buildLoaderAsar(appAsar);
    await fs.writeFile(legacyBackupAsar, "official");

    const result = await installToResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(result.alreadyInstalled, true);
    assert.equal(result.repaired, true);
    assert.equal(result.migratedLegacyBackup, true);
    assert.equal(await fs.readFile(backupAsar, "utf8"), "official");
    assert.equal(await pathExists(legacyBackupAsar), false);
    assert.equal(await isOurLoader(appAsar), true);
  });
});

test("isOurLoader does not reuse stale asar cache after app.asar replacement", async () => {
  await usingFixture(async (resourcesDir) => {
    const officialDir = path.join(resourcesDir, "official");
    const officialAsar = path.join(resourcesDir, "app.asar");
    const replacementAsar = path.join(resourcesDir, "replacement.asar");

    await fs.mkdir(officialDir);
    await fs.writeFile(path.join(officialDir, "package.json"), JSON.stringify({ main: "index.js" }));
    await fs.writeFile(path.join(officialDir, "index.js"), "");
    await asar.createPackage(officialDir, officialAsar);

    const state = await evaluateInstallState(resourcesDir);
    assert.equal(state.action, "install");

    await buildLoaderAsar(replacementAsar);
    await fs.rm(officialAsar, { force: true });
    await fs.rename(replacementAsar, officialAsar);

    assert.equal(await isOurLoader(officialAsar), true);
  });
});

async function usingFixture(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mobile-identify-install-"));
  try {
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
