import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import asar from "@electron/asar";
import {
  BACKUP_ASAR_NAME,
  DIRECT_PATCH_MODE,
  MARKER_JSON_NAME
} from "../src/config.mjs";
import {
  installToResources,
  uninstallSelfFromResources
} from "../src/install/install.mjs";
import { evaluateInstallState, isOurLoader } from "../src/install/guard.mjs";

test("install backs up official app.asar, writes patched app.asar, and creates marker", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeOfficialDiscordAsar(path.join(resourcesDir, "app.asar"));

    const result = await installToResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(result.installed, true);
    assert.equal(result.installMode, DIRECT_PATCH_MODE);
    assert.equal(await isOurLoader(path.join(resourcesDir, "app.asar")), true);
    assert.equal(await pathExists(path.join(resourcesDir, BACKUP_ASAR_NAME)), true);
    assert.equal(await pathExists(path.join(resourcesDir, MARKER_JSON_NAME)), true);
    assert.equal(await pathExists(path.join(resourcesDir, "_app.asar")), false);
    assert.equal(await pathExists(path.join(resourcesDir, "app.vc.asar")), false);

    const marker = JSON.parse(await fs.readFile(path.join(resourcesDir, MARKER_JSON_NAME), "utf8"));
    assert.equal(marker.mode, DIRECT_PATCH_MODE);
    assert.equal(marker.backup, BACKUP_ASAR_NAME);
    assert.equal(typeof marker.originalSha256, "string");
    assert.equal(typeof marker.patchedSha256, "string");
  });
});

test("patched app.asar wraps original package main", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeOfficialDiscordAsar(path.join(resourcesDir, "app.asar"), { main: "main.js" });

    await installToResources(resourcesDir, { skipProcessCheck: true });

    const packageJson = JSON.parse(await readAsarText(path.join(resourcesDir, "app.asar"), "package.json"));
    const mainSource = await readAsarText(path.join(resourcesDir, "app.asar"), "dmi-main.js");

    assert.equal(packageJson.main, "dmi-main.js");
    assert.equal(packageJson.dmiPatcher.originalMain, "main.js");
    assert.match(mainSource, /mobileIdentifyHook/);
    assert.match(mainSource, /require\(path\.join\(__dirname, "main\.js"\)\)/);
  });
});

test("second install reports already installed and does not overwrite backup", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeOfficialDiscordAsar(path.join(resourcesDir, "app.asar"), { body: "first" });

    await installToResources(resourcesDir, { skipProcessCheck: true });
    const firstBackupHash = await fs.readFile(path.join(resourcesDir, BACKUP_ASAR_NAME));
    const result = await installToResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(result.alreadyInstalled, true);
    assert.deepEqual(await fs.readFile(path.join(resourcesDir, BACKUP_ASAR_NAME)), firstBackupHash);
  });
});

test("install rejects an existing Vencord chain", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeVencordLoader(path.join(resourcesDir, "app.asar"));
    await writeOfficialDiscordAsar(path.join(resourcesDir, "_app.asar"));

    await assert.rejects(
      installToResources(resourcesDir, { skipProcessCheck: true }),
      /clean official Discord app\.asar/
    );
  });
});

test("uninstall restores official app.asar and removes DMI files", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeOfficialDiscordAsar(path.join(resourcesDir, "app.asar"), { body: "official body" });
    await installToResources(resourcesDir, { skipProcessCheck: true });

    const result = await uninstallSelfFromResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(result.uninstalled, true);
    assert.equal((await evaluateInstallState(resourcesDir)).state, "official-only");
    assert.equal(await pathExists(path.join(resourcesDir, BACKUP_ASAR_NAME)), false);
    assert.equal(await pathExists(path.join(resourcesDir, MARKER_JSON_NAME)), false);
    assert.equal(await readAsarText(path.join(resourcesDir, "app.asar"), "main.js"), "official body\n");
  });
});

test("uninstall rejects when DMI is under Vencord", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeOfficialDiscordAsar(path.join(resourcesDir, "app.asar"));
    await installToResources(resourcesDir, { skipProcessCheck: true });
    await fs.rename(path.join(resourcesDir, "app.asar"), path.join(resourcesDir, "_app.asar"));
    await writeVencordLoader(path.join(resourcesDir, "app.asar"));

    await assert.rejects(
      uninstallSelfFromResources(resourcesDir, { skipProcessCheck: true }),
      /Uninstall Vencord first/
    );
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

async function writeOfficialDiscordAsar(outputPath, { main = "main.js", body = "official body" } = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "official-discord-"));
  try {
    await fs.writeFile(path.join(tempDir, "package.json"), JSON.stringify({ name: "discord", main }));
    await fs.writeFile(path.join(tempDir, main), `${body}\n`);
    await asar.createPackage(tempDir, outputPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function writeVencordLoader(outputPath) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vencord-loader-"));
  try {
    await fs.writeFile(path.join(tempDir, "package.json"), JSON.stringify({ name: "discord", main: "index.js" }));
    await fs.writeFile(
      path.join(tempDir, "index.js"),
      'require("/Users/example/Library/Application Support/Vencord/dist/patcher.js");\n'
    );
    await asar.createPackage(tempDir, outputPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function readAsarText(asarPath, fileName) {
  asar.uncache(asarPath);
  return asar.extractFile(asarPath, fileName).toString("utf8");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
