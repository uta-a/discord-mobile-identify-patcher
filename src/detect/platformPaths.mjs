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
  const branchDir = BRANCH_DIRS[branch] ?? BRANCH_DIRS.stable;
  const baseDirs = getWindowsCandidateBaseDirs(branchDir);
  const resourcesPaths = [];

  for (const baseDir of baseDirs) {
    resourcesPaths.push(...await getWindowsAppResourcesPaths(baseDir));
  }

  return [...new Set(resourcesPaths)].sort(compareAppResourcePaths).reverse();
}

function getWindowsCandidateBaseDirs(branchDir) {
  const baseDirs = [];

  if (process.env.LOCALAPPDATA) {
    baseDirs.push(path.join(process.env.LOCALAPPDATA, branchDir));
  }

  const programData = process.env.ProgramData || process.env.PROGRAMDATA;
  if (programData && process.env.USERNAME) {
    baseDirs.push(path.join(programData, process.env.USERNAME, branchDir));
  }

  return baseDirs;
}

async function getWindowsAppResourcesPaths(baseDir) {
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("app-"))
      .map((entry) => path.join(baseDir, entry.name, "resources"));
  } catch {
    return [];
  }
}

function compareAppResourcePaths(left, right) {
  return compareVersions(getAppVersionFromResourcesPath(left), getAppVersionFromResourcesPath(right));
}

function getAppVersionFromResourcesPath(resourcesPath) {
  const appDir = path.basename(path.dirname(resourcesPath));
  return appDir.startsWith("app-") ? appDir.slice("app-".length) : appDir;
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = Number.isNaN(leftParts[index]) ? 0 : leftParts[index] ?? 0;
    const rightPart = Number.isNaN(rightParts[index]) ? 0 : rightParts[index] ?? 0;
    if (leftPart !== rightPart) return leftPart - rightPart;
  }

  return left.localeCompare(right);
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
