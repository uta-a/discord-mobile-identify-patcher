const MARKER = Symbol.for("MobileIdentifyPatcher.websocketSend");
const DEFAULT_ANDROID_PROPERTIES = Object.freeze({
  os: "Android",
  browser: "Discord Android",
  device: "Discord Android",
  browser_user_agent:
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
  browser_version: "125.0.0.0",
  os_version: "14"
});

function createAndroidProperties(original) {
  return {
    ...(original ?? {}),
    ...DEFAULT_ANDROID_PROPERTIES
  };
}

function patchWebSocketSend(WebSocketCtor) {
  if (typeof WebSocketCtor !== "function") return false;

  const proto = WebSocketCtor.prototype;
  if (!proto || typeof proto.send !== "function") return false;
  if (proto[MARKER]) return false;

  const originalSend = proto.send;

  Object.defineProperty(proto, MARKER, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  proto.send = function patchedSend(data) {
    if (typeof data === "string" && data.includes('"op":2')) {
      try {
        const payload = JSON.parse(data);

        if (payload?.op === 2 && payload.d?.properties) {
          const nextPayload = {
            ...payload,
            d: {
              ...payload.d,
              properties: createAndroidProperties(payload.d.properties)
            }
          };

          return originalSend.call(this, JSON.stringify(nextPayload));
        }
      } catch {
        // Preserve native behavior for non-JSON strings.
      }
    }

    return originalSend.call(this, data);
  };

  return true;
}

function installMobileIdentifyHook(globalObject = globalThis) {
  if (globalObject[MARKER]) return false;
  globalObject[MARKER] = true;
  return patchWebSocketSend(globalObject.WebSocket);
}

module.exports = {
  createAndroidProperties,
  installMobileIdentifyHook,
  patchWebSocketSend
};
