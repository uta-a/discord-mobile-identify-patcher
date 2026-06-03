import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function findRunningDiscordProcesses({ platform = process.platform } = {}) {
  if (platform === "win32") {
    return findRunningDiscordProcessesOnWindows();
  }

  if (platform === "darwin") {
    return findRunningDiscordProcessesOnMac();
  }

  return [];
}

async function findRunningDiscordProcessesOnWindows() {
  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name LIKE 'Discord%'\" | Select-Object @{Name='Id';Expression={$_.ProcessId}}, @{Name='ProcessName';Expression={[System.IO.Path]::GetFileNameWithoutExtension($_.Name)}}, @{Name='Path';Expression={$_.ExecutablePath}} | ConvertTo-Json -Compress"
    ]);
    return parsePowerShellProcessJson(stdout);
  } catch {
    return [];
  }
}

async function findRunningDiscordProcessesOnMac() {
  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,comm=,args="]);
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseMacProcessLine)
      .filter((processInfo) => processInfo.ProcessName.startsWith("Discord"));
  } catch {
    return [];
  }
}

export function isDiscordProcessRelevant(processInfo, resourcesDir) {
  if (!processInfo?.ProcessName?.startsWith("Discord")) {
    return false;
  }

  if (!processInfo.Path) {
    return true;
  }

  const normalizedProcessPath = path.normalize(processInfo.Path).toLowerCase();
  const normalizedResourcesDir = path.normalize(resourcesDir).toLowerCase();
  const installRoot = normalizedResourcesDir.endsWith(`${path.sep}resources`)
    ? path.dirname(normalizedResourcesDir)
    : normalizedResourcesDir;

  const appBundleRoot = getMacAppBundleRoot(normalizedResourcesDir);
  return normalizedProcessPath.startsWith(installRoot) || normalizedProcessPath.startsWith(appBundleRoot);
}

export async function assertDiscordNotRunning(resourcesDir) {
  const processes = await findRunningDiscordProcesses();
  const relevant = processes.filter((processInfo) => isDiscordProcessRelevant(processInfo, resourcesDir));

  if (relevant.length > 0) {
    const summary = relevant
      .map((processInfo) => `${processInfo.ProcessName}(${processInfo.Id})`)
      .join(", ");
    throw new Error(`Discord is running for this installation: ${summary}. Close Discord before installing.`);
  }
}

function parsePowerShellProcessJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function parseMacProcessLine(line) {
  const match = line.match(/^(\d+)\s+(\S+)\s*(.*)$/);
  if (!match) {
    return { Id: null, ProcessName: "", Path: null };
  }

  const [, pid, command, args] = match;
  const processPath = command.startsWith("/") ? command : args.split(/\s+/).find((part) => part.startsWith("/")) ?? null;

  return {
    Id: Number(pid),
    ProcessName: path.basename(command),
    Path: processPath
  };
}

function getMacAppBundleRoot(normalizedResourcesDir) {
  const marker = `${path.sep}contents${path.sep}resources`;
  const markerIndex = normalizedResourcesDir.indexOf(marker);
  if (markerIndex === -1) return normalizedResourcesDir;
  return normalizedResourcesDir.slice(0, markerIndex);
}
