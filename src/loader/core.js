const fs = require("fs");
const os = require("os");
const path = require("path");

function patchBrowserWindowPreload(electronModule, preloadPath) {
  const OriginalBrowserWindow = electronModule.BrowserWindow;
  if (typeof OriginalBrowserWindow !== "function") return false;

  electronModule.BrowserWindow = new Proxy(OriginalBrowserWindow, {
    construct(target, args, newTarget) {
      args[0] = withChainedPreload(args[0], preloadPath, electronModule);
      return Reflect.construct(target, args, newTarget);
    },
    apply(target, thisArg, args) {
      args[0] = withChainedPreload(args[0], preloadPath, electronModule);
      return Reflect.apply(target, thisArg, args);
    }
  });

  return true;
}

function withChainedPreload(options, preloadPath, electronModule) {
  const nextOptions = { ...(options ?? {}) };
  const webPreferences = { ...(nextOptions.webPreferences ?? {}) };
  const originalPreload = webPreferences.preload;

  webPreferences.preload = createCombinedPreload(preloadPath, originalPreload, electronModule);
  nextOptions.webPreferences = webPreferences;
  return nextOptions;
}

function createCombinedPreload(preloadPath, originalPreload, electronModule) {
  if (!originalPreload) return preloadPath;

  const userDataDir = getWritablePreloadDir(electronModule);
  fs.mkdirSync(userDataDir, { recursive: true });

  const fileName = `mobile-identify-preload-${Buffer.from(originalPreload).toString("hex").slice(0, 32)}.js`;
  const combinedPath = path.join(userDataDir, fileName);
  const source = [
    `require(${JSON.stringify(preloadPath)});`,
    `require(${JSON.stringify(originalPreload)});`,
    ""
  ].join("\n");

  fs.writeFileSync(combinedPath, source, "utf8");
  return combinedPath;
}

function getWritablePreloadDir(electronModule) {
  try {
    if (electronModule?.app?.getPath) {
      return path.join(electronModule.app.getPath("userData"), "mobile-identify-patcher");
    }
  } catch {
    // Fall back to tmpdir when Electron app paths are unavailable.
  }

  return path.join(os.tmpdir(), "discord-mobile-identify-patcher");
}

function loadNextApp(nextAsarPath) {
  const packageJsonPath = path.join(nextAsarPath, "package.json");
  const packageJson = require(packageJsonPath);
  const mainFile = packageJson.main || "index.js";
  return require(path.join(nextAsarPath, mainFile));
}

function getNextAppPlan(resourcesPath, loaderDir = __dirname, fsModule = fs) {
  const vencordLoaderAsar = path.join(resourcesPath, "app.vc.asar");
  if (fsModule.existsSync(vencordLoaderAsar)) {
    return { nextAsar: vencordLoaderAsar, shouldPatch: true };
  }

  const fallbackDiscordAsar = path.join(resourcesPath, "app.dmi.asar");
  const discordBodyAsar = path.join(resourcesPath, "_app.asar");
  if (
    fsModule.existsSync(fallbackDiscordAsar)
    && (loaderDir.endsWith("_app.asar") || !fsModule.existsSync(discordBodyAsar))
  ) {
    return { nextAsar: fallbackDiscordAsar, shouldPatch: true };
  }

  return { nextAsar: discordBodyAsar, shouldPatch: true };
}

module.exports = {
  createCombinedPreload,
  getNextAppPlan,
  loadNextApp,
  patchBrowserWindowPreload,
  withChainedPreload
};
