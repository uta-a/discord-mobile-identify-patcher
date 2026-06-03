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
  const webpackMarker = Symbol.for("MobileIdentifyPatcher.webpackPatch");
  const fastConnectMarker = Symbol.for("MobileIdentifyPatcher.fastConnectBlock");
  const androidProperties = {
    os: "Android",
    browser: "Discord Android",
    device: "Discord Android",
    browser_user_agent:
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
    browser_version: "125.0.0.0",
    os_version: "14"
  };

  installFastConnectBlock();
  installWebpackIdentifyPatch();

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

  function installFastConnectBlock() {
    if (globalObject[fastConnectMarker]) return false;
    globalObject[fastConnectMarker] = true;

    const NativeWebSocket = globalObject.WebSocket;
    if (typeof NativeWebSocket !== "function") return false;

    let blocked = false;
    globalObject.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, args, newTarget) {
        if (shouldBlockFastConnect(args[0])) {
          blocked = true;
          args[0] = "ws://127.0.0.1:9";
        }

        return Reflect.construct(target, args, newTarget);
      }
    });

    function shouldBlockFastConnect(url) {
      return !blocked
        && typeof url === "string"
        && url.includes("gateway.discord.gg")
        && url.includes("encoding=etf")
        && url.includes("compress=zstd-stream");
    }

    return true;
  }

  function installWebpackIdentifyPatch() {
    if (globalObject[webpackMarker]) return false;
    globalObject[webpackMarker] = true;

    patchKnownWebpackChunkArrays();
    patchFutureWebpackChunkArrays();
    return true;
  }

  function patchKnownWebpackChunkArrays() {
    for (const key of Object.keys(globalObject)) {
      if (isWebpackChunkKey(key)) {
        patchWebpackChunkArray(globalObject[key]);
      }
    }
  }

  function patchFutureWebpackChunkArrays() {
    const knownKeys = new Set(Object.keys(globalObject).filter(isWebpackChunkKey));
    const interval = globalObject.setInterval?.(() => {
      for (const key of Object.keys(globalObject)) {
        if (knownKeys.has(key) || !isWebpackChunkKey(key)) continue;
        knownKeys.add(key);
        patchWebpackChunkArray(globalObject[key]);
      }
    }, 10);

    if (interval && globalObject.setTimeout) {
      globalObject.setTimeout(() => globalObject.clearInterval?.(interval), 30000);
    }
  }

  function isWebpackChunkKey(key) {
    return key.startsWith("webpackChunk") || key === "discord_app";
  }

  function patchWebpackChunkArray(chunkArray) {
    if (!Array.isArray(chunkArray)) return false;
    if (chunkArray[webpackMarker]) return false;

    Object.defineProperty(chunkArray, webpackMarker, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });

    for (const chunk of chunkArray) {
      patchWebpackChunk(chunk);
    }

    const originalPush = chunkArray.push;
    chunkArray.push = function patchedWebpackChunkPush(...chunks) {
      for (const chunk of chunks) {
        patchWebpackChunk(chunk);
      }

      return originalPush.apply(this, chunks);
    };

    return true;
  }

  function patchWebpackChunk(chunk) {
    const modules = chunk?.[1];
    if (!modules || typeof modules !== "object") return false;

    let patched = false;
    for (const [moduleId, factory] of Object.entries(modules)) {
      if (typeof factory !== "function") continue;

      const patchedFactory = patchGatewayIdentifyFactory(factory, moduleId);
      if (patchedFactory !== factory) {
        modules[moduleId] = patchedFactory;
        patched = true;
      }
    }

    return patched;
  }

  function patchGatewayIdentifyFactory(factory, moduleId) {
    const source = Function.prototype.toString.call(factory);
    if (!source.includes("GatewaySocket") || !source.includes("_doIdentify")) {
      return factory;
    }

    const replacement = '{os:"Android",browser:"Discord Android",device:"Discord Android",browser_user_agent:"Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",browser_version:"125.0.0.0",os_version:"14"}';
    const matchers = [
      /(?<=properties:\s*)([A-Za-z_$][\w$]*)(?=\s*,\s*presence:)/
    ];

    for (const matcher of matchers) {
      if (!matcher.test(source)) continue;

      const patchedSource = `${source.replace(matcher, replacement)}
//# sourceURL=file:///MobileIdentifyPatchedWebpackModule${String(moduleId)}`;
      try {
        return (0, eval)(`(${patchedSource}\n)`);
      } catch {
        return factory;
      }
    }

    return factory;
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
