#!/usr/bin/env node
import fs from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as processStdin, stdout as processStdout } from "node:process";
import path from "node:path";
import { findDiscordResourcesPath, getCandidateResourcesPaths } from "./detect/platformPaths.mjs";
import { evaluateInstallState } from "./install/guard.mjs";
import {
  installToResources,
  uninstallSelfFromResources
} from "./install/install.mjs";
import { pathExists } from "./utils/fileOps.mjs";

async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return;
  }

  const { command, options } = parseArgs(argv);

  if (!["check", "doctor", "install", "uninstall"].includes(command)) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (command === "install" && options.interactive) {
    await runInteractiveInstall(options);
    return;
  }

  const resourcesDir = options.discordPath ?? (await findDiscordResourcesPath({ branch: options.branch }));
  if (!resourcesDir) {
    throw new Error("Discord resources path was not found. Pass --discord-path explicitly.");
  }

  if (command === "check" || command === "doctor") {
    const state = await evaluateInstallState(resourcesDir);
    console.log(JSON.stringify({ branch: options.branch, version: getInstallVersion(resourcesDir), resourcesDir, ...state }, null, 2));
    process.exitCode = state.action === "abort" ? 1 : 0;
    return;
  }

  if (command === "install") {
    const result = await installToResources(resourcesDir, {
      forceClose: options.forceClose
    });
    console.log(JSON.stringify(withInstallMetadata(result, resourcesDir, options.branch), null, 2));
    return;
  }

  if (command === "uninstall") {
    const result = await uninstallSelfFromResources(resourcesDir, {
      forceClose: options.forceClose
    });
    console.log(JSON.stringify(withInstallMetadata(result, resourcesDir, options.branch), null, 2));
    return;
  }
}

async function runInteractiveInstall(options) {
  const terminal = openTerminal();
  const rl = createInterface({
    input: terminal.input,
    output: terminal.output
  });

  try {
    terminal.output.write("Discord Mobile IDENTIFY Patcher\n\n");
    const installTarget = await promptInstallTarget(rl, terminal.output, options);

    const forceClose = options.forceClose || await promptBoolean(
      rl,
      "Close matching Discord processes before install?",
      true
    );

    terminal.output.write("\nInstall summary:\n");
    terminal.output.write(`  Branch: ${installTarget.branch}\n`);
    terminal.output.write(`  Version: ${installTarget.version}\n`);
    terminal.output.write(`  Resources: ${installTarget.resourcesDir}\n`);
    terminal.output.write(`  Force close: ${forceClose ? "yes" : "no"}\n\n`);

    const confirmed = await promptBoolean(rl, "Continue?", false);
    if (!confirmed) {
      terminal.output.write("Install cancelled.\n");
      return;
    }

    const result = await installToResources(installTarget.resourcesDir, {
      forceClose
    });
    terminal.output.write(`${JSON.stringify(withInstallMetadata(result, installTarget.resourcesDir, installTarget.branch), null, 2)}\n`);
  } finally {
    rl.close();
    terminal.close?.();
  }
}

async function promptInstallTarget(rl, output, options) {
  if (options.discordPath) {
    const branch = options.branchProvided ? options.branch : "custom";
    return {
      branch,
      version: getInstallVersion(options.discordPath),
      resourcesDir: options.discordPath,
      state: await describeResources(options.discordPath)
    };
  }

  const candidates = await detectInstallCandidates(options.branchProvided ? [options.branch] : ["stable", "canary", "ptb"]);

  if (candidates.length === 0) {
    output.write("No Discord installs were detected automatically.\n");
    const resourcesDir = await promptRequired(rl, "Enter Discord resources path");
    return {
      branch: "custom",
      version: getInstallVersion(resourcesDir),
      resourcesDir,
      state: await describeResources(resourcesDir)
    };
  }

  output.write("Detected Discord installs:\n");
  candidates.forEach((candidate, index) => {
    output.write(`  ${index + 1}. ${candidate.branch} ${candidate.version} - ${candidate.resourcesDir}\n`);
    output.write(`     ${formatStateSummary(candidate.state)}\n`);
  });

  const selectedIndex = await promptNumber(rl, "Select install", 1, 1, candidates.length);
  return candidates[selectedIndex - 1];
}

async function detectInstallCandidates(branches) {
  const candidates = [];
  for (const branch of branches) {
    const resourcesPaths = await getCandidateResourcesPaths({ branch });
    for (const resourcesDir of resourcesPaths) {
      if (!(await pathExists(path.join(resourcesDir, "app.asar")))) continue;
      candidates.push({
        branch,
        version: getInstallVersion(resourcesDir),
        resourcesDir,
        state: await describeResources(resourcesDir)
      });
    }
  }

  return candidates;
}

function getInstallVersion(resourcesDir) {
  const appDir = path.basename(path.dirname(resourcesDir));
  return appDir.startsWith("app-") ? appDir.slice("app-".length) : appDir;
}

function withInstallMetadata(result, resourcesDir, branch) {
  return {
    branch,
    version: getInstallVersion(resourcesDir),
    resourcesDir,
    ...result
  };
}

async function describeResources(resourcesDir) {
  const state = await evaluateInstallState(resourcesDir);
  return {
    ...state,
    hasVencordStyleBody: await pathExists(path.join(resourcesDir, "_app.asar"))
  };
}

function formatStateSummary(state) {
  const parts = [];
  if (state.alreadyInstalled) parts.push("DMI patcher: installed");
  else parts.push("DMI patcher: not installed");

  if (state.backupExists) parts.push("backup: exists");
  else parts.push("backup: none");

  if (state.hasVencordStyleBody) parts.push("Vencord-style _app.asar: detected");
  return parts.join(", ");
}

async function promptRequired(rl, label) {
  while (true) {
    const answer = (await rl.question(`${label}: `)).trim();
    if (answer) return answer;
  }
}

async function promptNumber(rl, label, defaultValue, min, max) {
  while (true) {
    const answer = (await rl.question(`${label} [${defaultValue}]: `)).trim();
    const value = answer ? Number(answer) : defaultValue;
    if (Number.isInteger(value) && value >= min && value <= max) {
      return value;
    }
  }
}

async function promptBoolean(rl, label, defaultValue) {
  const suffix = defaultValue ? "Y/n" : "y/N";
  while (true) {
    const answer = (await rl.question(`${label} [${suffix}]: `)).trim().toLowerCase();
    if (!answer) return defaultValue;
    if (["y", "yes"].includes(answer)) return true;
    if (["n", "no"].includes(answer)) return false;
  }
}

function openTerminal() {
  if (processStdin.isTTY && processStdout.isTTY) {
    return { input: processStdin, output: processStdout };
  }

  try {
    const input = fs.createReadStream(null, {
      fd: fs.openSync("/dev/tty", "r"),
      autoClose: true
    });
    const output = fs.createWriteStream(null, {
      fd: fs.openSync("/dev/tty", "w"),
      autoClose: true
    });
    return {
      input,
      output,
      close() {
        input.close();
        output.close();
      }
    };
  } catch {
    throw new Error("Interactive install requires a terminal. Run without --interactive for non-interactive install.");
  }
}

function parseArgs(argv) {
  const [command = "check", ...rest] = argv;
  const options = {
    branch: "stable",
    branchProvided: false,
    discordPath: null,
    forceClose: false,
    interactive: false
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (arg === "--branch") {
      options.branch = requireValue(rest, index, arg);
      options.branchProvided = true;
      index += 1;
      continue;
    }

    if (arg === "--discord-path") {
      options.discordPath = requireValue(rest, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--force-close") {
      options.forceClose = true;
      continue;
    }

    if (arg === "--interactive") {
      options.interactive = true;
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
  node src/cli.mjs doctor [--branch stable|canary|ptb] [--discord-path <resources>]
  node src/cli.mjs install [--branch stable|canary|ptb] [--discord-path <resources>] [--force-close] [--interactive]
  node src/cli.mjs uninstall [--branch stable|canary|ptb] [--discord-path <resources>] [--force-close]`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
