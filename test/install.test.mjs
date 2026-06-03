import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import asar from "@electron/asar";
import { buildLoaderAsar } from "../src/install/buildLoaderAsar.mjs";
import { installToResources } from "../src/install/install.mjs";
import { evaluateInstallState, isOurLoader } from "../src/install/guard.mjs";

test("install renames current app.asar to backup and places loader", async () => {
  await usingFixture(async (resourcesDir) => {
    await fs.writeFile(path.join(resourcesDir, "app.asar"), "official");

    const result = await installToResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(result.installed, true);
    assert.equal(await isOurLoader(path.join(resourcesDir, "app.asar")), true);
    assert.equal(await fs.readFile(path.join(resourcesDir, "app.asar.mobile-status-backup"), "utf8"), "official");
  });
});

test("install does not touch _app.asar in Vencord-like resources", async () => {
  await usingFixture(async (resourcesDir) => {
    await fs.writeFile(path.join(resourcesDir, "app.asar"), "vencord loader");
    await fs.writeFile(path.join(resourcesDir, "_app.asar"), "official discord");

    await installToResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(await fs.readFile(path.join(resourcesDir, "_app.asar"), "utf8"), "official discord");
    assert.equal(await fs.readFile(path.join(resourcesDir, "app.asar.mobile-status-backup"), "utf8"), "vencord loader");
  });
});

test("second install does not overwrite backup", async () => {
  await usingFixture(async (resourcesDir) => {
    await fs.writeFile(path.join(resourcesDir, "app.asar"), "official");

    await installToResources(resourcesDir, { skipProcessCheck: true });
    const firstBackup = await fs.readFile(path.join(resourcesDir, "app.asar.mobile-status-backup"), "utf8");
    const second = await installToResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(second.alreadyInstalled, true);
    assert.equal(await fs.readFile(path.join(resourcesDir, "app.asar.mobile-status-backup"), "utf8"), firstBackup);
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
