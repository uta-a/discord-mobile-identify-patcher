const path = require("path");
const electron = require("electron");
const { loadNextApp, patchBrowserWindowPreload } = require("./core.js");

const resourcesDir = process.resourcesPath;
const nextAsar = path.join(resourcesDir, "app.mobile-status-backup.asar");
const ownPreload = path.join(__dirname, "preload.js");

patchBrowserWindowPreload(electron, ownPreload);
loadNextApp(nextAsar);
