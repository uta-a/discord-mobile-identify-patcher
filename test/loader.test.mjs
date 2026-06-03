import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  createCombinedPreload,
  loadNextApp,
  patchBrowserWindowPreload,
  withChainedPreload
} = require("../src/loader/core.js");

test("withChainedPreload uses own preload when there is no existing preload", () => {
  const result = withChainedPreload({}, "own-preload.js");

  assert.equal(result.webPreferences.preload, "own-preload.js");
});

test("createCombinedPreload runs own preload before original preload", async () => {
  await usingFixture(async (root) => {
    const electronModule = {
      app: {
        getPath() {
          return root;
        }
      }
    };

    const combinedPath = createCombinedPreload("own.js", "original.js", electronModule);
    const source = await fs.readFile(combinedPath, "utf8");

    assert.match(source, /require\("own\.js"\)/);
    assert.match(source, /require\("original\.js"\)/);
    assert.ok(source.indexOf("own.js") < source.indexOf("original.js"));
  });
});

test("patchBrowserWindowPreload chains BrowserWindow options immutably", async () => {
  await usingFixture(async (root) => {
    let capturedOptions = null;
    class BrowserWindow {
      constructor(options) {
        capturedOptions = options;
      }
    }

    const electronModule = {
      BrowserWindow,
      app: {
        getPath() {
          return root;
        }
      }
    };
    const originalOptions = { webPreferences: { preload: "original.js", sandbox: true } };

    assert.equal(patchBrowserWindowPreload(electronModule, "own.js"), true);
    new electronModule.BrowserWindow(originalOptions);

    assert.notEqual(capturedOptions, originalOptions);
    assert.equal(capturedOptions.webPreferences.sandbox, true);
    assert.match(capturedOptions.webPreferences.preload, /mobile-identify-preload/);
    assert.equal(originalOptions.webPreferences.preload, "original.js");
  });
});

test("loadNextApp requires the next layer package main", async () => {
  await usingFixture(async (root) => {
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ main: "main.cjs" }));
    await fs.writeFile(path.join(root, "main.cjs"), "module.exports = { loaded: true };\n");

    const result = loadNextApp(root);

    assert.deepEqual(result, { loaded: true });
  });
});

async function usingFixture(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mobile-identify-loader-"));
  try {
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
