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

  log("main-world-hook-started");
  installFastConnectBlock();
  installWebpackIdentifyPatch();

  if (globalObject[marker]) {
    log("websocket-send-hook-skipped", { reason: "already-installed" });
    return false;
  }
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
        log("identify-json-patched", {
          previousBrowser: payload.d.properties.browser || null
        });
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
    if (!proto || typeof proto.send !== "function") {
      log("websocket-send-hook-skipped", { reason: "missing-send" });
      return false;
    }
    if (proto[marker]) {
      log("websocket-send-hook-skipped", { reason: "prototype-already-patched" });
      return false;
    }

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

    log("websocket-send-hook-installed");
    return true;
  }

  function installFastConnectBlock() {
    if (globalObject[fastConnectMarker]) {
      log("fast-connect-block-skipped", { reason: "already-installed" });
      return false;
    }
    globalObject[fastConnectMarker] = true;

    const NativeWebSocket = globalObject.WebSocket;
    if (typeof NativeWebSocket !== "function") {
      log("fast-connect-block-skipped", { reason: "missing-websocket" });
      return false;
    }

    let blocked = false;
    globalObject.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, args, newTarget) {
        if (shouldBlockFastConnect(args[0])) {
          blocked = true;
          log("fast-connect-blocked", { url: String(args[0]) });
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

    log("fast-connect-block-installed");
    return true;
  }

  function installWebpackIdentifyPatch() {
    if (globalObject[webpackMarker]) {
      log("webpack-patch-skipped", { reason: "already-installed" });
      return false;
    }
    globalObject[webpackMarker] = true;

    patchKnownWebpackChunkArrays();
    patchFutureWebpackChunkArrays();
    log("webpack-patch-installed", {
      chunkKeys: Object.keys(globalObject).filter(isWebpackChunkKey)
    });
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

    log("webpack-chunk-array-patched", { existingChunks: chunkArray.length });
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
        log("webpack-factory-patched", { moduleId: String(moduleId) });
      }
    }

    return patched;
  }

  function patchGatewayIdentifyFactory(factory, moduleId) {
    const source = Function.prototype.toString.call(factory);
    if (!source.includes("GatewaySocket") || !source.includes("_doIdentify")) {
      return factory;
    }

    log("gateway-factory-candidate", {
      moduleId: String(moduleId),
      sourceLength: source.length,
      hasPropertiesPresence: /properties:\s*[A-Za-z_$][\w$]*\s*,\s*presence:/.test(source)
    });
    const replacement = '{os:"Android",browser:"Discord Android",device:"Discord Android",browser_user_agent:"Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",browser_version:"125.0.0.0",os_version:"14"}';
    const matchers = [
      /(?<=properties:\s*)([A-Za-z_$][\w$]*)(?=\s*,\s*presence:)/
    ];

    for (const matcher of matchers) {
      if (!matcher.test(source)) continue;

      const patchedSource = `${source.replace(matcher, replacement)}
//# sourceURL=file:///MobileIdentifyPatchedWebpackModule${String(moduleId)}`;
      try {
        log("gateway-factory-source-patched", { moduleId: String(moduleId), matcher: String(matcher) });
        return (0, eval)(`(${patchedSource}\n)`);
      } catch (error) {
        log("gateway-factory-eval-error", { moduleId: String(moduleId), message: error?.message ?? String(error) });
        return factory;
      }
    }

    log("gateway-factory-no-matcher", { moduleId: String(moduleId) });
    return factory;
  }

  return patchWebSocketCtor(globalObject.WebSocket);

  function log(event, details) {
    try {
      const payload = {
        event,
        details: details || {}
      };

      globalObject.console?.info?.("[MobileIdentifyPatcher] " + JSON.stringify(payload));
      globalObject.postMessage?.({
        source: "mobile-identify-patcher",
        event,
        details: details || {}
      }, "*");
    } catch {
      // Ignore diagnostics failures in page context.
    }
  }
}

module.exports = {
  createBrowserHookSource,
  createAndroidProperties,
  installMobileIdentifyHook,
  patchIdentifyPayload,
  patchWebSocketSend
};
