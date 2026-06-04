import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import asar from "@electron/asar";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

test("CLI writes detailed check output to log and prints a short success message", async () => {
  await usingFixture(async ({ resourcesDir, logDir }) => {
    await writeOfficialDiscordAsar(path.join(resourcesDir, "app.asar"));

    const { stdout } = await runCli(["check", "--discord-path", resourcesDir], logDir);

    assert.equal(stdout.trim(), "Success: DMI can be installed.");

    const entries = await readLogEntries(logDir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].command, "check");
    assert.equal(entries[0].state, "official-only");
    assert.equal(entries[0].resourcesDir, resourcesDir);
  });
});

test("CLI --json keeps detailed output on screen", async () => {
  await usingFixture(async ({ resourcesDir, logDir }) => {
    await writeOfficialDiscordAsar(path.join(resourcesDir, "app.asar"));

    const { stdout } = await runCli(["check", "--discord-path", resourcesDir, "--json"], logDir);
    const payload = JSON.parse(stdout);

    assert.equal(payload.state, "official-only");
    assert.equal(payload.resourcesDir, resourcesDir);
  });
});

test("CLI prints a short failure reason and logs the full error", async () => {
  await usingFixture(async ({ resourcesDir, logDir }) => {
    await assert.rejects(
      runCli(["check", "--discord-path", resourcesDir], logDir),
      (error) => {
        assert.match(error.stdout, /Failed: Discord app\.asar was not found\./);
        return true;
      }
    );

    const entries = await readLogEntries(logDir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].command, "check");
    assert.equal(entries[0].state, "missing-app");
    assert.match(entries[0].reason, /app\.asar not found/);
  });
});

async function usingFixture(callback) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dmi-cli-output-"));
  const resourcesDir = path.join(rootDir, "resources");
  const logDir = path.join(rootDir, "logs");

  try {
    await fs.mkdir(resourcesDir, { recursive: true });
    await callback({ resourcesDir, logDir });
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runCli(args, logDir) {
  return await execFileAsync(process.execPath, ["src/cli.mjs", ...args], {
    cwd: root,
    env: {
      ...process.env,
      DMI_LOG_DIR: logDir
    }
  });
}

async function readLogEntries(logDir) {
  const logFile = path.join(logDir, "install.log");
  const text = await fs.readFile(logFile, "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line));
}

async function writeOfficialDiscordAsar(outputPath) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "official-discord-"));
  try {
    await fs.writeFile(path.join(tempDir, "package.json"), JSON.stringify({ name: "discord", main: "index.js" }));
    await fs.writeFile(path.join(tempDir, "index.js"), "module.exports = {};\n");
    await asar.createPackage(tempDir, outputPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
