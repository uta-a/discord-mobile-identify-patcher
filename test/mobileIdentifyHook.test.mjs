import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createAndroidProperties, patchWebSocketSend } = require("../src/hook/mobileIdentifyHook.js");

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
