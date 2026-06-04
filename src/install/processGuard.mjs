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

  const normalizedProcessPath = normalizeComparablePath(processInfo.Path);
  const normalizedResourcesDir = normalizeComparablePath(resourcesDir);
  const installRoot = normalizedResourcesDir.endsWith("/resources")
    ? normalizedResourcesDir.slice(0, -"/resources".length)
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

export async function closeDiscordForInstall(resourcesDir, { waitMs = 5000 } = {}) {
  const processes = await findRunningDiscordProcesses();
  const relevant = processes.filter((processInfo) => isDiscordProcessRelevant(processInfo, resourcesDir));

  if (relevant.length === 0) {
    return { closed: false, processes: [] };
  }

  await terminateProcesses(relevant);
  await waitForProcessesToExit(relevant, waitMs);

  return {
    closed: true,
    processes: relevant.map((processInfo) => ({
      id: processInfo.Id,
      name: processInfo.ProcessName
    }))
  };
}

async function terminateProcesses(processes, { platform = process.platform } = {}) {
  const ids = processes
    .map((processInfo) => Number(processInfo.Id))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (ids.length === 0) return;

  if (platform === "win32") {
    try {
      await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-Command",
        `Stop-Process -Id ${ids.join(",")} -Force -ErrorAction SilentlyContinue`
      ]);
    } catch {
      // Processes can exit between detection and termination. The follow-up wait
      // checks the actual remaining process list, so a Stop-Process race is safe.
    }
    return;
  }

  if (platform === "darwin") {
    try {
      await execFileAsync("kill", ids.map(String));
    } catch {
      await execFileAsync("kill", ["-9", ...ids.map(String)]);
    }
  }
}

async function waitForProcessesToExit(originalProcesses, waitMs) {
  const deadline = Date.now() + waitMs;
  const originalIds = new Set(originalProcesses.map((processInfo) => Number(processInfo.Id)));

  while (Date.now() < deadline) {
    const running = await findRunningDiscordProcesses();
    const stillRunning = running.some((processInfo) => originalIds.has(Number(processInfo.Id)));

    if (!stillRunning) {
      return;
    }

    await sleep(250);
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

function normalizeComparablePath(filePath) {
  return path.normalize(filePath).replace(/\\/g, "/").toLowerCase();
}

function getMacAppBundleRoot(normalizedResourcesDir) {
  const marker = "/contents/resources";
  const markerIndex = normalizedResourcesDir.indexOf(marker);
  if (markerIndex === -1) return normalizedResourcesDir;
  return normalizedResourcesDir.slice(0, markerIndex);
}
