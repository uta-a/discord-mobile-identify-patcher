const path = require("path");
const electron = require("electron");
const { loadNextApp, patchBrowserWindowPreload } = require("./core.js");

const resourcesDir = process.resourcesPath;
const nextAsar = path.join(resourcesDir, "app.mobile-status-backup.asar");
const ownPreload = path.join(__dirname, "preload.js");

setupDiagnostics(electron);
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

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
