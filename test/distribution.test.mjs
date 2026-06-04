import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

test("distribution scripts include install and uninstall entrypoints for Windows and macOS", async () => {
  const scripts = [
    "scripts/bootstrap-windows.ps1",
    "scripts/install-windows.ps1",
    "scripts/bootstrap-uninstall-windows.ps1",
    "scripts/uninstall-windows.ps1",
    "scripts/bootstrap-macos.sh",
    "scripts/install-macos.sh",
    "scripts/bootstrap-uninstall-macos.sh",
    "scripts/uninstall-macos.sh"
  ];

  for (const script of scripts) {
    const stat = await fs.stat(path.join(root, script));
    assert.equal(stat.isFile(), true, `${script} should exist`);
  }
});

test("package scripts expose local install and uninstall commands", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));

  assert.equal(packageJson.scripts["install:win"], "powershell -ExecutionPolicy Bypass -File scripts/install-windows.ps1");
  assert.equal(packageJson.scripts["install:mac"], "bash scripts/install-macos.sh");
  assert.equal(packageJson.scripts["uninstall:win"], "powershell -ExecutionPolicy Bypass -File scripts/uninstall-windows.ps1");
  assert.equal(packageJson.scripts["uninstall:mac"], "bash scripts/uninstall-macos.sh");
});

test("README documents one-step install and uninstall commands", async () => {
  const readme = await fs.readFile(path.join(root, "README.md"), "utf8");

  assert.match(readme, /bootstrap-windows\.ps1/);
  assert.match(readme, /bootstrap-macos\.sh/);
  assert.match(readme, /bootstrap-uninstall-windows\.ps1/);
  assert.match(readme, /bootstrap-uninstall-macos\.sh/);
  assert.match(readme, /DMI stands for Discord Mobile Identify/);
  assert.match(readme, /Vencord uninstall/);
});

test("CLI help exits successfully", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["src/cli.mjs", "--help"], {
    cwd: root
  });

  assert.match(stdout, /node src\/cli\.mjs install/);
  assert.match(stdout, /node src\/cli\.mjs uninstall/);
  assert.match(stdout, /node src\/cli\.mjs doctor/);
});
