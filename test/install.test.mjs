import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import asar from "@electron/asar";
import {
  BACKUP_ASAR_NAME,
  DISCORD_BODY_ASAR_NAME,
  VENCORD_LOADER_ASAR_NAME
} from "../src/config.mjs";
import { buildLoaderAsar } from "../src/install/buildLoaderAsar.mjs";
import {
  installToResources,
  uninstallSelfFromResources,
  uninstallVencordLayerFromResources
} from "../src/install/install.mjs";
import { evaluateInstallState, isOurLoader } from "../src/install/guard.mjs";

test("install renames current app.asar to backup and places loader", async () => {
  await usingFixture(async (resourcesDir) => {
    await fs.writeFile(path.join(resourcesDir, "app.asar"), "official");

    const result = await installToResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(result.installed, true);
    assert.equal(await isOurLoader(path.join(resourcesDir, "app.asar")), true);
    assert.equal(await fs.readFile(path.join(resourcesDir, DISCORD_BODY_ASAR_NAME), "utf8"), "official");
    assert.equal(await fs.readFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "utf8"), "official");
  });
});

test("install preserves Vencord chain by moving Vencord loader to app.vc.asar", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeVencordLoader(path.join(resourcesDir, "app.asar"));
    await fs.writeFile(path.join(resourcesDir, "_app.asar"), "official discord");

    const result = await installToResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(result.installMode, "vencord-chain");
    assert.equal(await isOurLoader(path.join(resourcesDir, "app.asar")), true);
    assert.equal(await fs.readFile(path.join(resourcesDir, "_app.asar"), "utf8"), "official discord");
    assert.match(await readAsarText(path.join(resourcesDir, VENCORD_LOADER_ASAR_NAME), "index.js"), /Vencord/);
    assert.equal(await pathExists(path.join(resourcesDir, BACKUP_ASAR_NAME)), false);
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

test("direct-discord mode repairs mobile-only instead of moving its Discord body away", async () => {
  await usingFixture(async (resourcesDir) => {
    await buildLoaderAsar(path.join(resourcesDir, "app.asar"));
    await fs.writeFile(path.join(resourcesDir, "_app.asar"), "official discord");
    await fs.writeFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "official fallback");

    const result = await installToResources(resourcesDir, {
      skipProcessCheck: true,
      installMode: "direct-discord"
    });

    assert.equal(result.repaired, true);
    assert.equal(await isOurLoader(path.join(resourcesDir, "app.asar")), true);
    assert.equal(await fs.readFile(path.join(resourcesDir, "_app.asar"), "utf8"), "official discord");
    assert.equal(await fs.readFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "utf8"), "official fallback");
  });
});

test("direct-discord mode removes Vencord from mobile-then-vencord without losing official body", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeVencordLoader(path.join(resourcesDir, "app.asar"));
    await buildLoaderAsar(path.join(resourcesDir, "_app.asar"));
    await fs.writeFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "official discord");

    const result = await installToResources(resourcesDir, {
      skipProcessCheck: true,
      installMode: "direct-discord"
    });

    assert.equal(result.command, "uninstall-vencord-layer");
    assert.equal(await isOurLoader(path.join(resourcesDir, "app.asar")), true);
    assert.equal(await fs.readFile(path.join(resourcesDir, "_app.asar"), "utf8"), "official discord");
    assert.equal(await fs.readFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "utf8"), "official discord");
  });
});

test("direct-discord mode removes Vencord from vencord-then-mobile without deleting Discord body", async () => {
  await usingFixture(async (resourcesDir) => {
    await buildLoaderAsar(path.join(resourcesDir, "app.asar"));
    await writeVencordLoader(path.join(resourcesDir, VENCORD_LOADER_ASAR_NAME));
    await fs.writeFile(path.join(resourcesDir, "_app.asar"), "official discord");

    const result = await installToResources(resourcesDir, {
      skipProcessCheck: true,
      installMode: "direct-discord"
    });

    assert.equal(result.removedVencordLayer, true);
    assert.equal(result.repaired, true);
    assert.equal(await isOurLoader(path.join(resourcesDir, "app.asar")), true);
    assert.equal(await fs.readFile(path.join(resourcesDir, "_app.asar"), "utf8"), "official discord");
    assert.equal(await pathExists(path.join(resourcesDir, VENCORD_LOADER_ASAR_NAME)), false);
  });
});

test("default install mode backs up Discord body from Vencord-like _app.asar", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeVencordLoader(path.join(resourcesDir, "app.asar"));
    await fs.writeFile(path.join(resourcesDir, "_app.asar"), "official discord");

    await installToResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(await isOurLoader(path.join(resourcesDir, "app.asar")), true);
    assert.equal(await fs.readFile(path.join(resourcesDir, "_app.asar"), "utf8"), "official discord");
    assert.match(await readAsarText(path.join(resourcesDir, VENCORD_LOADER_ASAR_NAME), "index.js"), /Vencord/);
  });
});

test("install normalizes Vencord after existing mobile loader install", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeVencordLoader(path.join(resourcesDir, "app.asar"));
    await buildLoaderAsar(path.join(resourcesDir, "_app.asar"));
    await fs.writeFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "official discord");

    const result = await installToResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(result.installed, true);
    assert.equal(result.normalizedExistingMobileLoader, true);
    assert.equal(await isOurLoader(path.join(resourcesDir, "app.asar")), true);
    assert.equal(await fs.readFile(path.join(resourcesDir, "_app.asar"), "utf8"), "official discord");
    assert.match(await readAsarText(path.join(resourcesDir, VENCORD_LOADER_ASAR_NAME), "index.js"), /Vencord/);
    assert.equal(await pathExists(path.join(resourcesDir, BACKUP_ASAR_NAME)), false);
  });
});

test("uninstall-self from mobile-only restores official app and removes fallback", async () => {
  await usingFixture(async (resourcesDir) => {
    await buildLoaderAsar(path.join(resourcesDir, "app.asar"));
    await fs.writeFile(path.join(resourcesDir, "_app.asar"), "official discord");
    await fs.writeFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "official discord");

    const result = await uninstallSelfFromResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(result.uninstalled, true);
    assert.equal(await fs.readFile(path.join(resourcesDir, "app.asar"), "utf8"), "official discord");
    assert.equal(await pathExists(path.join(resourcesDir, BACKUP_ASAR_NAME)), false);
  });
});

test("uninstall-self from vencord-then-mobile restores vencord-only", async () => {
  await usingFixture(async (resourcesDir) => {
    await buildLoaderAsar(path.join(resourcesDir, "app.asar"));
    await writeVencordLoader(path.join(resourcesDir, VENCORD_LOADER_ASAR_NAME));
    await fs.writeFile(path.join(resourcesDir, "_app.asar"), "official discord");
    await fs.writeFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "official discord");

    const result = await uninstallSelfFromResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(result.uninstalled, true);
    assert.match(await readAsarText(path.join(resourcesDir, "app.asar"), "index.js"), /Vencord/);
    assert.equal(await fs.readFile(path.join(resourcesDir, "_app.asar"), "utf8"), "official discord");
    assert.equal(await pathExists(path.join(resourcesDir, VENCORD_LOADER_ASAR_NAME)), false);
    assert.equal(await pathExists(path.join(resourcesDir, BACKUP_ASAR_NAME)), false);
  });
});

test("uninstall-self from mobile-then-vencord restores vencord-only", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeVencordLoader(path.join(resourcesDir, "app.asar"));
    await buildLoaderAsar(path.join(resourcesDir, "_app.asar"));
    await fs.writeFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "official discord");

    const result = await uninstallSelfFromResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(result.uninstalled, true);
    assert.match(await readAsarText(path.join(resourcesDir, "app.asar"), "index.js"), /Vencord/);
    assert.equal(await fs.readFile(path.join(resourcesDir, "_app.asar"), "utf8"), "official discord");
    assert.equal(await pathExists(path.join(resourcesDir, BACKUP_ASAR_NAME)), false);
  });
});

test("uninstall-vencord-layer from vencord-then-mobile restores mobile-only", async () => {
  await usingFixture(async (resourcesDir) => {
    await buildLoaderAsar(path.join(resourcesDir, "app.asar"));
    await writeVencordLoader(path.join(resourcesDir, VENCORD_LOADER_ASAR_NAME));
    await fs.writeFile(path.join(resourcesDir, "_app.asar"), "official discord");

    const result = await uninstallVencordLayerFromResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(result.uninstalled, true);
    assert.equal(await isOurLoader(path.join(resourcesDir, "app.asar")), true);
    assert.equal(await fs.readFile(path.join(resourcesDir, "_app.asar"), "utf8"), "official discord");
    assert.equal(await pathExists(path.join(resourcesDir, VENCORD_LOADER_ASAR_NAME)), false);
  });
});

test("uninstall-vencord-layer from mobile-then-vencord restores mobile-only", async () => {
  await usingFixture(async (resourcesDir) => {
    await writeVencordLoader(path.join(resourcesDir, "app.asar"));
    await buildLoaderAsar(path.join(resourcesDir, "_app.asar"));
    await fs.writeFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "official discord");

    const result = await uninstallVencordLayerFromResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(result.uninstalled, true);
    assert.equal(await isOurLoader(path.join(resourcesDir, "app.asar")), true);
    assert.equal(await fs.readFile(path.join(resourcesDir, "_app.asar"), "utf8"), "official discord");
    assert.equal(await fs.readFile(path.join(resourcesDir, BACKUP_ASAR_NAME), "utf8"), "official discord");
  });
});

test("second install does not overwrite backup", async () => {
  await usingFixture(async (resourcesDir) => {
    await fs.writeFile(path.join(resourcesDir, "app.asar"), "official");

    await installToResources(resourcesDir, { skipProcessCheck: true });
    const firstBackup = await fs.readFile(path.join(resourcesDir, DISCORD_BODY_ASAR_NAME), "utf8");
    const second = await installToResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(second.alreadyInstalled, true);
    assert.equal(await fs.readFile(path.join(resourcesDir, DISCORD_BODY_ASAR_NAME), "utf8"), firstBackup);
  });
});

test("reinstall repairs active mobile loader when _app.asar exists without app.dmi.asar", async () => {
  await usingFixture(async (resourcesDir) => {
    await buildLoaderAsar(path.join(resourcesDir, "app.asar"));
    await fs.writeFile(path.join(resourcesDir, "_app.asar"), "official discord");

    const result = await installToResources(resourcesDir, { skipProcessCheck: true });

    assert.equal(result.alreadyInstalled, true);
    assert.equal(result.repaired, true);
    assert.equal(await isOurLoader(path.join(resourcesDir, "app.asar")), true);
    assert.equal(await fs.readFile(path.join(resourcesDir, "_app.asar"), "utf8"), "official discord");
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
