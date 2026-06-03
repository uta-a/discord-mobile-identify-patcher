import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildLoaderAsar } from "../src/install/buildLoaderAsar.mjs";
import { evaluateInstallState, isOurLoader } from "../src/install/guard.mjs";

test("evaluateInstallState allows install when app.asar exists and backup is absent", async () => {
  await usingFixture(async (resourcesDir) => {
    await fs.writeFile(path.join(resourcesDir, "app.asar"), "official");

    const state = await evaluateInstallState(resourcesDir);

    assert.equal(state.action, "install");
    assert.equal(state.canInstall, true);
  });
});

test("evaluateInstallState treats marker app.asar as already installed", async () => {
  await usingFixture(async (resourcesDir) => {
    const appAsar = path.join(resourcesDir, "app.asar");
    await buildLoaderAsar(appAsar);

    assert.equal(await isOurLoader(appAsar), true);

    const state = await evaluateInstallState(resourcesDir);
    assert.equal(state.action, "already-installed");
    assert.equal(state.alreadyInstalled, true);
  });
});

test("evaluateInstallState aborts when backup exists but app.asar is not our loader", async () => {
  await usingFixture(async (resourcesDir) => {
    await fs.writeFile(path.join(resourcesDir, "app.asar"), "official");
    await fs.writeFile(path.join(resourcesDir, "app.asar.mobile-status-backup"), "previous");

    const state = await evaluateInstallState(resourcesDir);

    assert.equal(state.action, "abort");
    assert.match(state.reason, /backup already exists/);
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
