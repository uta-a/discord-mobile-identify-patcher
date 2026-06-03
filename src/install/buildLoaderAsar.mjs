import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import asar from "@electron/asar";
import { MARKER } from "../config.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LOADER_SOURCE_DIR = path.join(ROOT_DIR, "src", "loader");
const HOOK_SOURCE_FILE = path.join(ROOT_DIR, "src", "hook", "mobileIdentifyHook.js");
const ETF_SOURCE_FILE = path.join(ROOT_DIR, "src", "hook", "etf.js");

export async function buildLoaderAsar(outputPath) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mobile-identify-loader-"));

  try {
    await fs.cp(LOADER_SOURCE_DIR, tempDir, { recursive: true });
    await fs.copyFile(HOOK_SOURCE_FILE, path.join(tempDir, "mobileIdentifyHook.js"));
    await fs.copyFile(ETF_SOURCE_FILE, path.join(tempDir, "etf.js"));
    await fs.writeFile(path.join(tempDir, "marker.json"), `${JSON.stringify(MARKER, null, 2)}\n`);
    await fs.rm(outputPath, { force: true });
    await asar.createPackage(tempDir, outputPath);
    return outputPath;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
