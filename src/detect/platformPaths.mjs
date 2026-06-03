import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathExists } from "../utils/fileOps.mjs";

const BRANCH_DIRS = Object.freeze({
  stable: "Discord",
  canary: "DiscordCanary",
  ptb: "DiscordPTB"
});

export async function getCandidateResourcesPaths({ platform = process.platform, branch = "stable" } = {}) {
  if (platform === "win32") {
    return getWindowsCandidateResourcesPaths(branch);
  }

  if (platform === "darwin") {
    return getMacCandidateResourcesPaths(branch);
  }

  return getLinuxCandidateResourcesPaths(branch);
}

export async function findDiscordResourcesPath(options = {}) {
  const candidates = await getCandidateResourcesPaths(options);
  for (const candidate of candidates) {
    if (await pathExists(path.join(candidate, "app.asar"))) {
      return candidate;
    }
  }

  return null;
}

async function getWindowsCandidateResourcesPaths(branch) {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return [];

  const baseDir = path.join(localAppData, BRANCH_DIRS[branch] ?? BRANCH_DIRS.stable);
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("app-"))
      .map((entry) => path.join(baseDir, entry.name, "resources"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function getMacCandidateResourcesPaths(branch) {
  const appName = {
    stable: "Discord.app",
    canary: "Discord Canary.app",
    ptb: "Discord PTB.app"
  }[branch] ?? "Discord.app";

  return [path.join("/Applications", appName, "Contents", "Resources")];
}

function getLinuxCandidateResourcesPaths(branch) {
  if (branch !== "stable") return [];

  return [
    "/usr/share/discord/resources",
    "/usr/lib/discord/resources",
    path.join(os.homedir(), ".local", "share", "Discord", "resources")
  ];
}
