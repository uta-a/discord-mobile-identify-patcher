const { createBrowserHookSource, installMobileIdentifyHook } = require("./mobileIdentifyHook.js");

const DIAGNOSTIC_CHANNEL = "mobile-identify-patcher:diagnostic";

function log(event, details = {}) {
  try {
    const { ipcRenderer } = require("electron");
    ipcRenderer.send(DIAGNOSTIC_CHANNEL, { event, details });
  } catch {
    // Diagnostics must not affect Discord startup.
  }
}

try {
  globalThis.addEventListener?.("message", (event) => {
    if (event?.data?.source !== "mobile-identify-patcher") return;
    log(event.data.event, event.data.details ?? {});
  });
} catch {
  // Keep going when message listeners are unavailable.
}

log("preload-started");
log("preload-world-hook", { installed: installMobileIdentifyHook() });

try {
  const { webFrame } = require("electron");
  webFrame.executeJavaScript(createBrowserHookSource(), false)
    .then(() => log("main-world-hook-executed"))
    .catch((error) => log("main-world-hook-error", { message: error?.message ?? String(error) }));
} catch (error) {
  log("main-world-hook-schedule-error", { message: error?.message ?? String(error) });
  // The preload-world patch above is kept as a fallback.
}
