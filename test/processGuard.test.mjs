import assert from "node:assert/strict";
import test from "node:test";
import { isDiscordProcessRelevant } from "../src/install/processGuard.mjs";

test("isDiscordProcessRelevant matches process inside selected install root", () => {
  assert.equal(
    isDiscordProcessRelevant(
      {
        Id: 1,
        ProcessName: "Discord",
        Path: "C:\\Users\\utaaa\\AppData\\Local\\Discord\\app-1.0.9239\\Discord.exe"
      },
      "C:\\Users\\utaaa\\AppData\\Local\\Discord\\app-1.0.9239\\resources"
    ),
    true
  );
});

test("isDiscordProcessRelevant ignores another Discord branch with known path", () => {
  assert.equal(
    isDiscordProcessRelevant(
      {
        Id: 1,
        ProcessName: "DiscordCanary",
        Path: "C:\\ProgramData\\utaaa\\DiscordCanary\\app-1.0.972\\DiscordCanary.exe"
      },
      "C:\\Users\\utaaa\\AppData\\Local\\Discord\\app-1.0.9239\\resources"
    ),
    false
  );
});

test("isDiscordProcessRelevant treats Discord helper without path as relevant", () => {
  assert.equal(
    isDiscordProcessRelevant(
      {
        Id: 1,
        ProcessName: "DiscordSystemHelper",
        Path: null
      },
      "C:\\Users\\utaaa\\AppData\\Local\\Discord\\app-1.0.9239\\resources"
    ),
    true
  );
});

test("isDiscordProcessRelevant matches macOS app bundle executable", () => {
  assert.equal(
    isDiscordProcessRelevant(
      {
        Id: 1,
        ProcessName: "Discord",
        Path: "/Applications/Discord.app/Contents/MacOS/Discord"
      },
      "/Applications/Discord.app/Contents/Resources"
    ),
    true
  );
});

test("isDiscordProcessRelevant ignores another macOS branch", () => {
  assert.equal(
    isDiscordProcessRelevant(
      {
        Id: 1,
        ProcessName: "Discord Canary",
        Path: "/Applications/Discord Canary.app/Contents/MacOS/Discord Canary"
      },
      "/Applications/Discord.app/Contents/Resources"
    ),
    false
  );
});
