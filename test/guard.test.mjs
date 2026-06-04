import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import asar from "@electron/asar";
import {
  BACKUP_ASAR_NAME,
  MARKER_JSON_NAME
} from "../src/config.mjs";
import { installToResources } from "../src/install/install.mjs";
import { evaluateInstallState, isOurLoader } from "../src/install/guard.mjs";

test("evaluateInstallState allows install for official-only", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeOfficialDiscordAsar(path.join(resourcesDir, "app.asar"));

    const state = await evaluateInstallState(resourcesDir);

    assert.equal(state.state, "official-only");
    assert.equal(state.action, "install");
    assert.equal(state.canInstall, true);
    assert.deepEqual(state.activeChain, ["official"]);
  });
});

test("evaluateInstallState does not treat official denylist text as Vencord", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeOfficialDiscordAsar(path.join(resourcesDir, "app.asar"), {
      body: 'const ignoreErrors = ["BetterDiscord", "VencordPatcher"];\n'
    });

    const state = await evaluateInstallState(resourcesDir);

    assert.equal(state.state, "official-only");
    assert.equal(state.canInstall, true);
  });
});

test("evaluateInstallState classifies dmi-only", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeOfficialDiscordAsar(path.join(resourcesDir, "app.asar"));
    await installToResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(await isOurLoader(path.join(resourcesDir, "app.asar")), true);

    const state = await evaluateInstallState(resourcesDir);
    assert.equal(state.state, "dmi-only");
    assert.equal(state.action, "already-installed");
    assert.equal(state.alreadyInstalled, true);
    assert.deepEqual(state.activeChain, ["dmi", "official"]);
  });
});

test("evaluateInstallState classifies vencord-over-dmi", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeOfficialDiscordAsar(path.join(resourcesDir, "app.asar"));
    await installToResources(resourcesDir, { skipProcessCheck: true });
    await fs.rename(path.join(resourcesDir, "app.asar"), path.join(resourcesDir, "_app.asar"));
    await writeVencordLoader(path.join(resourcesDir, "app.asar"));

    const state = await evaluateInstallState(resourcesDir);

    assert.equal(state.state, "vencord-over-dmi");
    assert.equal(state.action, "abort");
    assert.deepEqual(state.activeChain, ["vencord", "dmi", "official"]);
    assert.equal(state.canUninstallSelf, false);
  });
});

test("evaluateInstallState rejects vencord-only", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeVencordLoader(path.join(resourcesDir, "app.asar"));
    await writeOfficialDiscordAsar(path.join(resourcesDir, "_app.asar"));

    const state = await evaluateInstallState(resourcesDir);

    assert.equal(state.state, "vencord-only");
    assert.equal(state.action, "abort");
    assert.match(state.reason, /clean official Discord app\.asar/);
  });
});

test("evaluateInstallState treats DMI backup without marker as broken", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeOfficialDiscordAsar(path.join(resourcesDir, "app.asar"));
    await writeOfficialDiscordAsar(path.join(resourcesDir, BACKUP_ASAR_NAME));

    const state = await evaluateInstallState(resourcesDir);

    assert.equal(state.state, "broken-or-partial");
    assert.equal(state.action, "abort");
    assert.match(state.reason, /inconsistent/);
  });
});

test("evaluateInstallState treats marker without backup as broken", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeOfficialDiscordAsar(path.join(resourcesDir, "app.asar"));
    await fs.writeFile(path.join(resourcesDir, MARKER_JSON_NAME), "{}\n");

    const state = await evaluateInstallState(resourcesDir);

    assert.equal(state.state, "broken-or-partial");
    assert.equal(state.action, "abort");
  });
});

test("evaluateInstallState aborts when app.asar is missing", async () => {
  await usingFixture(async (resourcesDir) => {
    const state = await evaluateInstallState(resourcesDir);

    assert.equal(state.action, "abort");
    assert.match(state.reason, /app\.asar not found/);
  });
});

async function usingFixture(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mobile-identify-guard-"));
  try {
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeOfficialDiscordAsar(outputPath, { body = "module.exports = {};\n" } = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "official-discord-"));
  try {
    await fs.writeFile(path.join(tempDir, "package.json"), JSON.stringify({ name: "discord", main: "index.js" }));
    await fs.writeFile(path.join(tempDir, "index.js"), body);
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
