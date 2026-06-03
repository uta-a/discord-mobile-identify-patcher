#!/usr/bin/env node
import { findDiscordResourcesPath } from "./detect/platformPaths.mjs";
import { evaluateInstallState } from "./install/guard.mjs";
import { installToResources } from "./install/install.mjs";

async function main(argv) {
  const { command, options } = parseArgs(argv);

  if (!["check", "install"].includes(command)) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const resourcesDir = options.discordPath ?? (await findDiscordResourcesPath({ branch: options.branch }));
  if (!resourcesDir) {
    throw new Error("Discord resources path was not found. Pass --discord-path explicitly.");
  }

  if (command === "check") {
    const state = await evaluateInstallState(resourcesDir);
    console.log(JSON.stringify({ resourcesDir, ...state }, null, 2));
    process.exitCode = state.action === "abort" ? 1 : 0;
    return;
  }

  const result = await installToResources(resourcesDir);
  console.log(JSON.stringify(result, null, 2));
}

function parseArgs(argv) {
  const [command = "check", ...rest] = argv;
  const options = { branch: "stable", discordPath: null };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (arg === "--branch") {
      options.branch = requireValue(rest, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--discord-path") {
      options.discordPath = requireValue(rest, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return { command, options };
}

function requireValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function printUsage() {
  console.log(`Usage:
  node src/cli.mjs check [--branch stable|canary|ptb] [--discord-path <resources>]
  node src/cli.mjs install [--branch stable|canary|ptb] [--discord-path <resources>]`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
