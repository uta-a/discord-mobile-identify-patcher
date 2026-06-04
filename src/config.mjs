export const PATCHER_NAME = "discord-mobile-identify-patcher";
export const LOADER_KIND = "mobile-identify-loader";
export const VERSION = "0.1.0";
export const DISPLAY_NAME = "Discord Mobile Identify Patcher";
export const DIRECT_PATCH_MODE = "direct-official-patch";
export const BACKUP_ASAR_NAME = "app.dmi.backup.asar";
export const MARKER_JSON_NAME = "app.dmi.marker.json";
export const APP_ASAR_NAME = "app.asar";
export const DISCORD_BODY_ASAR_NAME = "_app.asar";
export const VENCORD_LOADER_ASAR_NAME = "app.vc.asar";

export const MARKER = Object.freeze({
  name: PATCHER_NAME,
  kind: LOADER_KIND,
  version: VERSION
});
