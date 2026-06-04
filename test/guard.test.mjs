import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BACKUP_ASAR_NAME,
  VENCORD_LOADER_ASAR_NAME
} from "../src/config.mjs";
import { buildLoaderAsar } from "../src/install/buildLoaderAsar.mjs";
import { evaluateInstallState, isOurLoader } from "../src/install/guard.mjs";
import asar from "@electron/asar";

test("evaluateInstallState allows install when app.asar exists and backup is absent", async () => {
  await usingFixture(async (resourcesDir) => {
    await fs.writeFile(path.join(resourcesDir, "app.asar"), "official");

    const state = await evaluateInstallState(resourcesDir);

    assert.equal(state.state, "official-only");
    assert.equal(state.action, "install");
    assert.equal(state.canInstall, true);
    assert.deepEqual(state.activeChain, ["official"]);
  });
});

test("evaluateInstallState treats marker app.asar as already installed", async () => {
  await usingFixture(async (resourcesDir) => {
    const appAsar = path.join(resourcesDir, "app.asar");
    await buildLoaderAsar(appAsar);
    await fs.writeFile(path.join(resourcesDir, "_app.asar"), "official");

    assert.equal(await isOurLoader(appAsar), true);

    const state = await evaluateInstallState(resourcesDir);
    assert.equal(state.state, "mobile-only");
    assert.equal(state.action, "already-installed");
    assert.equal(state.alreadyInstalled, true);
    assert.deepEqual(state.activeChain, ["mobile", "official"]);
  });
});

test("evaluateInstallState aborts when mobile loader has no official body", async () => {
  await usingFixture(async (resourcesDir) => {
    await buildLoaderAsar(path.join(resourcesDir, "app.asar"));

    const state = await evaluateInstallState(resourcesDir);

    assert.equal(state.state, "mobile-missing-official");
    assert.equal(state.action, "abort");
    assert.deepEqual(state.activeChain, ["mobile"]);
    assert.equal(state.canUninstallSelf, false);
  });
});

test("evaluateInstallState allows install when app.dmi.asar exists with official app.asar", async () => {
  await usingFixture(async (resourcesDir) => {
    await fs.writeFile(path.join(resourcesDir, "app.asar"), "official");
    await fs.writeFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "previous");

    const state = await evaluateInstallState(resourcesDir);

    assert.equal(state.state, "official-with-dmi-backup");
    assert.equal(state.action, "install");
    assert.equal(state.canInstall, true);
  });
});

test("evaluateInstallState aborts when app.asar is missing", async () => {
  await usingFixture(async (resourcesDir) => {
    const state = await evaluateInstallState(resourcesDir);

    assert.equal(state.action, "abort");
    assert.match(state.reason, /app\.asar not found/);
  });
});

test("evaluateInstallState classifies vencord-only", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeVencordLoader(path.join(resourcesDir, "app.asar"));
    await fs.writeFile(path.join(resourcesDir, "_app.asar"), "official");

    const state = await evaluateInstallState(resourcesDir);

    assert.equal(state.state, "vencord-only");
    assert.deepEqual(state.activeChain, ["vencord", "official"]);
    assert.equal(state.canInstallSelf, true);
    assert.equal(state.canUninstallSelf, false);
    assert.equal(state.canUninstallVencordLayer, true);
  });
});

test("evaluateInstallState classifies vencord-then-mobile", async () => {
  await usingFixture(async (resourcesDir) => {
    await buildLoaderAsar(path.join(resourcesDir, "app.asar"));
    await writeVencordLoader(path.join(resourcesDir, VENCORD_LOADER_ASAR_NAME));
    await fs.writeFile(path.join(resourcesDir, "_app.asar"), "official");

    const state = await evaluateInstallState(resourcesDir);

    assert.equal(state.state, "vencord-then-mobile");
    assert.deepEqual(state.activeChain, ["mobile", "vencord", "official"]);
    assert.equal(state.canInstallSelf, true);
    assert.equal(state.canUninstallSelf, true);
    assert.equal(state.canUninstallVencordLayer, true);
  });
});

test("evaluateInstallState aborts when vencord-then-mobile is missing _app.asar body", async () => {
  await usingFixture(async (resourcesDir) => {
    await buildLoaderAsar(path.join(resourcesDir, "app.asar"));
    await writeVencordLoader(path.join(resourcesDir, VENCORD_LOADER_ASAR_NAME));
    await fs.writeFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "official");

    const state = await evaluateInstallState(resourcesDir);

    assert.equal(state.state, "vencord-then-mobile-missing-body");
    assert.equal(state.action, "abort");
    assert.deepEqual(state.activeChain, ["mobile", "vencord"]);
  });
});

test("evaluateInstallState classifies mobile-then-vencord", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeVencordLoader(path.join(resourcesDir, "app.asar"));
    await buildLoaderAsar(path.join(resourcesDir, "_app.asar"));
    await fs.writeFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "official");

    const state = await evaluateInstallState(resourcesDir);

    assert.equal(state.state, "mobile-then-vencord");
    assert.deepEqual(state.activeChain, ["vencord", "mobile", "official"]);
    assert.equal(state.canInstallSelf, true);
    assert.equal(state.canUninstallSelf, true);
    assert.equal(state.canUninstallVencordLayer, true);
  });
});

test("evaluateInstallState aborts when mobile-then-vencord is missing app.dmi.asar fallback", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeVencordLoader(path.join(resourcesDir, "app.asar"));
    await buildLoaderAsar(path.join(resourcesDir, "_app.asar"));

    const state = await evaluateInstallState(resourcesDir);

    assert.equal(state.state, "mobile-then-vencord-missing-official");
    assert.equal(state.action, "abort");
    assert.deepEqual(state.activeChain, ["vencord", "mobile"]);
  });
});

test("evaluateInstallState treats app.asar mobile with only app.dmi.asar as mobile-only variant", async () => {
  await usingFixture(async (resourcesDir) => {
    await buildLoaderAsar(path.join(resourcesDir, "app.asar"));
    await fs.writeFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "official");

    const state = await evaluateInstallState(resourcesDir);

    assert.equal(state.state, "mobile-only");
    assert.deepEqual(state.activeChain, ["mobile", "official"]);
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
