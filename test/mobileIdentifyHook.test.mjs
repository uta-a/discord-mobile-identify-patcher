import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { decodeEtf, encodeEtf } = require("../src/hook/etf.js");
const { createAndroidProperties, createBrowserHookSource, patchEtfIdentifyPayload, patchIdentifyPayload, patchWebSocketSend } = require("../src/hook/mobileIdentifyHook.js");

test("createAndroidProperties overwrites mobile fields and preserves unknown fields", () => {
  const result = createAndroidProperties({
    os: "Windows",
    browser: "Discord Client",
    release_channel: "stable"
  });

  assert.equal(result.os, "Android");
  assert.equal(result.browser, "Discord Android");
  assert.equal(result.device, "Discord Android");
  assert.equal(result.release_channel, "stable");
});

test("patchWebSocketSend rewrites op 2 IDENTIFY payload properties", () => {
  const sent = [];
  class FakeWebSocket {
    send(data) {
      sent.push(data);
    }
  }

  assert.equal(patchWebSocketSend(FakeWebSocket), true);

  const socket = new FakeWebSocket();
  socket.send(JSON.stringify({
    op: 2,
    d: {
      token: "redacted",
      properties: {
        os: "Windows",
        browser: "Discord Client",
        custom: "kept"
      }
    }
  }));

  const payload = JSON.parse(sent[0]);
  assert.equal(payload.d.properties.browser, "Discord Android");
  assert.equal(payload.d.properties.custom, "kept");
});

test("patchIdentifyPayload rewrites formatted op 2 IDENTIFY payload", () => {
  const patched = patchIdentifyPayload(JSON.stringify({
    op: 2,
    d: {
      properties: {
        browser: "Discord Client"
      }
    }
  }, null, 2));

  assert.equal(JSON.parse(patched).d.properties.browser, "Discord Android");
});

test("patchEtfIdentifyPayload rewrites op 2 IDENTIFY ETF payload", () => {
  const original = {
    op: 2,
    d: {
      properties: {
        os: "Windows",
        browser: "Discord Client",
        custom: "kept"
      },
      presence: {}
    }
  };
  const encoded = encodeEtf(original);

  const result = patchEtfIdentifyPayload(encoded);

  assert.equal(result.patched, true);
  const decoded = decodeEtf(result.patchedData);
  assert.equal(decoded.d.properties.os, "Android");
  assert.equal(decoded.d.properties.browser, "Discord Android");
  assert.equal(decoded.d.properties.custom, "kept");
});

test("patchIdentifyPayload rewrites typed array ETF payload", () => {
  const encoded = encodeEtf({
    op: 2,
    d: {
      properties: {
        browser: "Discord Client"
      }
    }
  });

  const decoded = decodeEtf(patchIdentifyPayload(encoded));

  assert.equal(decoded.d.properties.browser, "Discord Android");
});

test("patchWebSocketSend leaves non-IDENTIFY and non-JSON data unchanged", () => {
  const sent = [];
  class FakeWebSocket {
    send(data) {
      sent.push(data);
    }
  }

  patchWebSocketSend(FakeWebSocket);

  const socket = new FakeWebSocket();
  const heartbeat = JSON.stringify({ op: 1, d: 10 });
  const binary = new ArrayBuffer(2);

  socket.send(heartbeat);
  socket.send("not json {\"op\":2");
  socket.send(binary);

  assert.equal(sent[0], heartbeat);
  assert.equal(sent[1], "not json {\"op\":2");
  assert.equal(sent[2], binary);
});

test("createBrowserHookSource creates executable main-world hook source", () => {
  const sent = [];
  class FakeWebSocket {
    send(data) {
      sent.push(data);
    }
  }
  const fakeGlobal = { WebSocket: FakeWebSocket };
  Function("globalThis", createBrowserHookSource())(fakeGlobal);

  const socket = new FakeWebSocket();
  socket.send(JSON.stringify({
    op: 2,
    d: {
      properties: {
        browser: "Discord Client"
      }
    }
  }));

  assert.equal(JSON.parse(sent[0]).d.properties.browser, "Discord Android");
});

test("createBrowserHookSource patches GatewaySocket webpack factory", () => {
  const fakeGlobal = { webpackChunkdiscord_app: [] };
  Function("globalThis", createBrowserHookSource())(fakeGlobal);

  const modules = {
    123: function(module) {
      const p = { browser: "Discord Client" };
      module.exports = {
        name: "GatewaySocket",
        _doIdentify() {
          return { properties: p, presence: {} };
        }
      };
    }
  };

  fakeGlobal.webpackChunkdiscord_app.push([[123], modules]);

  const module = { exports: null };
  modules[123](module);

  assert.equal(module.exports._doIdentify().properties.browser, "Discord Android");
});
