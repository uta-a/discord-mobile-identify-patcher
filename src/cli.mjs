#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import * as readline from "node:readline";
import * as tty from "node:tty";
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
    const payload = { branch: options.branch, version: getInstallVersion(resourcesDir), resourcesDir, ...state };
    await writeCliLog(resourcesDir, command, payload);
    printResult(command, payload, { json: options.json });
    process.exitCode = state.action === "abort" ? 1 : 0;
    return;
  }

  if (command === "install") {
    const result = await installToResources(resourcesDir, {
      forceClose: options.forceClose
    });
    const payload = withInstallMetadata(result, resourcesDir, options.branch);
    await writeCliLog(resourcesDir, command, payload);
    printResult(command, payload, { json: options.json });
    return;
  }

  if (command === "uninstall") {
    const result = await uninstallSelfFromResources(resourcesDir, {
      forceClose: options.forceClose
    });
    const payload = withInstallMetadata(result, resourcesDir, options.branch);
    await writeCliLog(resourcesDir, command, payload);
    printResult(command, payload, { json: options.json });
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
    const installTarget = await promptInstallTarget(rl, terminal, options);

    const forceClose = options.forceClose || await promptBoolean(
      rl,
      terminal,
      "Close matching Discord processes before install?",
      true
    );

    terminal.output.write("\nInstall summary:\n");
    terminal.output.write(`  Branch: ${installTarget.branch}\n`);
    terminal.output.write(`  Version: ${installTarget.version}\n`);
    terminal.output.write(`  Resources: ${installTarget.resourcesDir}\n`);
    terminal.output.write(`  Force close: ${forceClose ? "yes" : "no"}\n\n`);

    const confirmed = await promptBoolean(rl, terminal, "Continue?", false);
    if (!confirmed) {
      terminal.output.write("Install cancelled.\n");
      return;
    }

    const result = await installToResources(installTarget.resourcesDir, {
      forceClose
    });
    const payload = withInstallMetadata(result, installTarget.resourcesDir, installTarget.branch);
    await writeCliLog(installTarget.resourcesDir, "install", payload);
    terminal.output.write(`${formatSuccess("install", payload)}\n`);
  } finally {
    rl.close();
    terminal.close?.();
  }
}

async function promptInstallTarget(rl, terminal, options) {
  const { output } = terminal;

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

  const selectedIndex = await promptSelect(terminal, {
    label: "Select Discord install",
    options: candidates.map((candidate) => ({
      label: `${candidate.branch} ${candidate.version} - ${candidate.resourcesDir}`,
      description: formatStateSummary(candidate.state)
    })),
    fallback: async () => {
      output.write("Detected Discord installs:\n");
      candidates.forEach((candidate, index) => {
        output.write(`  ${index + 1}. ${candidate.branch} ${candidate.version} - ${candidate.resourcesDir}\n`);
        output.write(`     ${formatStateSummary(candidate.state)}\n`);
      });

      return (await promptNumber(rl, "Select install", 1, 1, candidates.length)) - 1;
    }
  });

  return candidates[selectedIndex];
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

async function promptSelect({ input, output }, { label, options, fallback, initialIndex = 0 }) {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return fallback();
  }

  let selectedIndex = initialIndex;
  let renderedLines = 0;
  const previousRawMode = Boolean(input.isRaw);

  return await new Promise((resolve, reject) => {
    const cleanup = () => {
      input.off("keypress", onKeypress);
      input.setRawMode(previousRawMode);
      input.pause();
    };

    const finish = (value) => {
      cleanup();
      output.write("\n");
      resolve(value);
    };

    const fail = (error) => {
      cleanup();
      reject(error);
    };

    const render = () => {
      if (renderedLines > 0) {
        output.write(`\x1b[${renderedLines}A\x1b[J`);
      }

      const lines = [
        `${label} (↑/↓, Enter)`,
        ...options.map((option, index) => {
          const marker = index === selectedIndex ? "›" : " ";
          const description = option.description ? `  ${dim(option.description)}` : "";
          return `${marker} ${option.label}${description}`;
        })
      ];

      output.write(`${lines.join("\n")}\n`);
      renderedLines = lines.length;
    };

    const onKeypress = (_text, key) => {
      if (key?.name === "up" || key?.name === "k") {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        render();
        return;
      }

      if (key?.name === "down" || key?.name === "j") {
        selectedIndex = (selectedIndex + 1) % options.length;
        render();
        return;
      }

      if (key?.name === "return" || key?.name === "enter") {
        finish(selectedIndex);
        return;
      }

      if (key?.name === "c" && key.ctrl) {
        fail(new Error("Interactive install cancelled."));
      }
    };

    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    input.on("keypress", onKeypress);
    render();
  });
}

function dim(value) {
  return `\x1b[2m${value}\x1b[22m`;
}

async function promptBoolean(rl, terminal, label, defaultValue) {
  if (terminal) {
    const selectedIndex = await promptSelect(terminal, {
      label,
      initialIndex: defaultValue ? 0 : 1,
      options: [
        { label: "Yes", description: "" },
        { label: "No", description: "" }
      ],
      fallback: () => promptBooleanLine(rl, label, defaultValue)
    });
    return selectedIndex === 0;
  }

  return promptBooleanLine(rl, label, defaultValue);
}

async function promptBooleanLine(rl, label, defaultValue) {
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
    const inputFd = fs.openSync("/dev/tty", "r");
    const outputFd = fs.openSync("/dev/tty", "w");
    const input = new tty.ReadStream(inputFd);
    const output = new tty.WriteStream(outputFd);
    return {
      input,
      output,
      close() {
        input.destroy();
        output.destroy();
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
    interactive: false,
    json: false
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

    if (arg === "--json") {
      options.json = true;
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
  node src/cli.mjs check [--branch stable|canary|ptb] [--discord-path <resources>] [--json]
  node src/cli.mjs doctor [--branch stable|canary|ptb] [--discord-path <resources>] [--json]
  node src/cli.mjs install [--branch stable|canary|ptb] [--discord-path <resources>] [--force-close] [--interactive] [--json]
  node src/cli.mjs uninstall [--branch stable|canary|ptb] [--discord-path <resources>] [--force-close] [--json]`);
}

async function writeCliLog(resourcesDir, command, payload) {
  const logDir = getCliLogDir(resourcesDir, payload?.branch);
  await fsp.mkdir(logDir, { recursive: true });
  const logFile = path.join(logDir, "install.log");
  const entry = {
    timestamp: new Date().toISOString(),
    command,
    ...payload
  };
  await fsp.appendFile(logFile, `${JSON.stringify(entry)}\n`, "utf8");
}

function getCliLogDir(resourcesDir, branch = "stable") {
  if (process.env.DMI_LOG_DIR) {
    return process.env.DMI_LOG_DIR;
  }

  return path.join(getDiscordUserDataDir(resourcesDir, branch), "mobile-identify-patcher");
}

function getDiscordUserDataDir(resourcesDir, branch = "stable") {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", getDiscordUserDataName(branch));
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, getDiscordUserDataName(branch));
  }

  return path.join(os.homedir(), ".config", getDiscordUserDataName(branch));
}

function getDiscordUserDataName(branch) {
  return {
    stable: "discord",
    canary: "discordcanary",
    ptb: "discordptb"
  }[branch] ?? "discord";
}

function printResult(command, payload, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (command === "check" || command === "doctor") {
    if (payload.action === "abort") {
      console.log(`Failed: ${simplifyReason(payload.reason, payload.state)}`);
      return;
    }

    console.log(`Success: ${formatStateMessage(payload)}`);
    return;
  }

  console.log(formatSuccess(command, payload));
}

function formatSuccess(command, payload) {
  if (command === "install") {
    if (payload.alreadyInstalled) return "Success: DMI is already installed.";
    return "Success: DMI installed.";
  }

  if (command === "uninstall") {
    return "Success: DMI uninstalled.";
  }

  return "Success.";
}

function formatStateMessage(payload) {
  if (payload.state === "official-only") return "DMI can be installed.";
  if (payload.state === "dmi-only") return "DMI is installed.";
  return `state is ${payload.state}.`;
}

function simplifyReason(reason, state) {
  if (!reason) return state ? `state is ${state}.` : "unknown reason.";
  if (/clean official Discord app\.asar/i.test(reason)) {
    return "Discord already has Vencord or another loader.";
  }
  if (/Uninstall Vencord first|installed under Vencord/i.test(reason)) {
    return "Vencord is installed above DMI. Uninstall Vencord first.";
  }
  if (/not found/i.test(reason)) {
    return "Discord app.asar was not found.";
  }
  if (/hash does not match/i.test(reason)) {
    return "Discord files changed after DMI was installed.";
  }
  if (/inconsistent/i.test(reason)) {
    return "DMI backup files are incomplete.";
  }
  return reason.split("\n")[0];
}

async function handleMainError(argv, error) {
  let resourcesDir = null;
  let branch = "stable";
  let command = "unknown";

  try {
    const parsed = parseArgs(argv);
    command = parsed.command;
    branch = parsed.options.branch;
    resourcesDir = parsed.options.discordPath ?? await findDiscordResourcesPath({ branch });
  } catch {
    // Argument parsing can be the failing operation. Keep the screen output simple.
  }

  try {
    await writeCliLog(resourcesDir, command, {
      branch,
      resourcesDir,
      error: {
        message: error?.message ?? String(error),
        stack: error?.stack
      }
    });
  } catch {
    // Logging must not hide the user-facing failure.
  }

  console.error(`Failed: ${simplifyReason(error?.message ?? String(error))}`);
  process.exitCode = 1;
}

await main(process.argv.slice(2)).catch((error) => handleMainError(process.argv.slice(2), error));
