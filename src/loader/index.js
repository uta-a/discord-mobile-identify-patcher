const path = require("path");
const electron = require("electron");
const { createBrowserHookSource } = require("./mobileIdentifyHook.js");
const { loadNextApp, patchBrowserWindowPreload } = require("./core.js");

const resourcesDir = process.resourcesPath;
const nextAsar = path.join(resourcesDir, "app.mobile-status-backup.asar");
const ownPreload = path.join(__dirname, "preload.js");

setupDiagnostics(electron);
setupRendererInjection(electron, createBrowserHookSource());
patchBrowserWindowPreload(electron, ownPreload);
loadNextApp(nextAsar);

function setupDiagnostics(electronModule) {
  try {
    const { app, ipcMain } = electronModule;
    if (!ipcMain?.on) return;

    const logDir = path.join(app.getPath("userData"), "mobile-identify-patcher");
    const logFile = path.join(logDir, "diagnostics.log");
    require("fs").mkdirSync(logDir, { recursive: true });
    require("fs").writeFileSync(logFile, `[${new Date().toISOString()}] loader started\n`, "utf8");

    ipcMain.on("mobile-identify-patcher:diagnostic", (_event, payload) => {
      const line = `[${new Date().toISOString()}] ${safeStringify(payload)}\n`;
      require("fs").appendFileSync(logFile, line, "utf8");
    });
  } catch {
    // Diagnostics must never prevent Discord from starting.
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
    const line = `[${new Date().toISOString()}] ${safeStringify({ event, details })}\n`;
    require("fs").appendFileSync(logFile, line, "utf8");
  } catch {
    // Diagnostics must never prevent Discord from starting.
  }
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
