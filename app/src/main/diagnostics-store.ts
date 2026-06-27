import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import type { DiagnosticsBundleRequest, DiagnosticsBundleResult, StorageStatus } from "../shared/diagnostics";
import { getAppDataRoot, getLogsRoot } from "./config-service";
import { logger } from "./logger";

function safeName(input: string) {
  return input.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "diagnostics";
}

async function copyIfExists(source: string, destination: string) {
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
    return destination;
  } catch {
    return undefined;
  }
}

export async function getStorageStatus(): Promise<StorageStatus> {
  try {
    const stats = await fs.statfs(getAppDataRoot());
    return {
      availableBytes: Number(stats.bavail) * Number(stats.bsize),
      message: "Storage check ready"
    };
  } catch {
    return { message: "Storage check unavailable" };
  }
}

export async function createDiagnosticsBundle(input: DiagnosticsBundleRequest): Promise<DiagnosticsBundleResult> {
  const now = new Date().toISOString();
  const folderName = `${now.slice(0, 10)}-${safeName(input.activeEpisodeId ?? "hardware-test")}-${Date.now()}`;
  const folderPath = path.join(getAppDataRoot(), "diagnostics", folderName);
  await fs.mkdir(folderPath, { recursive: true });

  const files: string[] = [];
  const appInfo = {
    appName: "What About It? Studio",
    appVersion: app.getVersion(),
    reportedAppVersion: input.appVersion,
    createdAt: now,
    os: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch()
    }
  };

  const write = async (name: string, value: unknown) => {
    const filePath = path.join(folderPath, name);
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
    files.push(filePath);
  };

  await write("app-info.json", appInfo);
  await write("device-list.json", input.devices);
  await write("hardware-test-results.json", {
    results: input.results,
    message: input.message
  });

  if (input.recordingSessionFolder) {
    const sessionFolder = path.join(input.recordingSessionFolder, "Session");
    const logsFolder = path.join(input.recordingSessionFolder, "Logs");
    for (const fileName of ["recording-session.json", "recording-state.json", "device-map.json", "sync-metadata.json"]) {
      const copied = await copyIfExists(path.join(sessionFolder, fileName), path.join(folderPath, "session", fileName));
      if (copied) files.push(copied);
    }
    const copiedErrors = await copyIfExists(path.join(logsFolder, "errors.log"), path.join(folderPath, "logs", "errors.log"));
    if (copiedErrors) files.push(copiedErrors);
  }

  try {
    const logs = await fs.readdir(getLogsRoot());
    for (const logFile of logs.slice(-3)) {
      const copied = await copyIfExists(path.join(getLogsRoot(), logFile), path.join(folderPath, "logs", logFile));
      if (copied) files.push(copied);
    }
  } catch {
    // Logs are helpful but not required for a diagnostics bundle.
  }

  await logger.info("DiagnosticsService", "Created local diagnostics bundle.", { folderPath });
  return { folderPath, files };
}
