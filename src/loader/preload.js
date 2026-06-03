const { createBrowserHookSource, installMobileIdentifyHook } = require("./mobileIdentifyHook.js");

installMobileIdentifyHook();

try {
  const { webFrame } = require("electron");
  webFrame.executeJavaScript(createBrowserHookSource(), false);
} catch {
  // The preload-world patch above is kept as a fallback.
}
