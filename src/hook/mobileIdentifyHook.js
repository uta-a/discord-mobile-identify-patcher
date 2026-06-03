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
    const patchedData = patchIdentifyPayload(data);
    return originalSend.call(this, patchedData);
  };

  return true;
}

function patchIdentifyPayload(data) {
  if (typeof data !== "string") {
    return data;
  }

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

      return JSON.stringify(nextPayload);
    }
  } catch {
    // Preserve native behavior for non-JSON strings.
  }

  return data;
}

function installMobileIdentifyHook(globalObject = globalThis) {
  if (globalObject[MARKER]) return false;
  globalObject[MARKER] = true;
  return patchWebSocketSend(globalObject.WebSocket);
}

function createBrowserHookSource() {
  return `;(${browserInstallMobileIdentifyHook.toString()})(globalThis);`;
}

function browserInstallMobileIdentifyHook(globalObject) {
  const marker = Symbol.for("MobileIdentifyPatcher.websocketSend");
  const androidProperties = {
    os: "Android",
    browser: "Discord Android",
    device: "Discord Android",
    browser_user_agent:
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
    browser_version: "125.0.0.0",
    os_version: "14"
  };

  if (globalObject[marker]) return false;
  globalObject[marker] = true;

  function createAndroidProperties(original) {
    return {
      ...(original || {}),
      ...androidProperties
    };
  }

  function patchIdentifyPayload(data) {
    if (typeof data !== "string") return data;

    try {
      const payload = JSON.parse(data);

      if (payload && payload.op === 2 && payload.d && payload.d.properties) {
        return JSON.stringify({
          ...payload,
          d: {
            ...payload.d,
            properties: createAndroidProperties(payload.d.properties)
          }
        });
      }
    } catch {
      // Preserve native behavior for non-JSON strings.
    }

    return data;
  }

  function patchWebSocketCtor(WebSocketCtor) {
    if (typeof WebSocketCtor !== "function") return false;

    const proto = WebSocketCtor.prototype;
    if (!proto || typeof proto.send !== "function") return false;
    if (proto[marker]) return false;

    const originalSend = proto.send;
    Object.defineProperty(proto, marker, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });

    proto.send = function patchedSend(data) {
      return originalSend.call(this, patchIdentifyPayload(data));
    };

    return true;
  }

  return patchWebSocketCtor(globalObject.WebSocket);
}

module.exports = {
  createBrowserHookSource,
  createAndroidProperties,
  installMobileIdentifyHook,
  patchIdentifyPayload,
  patchWebSocketSend
};
