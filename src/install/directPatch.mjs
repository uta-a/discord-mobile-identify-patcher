import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import asar from "@electron/asar";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOOK_SOURCE_FILE = path.join(ROOT_DIR, "src", "hook", "mobileIdentifyHook.js");
const ETF_SOURCE_FILE = path.join(ROOT_DIR, "src", "hook", "etf.js");
const LOADER_CORE_FILE = path.join(ROOT_DIR, "src", "loader", "core.js");
const LOADER_PRELOAD_FILE = path.join(ROOT_DIR, "src", "loader", "preload.js");

const DMI_DIR = "dmi-patcher";
const DMI_MAIN = "dmi-main.js";

export async function buildPatchedDiscordAsar(sourceAsar, outputAsar) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dmi-direct-patch-"));

  try {
    await asar.extractAll(sourceAsar, tempDir);
    const packageJsonPath = path.join(tempDir, "package.json");
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
    const originalMain = packageJson.main || "index.js";

    if (originalMain === DMI_MAIN || packageJson.dmiPatcher?.mode === "direct-official-patch") {
      throw new Error("source app.asar already appears to be DMI patched");
    }

    const dmiDir = path.join(tempDir, DMI_DIR);
    await fs.mkdir(dmiDir, { recursive: true });
    await fs.copyFile(HOOK_SOURCE_FILE, path.join(dmiDir, "mobileIdentifyHook.js"));
    await fs.copyFile(ETF_SOURCE_FILE, path.join(dmiDir, "etf.js"));
    await fs.copyFile(LOADER_CORE_FILE, path.join(dmiDir, "core.js"));
    await fs.copyFile(LOADER_PRELOAD_FILE, path.join(dmiDir, "preload.js"));
    await fs.writeFile(path.join(tempDir, DMI_MAIN), createDirectMainSource(originalMain), "utf8");

    const patchedPackageJson = {
      ...packageJson,
      main: DMI_MAIN,
      dmiPatcher: {
        mode: "direct-official-patch",
        originalMain
      }
    };

    await fs.writeFile(packageJsonPath, `${JSON.stringify(patchedPackageJson, null, 2)}\n`, "utf8");
    await fs.rm(outputAsar, { force: true });
    await asar.createPackage(tempDir, outputAsar);
    return outputAsar;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function inspectDiscordAsar(appAsarPath) {
  try {
    asar.uncache(appAsarPath);
    const packageJson = JSON.parse(asar.extractFile(appAsarPath, "package.json").toString("utf8"));
    const mainFile = packageJson.main || "index.js";
    const mainSource = asar.extractFile(appAsarPath, mainFile).toString("utf8");
    const searchable = `${JSON.stringify(packageJson)}\n${mainSource}`;

    if (packageJson.dmiPatcher?.mode === "direct-official-patch" || mainFile === DMI_MAIN) {
      return { kind: "dmi-patched", packageJson, mainFile };
    }

    if (hasVencordLoaderSignature(searchable)) {
      return { kind: "vencord-loader", packageJson, mainFile };
    }

    if (hasThirdPartyLoaderSignature(searchable)) {
      return { kind: "third-party-loader", packageJson, mainFile };
    }

    if (mainFile && (/discord/i.test(packageJson.name ?? "") || /app_bootstrap|Discord/i.test(searchable))) {
      return { kind: "official", packageJson, mainFile };
    }

    return { kind: "unknown", packageJson, mainFile };
  } catch (error) {
    return { kind: "unknown", reason: error?.message ?? String(error) };
  }
}

export async function isDmiPatchedAsar(appAsarPath) {
  return (await inspectDiscordAsar(appAsarPath)).kind === "dmi-patched";
}

function hasVencordLoaderSignature(source) {
  return /(?:require|import)\s*\(\s*["'`][^"'`]*(?:Vencord|vencord)[^"'`]*patcher\.js/i.test(source);
}

function hasThirdPartyLoaderSignature(source) {
  return /OpenAsar|_app\.asar|app\.vc\.asar|app\.dmi\.asar/i.test(source)
    || /(?:require|import)\s*\(\s*["'`][^"'`]*(?:BetterDiscord|patcher\.js)[^"'`]*/i.test(source);
}

function createDirectMainSource(originalMain) {
  return `const path = require("path");
const electron = require("electron");
const { createBrowserHookSource } = require("./${DMI_DIR}/mobileIdentifyHook.js");
const { patchBrowserWindowPreload } = require("./${DMI_DIR}/core.js");

const ownPreload = path.join(__dirname, ${JSON.stringify(DMI_DIR)}, "preload.js");
setupDiagnostics(electron);
setupRendererInjection(electron, createBrowserHookSource());
patchBrowserWindowPreload(electron, ownPreload);
require(path.join(__dirname, ${JSON.stringify(originalMain)}));

function setupDiagnostics(electronModule) {
  try {
    const { app, ipcMain } = electronModule;
    if (!ipcMain?.on) return;

    const logDir = path.join(app.getPath("userData"), "mobile-identify-patcher");
    const logFile = path.join(logDir, "diagnostics.log");
    require("fs").mkdirSync(logDir, { recursive: true });
    require("fs").writeFileSync(logFile, "[" + new Date().toISOString() + "] direct patch started\\n", "utf8");

    ipcMain.on("mobile-identify-patcher:diagnostic", (_event, payload) => {
      const line = "[" + new Date().toISOString() + "] " + safeStringify(payload) + "\\n";
      require("fs").appendFileSync(logFile, line, "utf8");
    });
  } catch {
  }
}

function setupRendererInjection(electronModule, hookSource) {
  try {
    const { app, BrowserWindow } = electronModule;

    app.whenReady().then(() => {
      installGatewayRetryBlock(electronModule);

      for (const window of BrowserWindow.getAllWindows()) {
        attachRendererInjection(window, hookSource);
      }

      app.on("browser-window-created", (_event, window) => {
        attachRendererInjection(window, hookSource);
      });
    });
  } catch (error) {
    writeDiagnostic(electronModule, "renderer-injection-setup-error", {
      message: error?.message ?? String(error)
    });
  }
}

function attachRendererInjection(window, hookSource) {
  try {
    const webContents = window.webContents;
    if (!webContents || webContents.isDestroyed()) return;

    webContents.on("console-message", (_event, _level, message) => {
      const prefix = "[MobileIdentifyPatcher] ";
      if (!message.startsWith(prefix)) return;

      writeDiagnostic(null, "renderer-console-diagnostic", {
        url: safeGetWebContentsUrl(webContents),
        message: message.slice(prefix.length)
      });
    });

    let attempts = 0;
    let completed = false;

    const tryInject = () => {
      if (completed || webContents.isDestroyed()) return;
      attempts += 1;

      webContents.executeJavaScript(hookSource, false)
        .then((result) => {
          completed = true;
          writeDiagnostic(null, "main-process-renderer-injection-success", {
            attempts,
            result,
            url: safeGetWebContentsUrl(webContents)
          });
        })
        .catch((error) => {
          writeDiagnostic(null, "main-process-renderer-injection-error", {
            attempts,
            message: error?.message ?? String(error),
            url: safeGetWebContentsUrl(webContents)
          });

          if (attempts < 200) {
            setTimeout(tryInject, 50);
          }
        });
    };

    webContents.on("dom-ready", tryInject);
    webContents.on("did-finish-load", tryInject);
    webContents.on("did-frame-finish-load", tryInject);
    setTimeout(tryInject, 50);
  } catch (error) {
    writeDiagnostic(null, "renderer-injection-attach-error", {
      message: error?.message ?? String(error)
    });
  }
}

function installGatewayRetryBlock(electronModule) {
  try {
    const session = electronModule.session?.defaultSession;
    if (!session?.webRequest?.onBeforeRequest) return;

    let blocked = false;
    session.webRequest.onBeforeRequest({ urls: ["wss://gateway.discord.gg/*"] }, (details, callback) => {
      if (!blocked) {
        blocked = true;
        writeDiagnostic(electronModule, "main-process-gateway-websocket-blocked", {
          url: details.url
        });
        callback({ cancel: true });
        return;
      }

      callback({});
    });
  } catch (error) {
    writeDiagnostic(electronModule, "gateway-retry-block-error", {
      message: error?.message ?? String(error)
    });
  }
}

function safeGetWebContentsUrl(webContents) {
  try {
    return webContents.getURL();
  } catch {
    return "";
  }
}

function writeDiagnostic(electronModule, event, details = {}) {
  try {
    const electronRef = electronModule ?? electron;
    const logDir = path.join(electronRef.app.getPath("userData"), "mobile-identify-patcher");
    const logFile = path.join(logDir, "diagnostics.log");
    require("fs").mkdirSync(logDir, { recursive: true });
    const line = "[" + new Date().toISOString() + "] " + safeStringify({ event, details }) + "\\n";
    require("fs").appendFileSync(logFile, line, "utf8");
  } catch {
  }
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
`;
}
