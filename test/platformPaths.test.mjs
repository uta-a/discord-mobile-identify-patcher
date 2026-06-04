import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findDiscordResourcesPath, getCandidateResourcesPaths } from "../src/detect/platformPaths.mjs";

test("Windows Canary detection prefers the newest app version across LOCALAPPDATA and ProgramData", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dmi-platform-paths-"));
  const localAppData = path.join(tempRoot, "LocalAppData");
  const programData = path.join(tempRoot, "ProgramData");
  const username = "test-user";
  const oldResources = path.join(localAppData, "DiscordCanary", "app-1.0.963", "resources");
  const newResources = path.join(programData, username, "DiscordCanary", "app-1.0.976", "resources");
  const originalEnv = {
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    ProgramData: process.env.ProgramData,
    PROGRAMDATA: process.env.PROGRAMDATA,
    USERNAME: process.env.USERNAME
  };

  try {
    await fs.mkdir(oldResources, { recursive: true });
    await fs.mkdir(newResources, { recursive: true });
    await fs.writeFile(path.join(oldResources, "app.asar"), "");
    await fs.writeFile(path.join(newResources, "app.asar"), "");

    process.env.LOCALAPPDATA = localAppData;
    process.env.ProgramData = programData;
    process.env.PROGRAMDATA = programData;
    process.env.USERNAME = username;

    const candidates = await getCandidateResourcesPaths({ platform: "win32", branch: "canary" });
    assert.equal(candidates[0], newResources);
    assert.equal(await findDiscordResourcesPath({ platform: "win32", branch: "canary" }), newResources);
  } finally {
    restoreEnv("LOCALAPPDATA", originalEnv.LOCALAPPDATA);
    restoreEnv("ProgramData", originalEnv.ProgramData);
    restoreEnv("PROGRAMDATA", originalEnv.PROGRAMDATA);
    restoreEnv("USERNAME", originalEnv.USERNAME);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
