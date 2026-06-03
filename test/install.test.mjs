import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installToResources } from "../src/install/install.mjs";
import { isOurLoader } from "../src/install/guard.mjs";

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

async function usingFixture(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mobile-identify-install-"));
  try {
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
