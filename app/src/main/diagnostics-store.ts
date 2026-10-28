import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app, shell } from "electron";
import type { DiagnosticsBundleRequest, DiagnosticsBundleResult, LiveLogInfo, StorageStatus } from "../shared/diagnostics";
import { getAppPathSummary, getDiagnosticsRoot, getEpisodesRoot, getLogsRoot } from "./config-service";
import { getCurrentLogFilePath, logger, flushLogs, getLogSnapshot } from "./logger";
import { redactDiagnosticText, redactDiagnosticJson, sanitizeDiagnosticValue } from "../shared/diagnostic-data";
import { writeSupportZip } from "./support-zip";
import { mediaWorkStatus } from "./media-work-scheduler";

function safeName(input: string) { return input.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "diagnostics"; }
export async function getStorageStatus(): Promise<StorageStatus> {
  try { const root = getEpisodesRoot(); await fs.mkdir(root, { recursive: true }); const stats = await fs.statfs(root);
    return { availableBytes: Number(stats.bavail) * Number(stats.bsize), message: "Storage check ready" };
  } catch { return { message: "Storage check unavailable" }; }
}
export async function getLiveLogInfo(): Promise<LiveLogInfo> {
  await flushLogs();
  const snapshot = getLogSnapshot();
  const filePath = snapshot.activeFile ?? getCurrentLogFilePath();
  const folderPath = path.dirname(filePath);
  await fs.mkdir(folderPath, { recursive: true });
  return { folderPath, filePath, runId: snapshot.runId,
    fallback: filePath.startsWith(snapshot.fallbackRoot), droppedEntries: snapshot.droppedEntries,
    loggingWarning: snapshot.fallbackFailures ? "Disk logging failed; recent events remain in memory for support export."
      : snapshot.primaryFailures ? "The primary log folder has had write failures. Fallback logs are included in support exports." : undefined };
}
export async function openLiveLogs(): Promise<LiveLogInfo> {
  const info = await getLiveLogInfo(), error = await shell.openPath(info.folderPath); if (error) throw new Error(error); return info;
}

export async function createDiagnosticsBundle(input: DiagnosticsBundleRequest): Promise<DiagnosticsBundleResult> {
  if (mediaWorkStatus().capturing > 0) throw new Error("Pause and save before exporting support diagnostics. Logging continues automatically while recording.");
  await flushLogs();
  const now = new Date().toISOString(), name = `${now.slice(0, 10)}-${safeName(input.activeEpisodeId ?? "studio")}-${Date.now()}`;
  let folderPath = path.join(getDiagnosticsRoot(), name);
  try { await fs.mkdir(folderPath, { recursive: true }); }
  catch { folderPath = path.join(os.tmpdir(), "WhatAboutItStudio", "diagnostics", name); await fs.mkdir(folderPath, { recursive: true }); }
  const files: string[] = [], warnings: string[] = [], omitted: string[] = [];
  let totalBytes = 0;
  const writeText = async (relative: string, text: string) => {
    const safe = redactDiagnosticText(text), bytes = Buffer.byteLength(safe);
    if (bytes > 2 * 1024 * 1024 || totalBytes + bytes > 24 * 1024 * 1024) { warnings.push(`${relative}: omitted because the support size limit was reached.`); return; }
    const file = path.join(folderPath, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, safe, { encoding: "utf8", mode: 0o600 }); files.push(file); totalBytes += bytes;
  };
  const writeJson = (name: string, value: unknown) => writeText(name, JSON.stringify(value, null, 2));
  const copyText = async (source: string, relative: string, json = false) => {
    try {
      const stat = await fs.lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink()) { warnings.push(`${relative}: skipped a non-regular file.`); return; }
      if (stat.size > 2 * 1024 * 1024) { warnings.push(`${relative}: file exceeds the per-file support limit.`); return; }
      const text = await fs.readFile(source, "utf8");
      await writeText(relative, json ? redactDiagnosticJson(text) : text.split("\n").map((line) => {
        try { return redactDiagnosticJson(line, false); } catch { return redactDiagnosticText(line); }
      }).join("\n"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") omitted.push(`${relative}: not present`);
      else warnings.push(`${relative}: ${(error as Error).message}`);
    }
  };
  const snapshot = getLogSnapshot(), { memoryLines, ...logStatus } = snapshot;
  await writeJson("app-info.json", { appName: "What About It Studio", appVersion: app.getVersion(), createdAt: now,
    os: { platform: os.platform(), release: os.release(), arch: os.arch() }, paths: getAppPathSummary(), logStatus });
  await writeJson("device-list.json", sanitizeDiagnosticValue(input.devices));
  await writeJson("hardware-test-results.json", sanitizeDiagnosticValue({ results: input.results, message: input.message }));
  await writeText("logs/memory-recent.ndjson", memoryLines.join(""));

  let episodeFolder: string | undefined;
  if (input.activeEpisodeId) {
    if (path.basename(input.activeEpisodeId) !== input.activeEpisodeId || [".", ".."].includes(input.activeEpisodeId)) throw new Error("Invalid episode for diagnostics.");
    episodeFolder = path.join(getEpisodesRoot(), input.activeEpisodeId);
  } else if (input.recordingSessionFolder) {
    const root = path.resolve(getEpisodesRoot()), candidate = path.resolve(input.recordingSessionFolder);
    if (candidate.startsWith(`${root}${path.sep}`)) episodeFolder = candidate;
    else warnings.push("Requested recording folder is outside the local library and was not included.");
  }
  const sessionFiles = ["recording-session.json", "recording-state.json", "device-map.json", "sync-metadata.json", "recording-parts.json", "capture-manifest.json"];
  if (episodeFolder) {
    const root = await fs.realpath(getEpisodesRoot());
    const real = await fs.realpath(episodeFolder).catch(() => undefined);
    if (!real || !real.startsWith(`${root}${path.sep}`)) warnings.push("Episode folder was unavailable or outside the local library.");
    else {
      await copyText(path.join(real, "metadata.json"), "episode/metadata.json", true);
      for (const file of sessionFiles) await copyText(path.join(real, "Session", file), `session/${file}`, true);
      await copyText(path.join(real, "Logs/errors.log"), "logs/errors.log");
      const parts = await fs.readdir(path.join(real, "Recordings"), { withFileTypes: true }).catch(() => []);
      const directories = parts.filter((part) => part.isDirectory() && !part.isSymbolicLink()).sort((a, b) => a.name.localeCompare(b.name));
      if (directories.length > 128) warnings.push("Only the latest 128 recording parts were included.");
      for (const part of directories.slice(-128)) {
        for (const file of sessionFiles) await copyText(path.join(real, "Recordings", part.name, "Session", file), `parts/${part.name}/session/${file}`, true);
        await copyText(path.join(real, "Recordings", part.name, "Logs/errors.log"), `parts/${part.name}/errors.log`);
      }
    }
  }
  for (const [index, root] of [...new Set([getLogsRoot(), snapshot.fallbackRoot])].entries()) {
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      const logs = await Promise.all(entries.filter((entry) => entry.isFile() && !entry.isSymbolicLink() && /\.log$/.test(entry.name))
        .map(async (entry) => ({ name: entry.name, modified: (await fs.stat(path.join(root, entry.name))).mtimeMs })));
      logs.sort((a, b) => b.modified - a.modified);
      for (const file of logs.slice(0, 6)) await copyText(path.join(root, file.name), `logs/${index === 0 ? "primary" : "fallback"}/${file.name}`);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") warnings.push(`Log folder could not be read: ${String(error)}`); }
  }
  await writeText("README.txt", "What About It Studio support diagnostics\nAll times are UTC. Match runId + sequence to order events and deduplicate primary/fallback copies. Episode, session and recording-part IDs link recording events.\nAudioSignal windows report selected-input meter RMS/peak in dBFS, clipping and silence observations; minimum RMS is only a noise-floor candidate, not a diagnosis. Physical interface gain, cabling and Direct Mono/Stereo position cannot be read by this app.\nThis bundle contains local text diagnostics, device identifiers and filesystem paths. It excludes microphone recordings, video, settings and cloud credential files. Review before sharing.\nIf bundle-manifest.json lists warnings, the bundle is incomplete in those respects.\n");
  await writeJson("bundle-manifest.json", { schemaVersion: 1, createdAt: now, episodeId: input.activeEpisodeId,
    runId: snapshot.runId, files: files.map((file) => path.relative(folderPath, file).replaceAll("\\", "/")), warnings, omitted, includedMedia: false });
  const archivePath = `${folderPath}.zip`;
  await writeSupportZip(folderPath, files, archivePath);
  void logger.info("DiagnosticsService", "Created support diagnostics archive.", { archivePath, warningCount: warnings.length });
  return { folderPath, files, archivePath, warnings };
}
