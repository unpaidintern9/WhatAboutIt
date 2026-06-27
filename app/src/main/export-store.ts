import path from "node:path";
import fs from "node:fs/promises";
import { shell } from "electron";
import type { ExportJob, ExportRequest } from "../shared/export";
import { completeExportJob, createExportJob, createExportSummary, failExportJob, cancelExportJob } from "../shared/export";
import { getEpisodesRoot } from "./config-service";
import { logger } from "./logger";

function exportFolder(episodeId: string) {
  return path.join(getEpisodesRoot(), episodeId, "Exports");
}

function programFolder(episodeId: string) {
  return path.join(getEpisodesRoot(), episodeId, "Program");
}

async function writeExportArtifacts(job: ExportJob) {
  await fs.mkdir(job.outputFolder, { recursive: true });
  await fs.writeFile(path.join(job.outputFolder, "export-job.json"), JSON.stringify(job, null, 2), "utf8");
  await fs.writeFile(
    path.join(job.outputFolder, "export-log.txt"),
    [
      "What About It? Studio export log",
      `Job: ${job.id}`,
      `Status: ${job.status}`,
      `Message: ${job.message}`,
      "Your original recording stays safe."
    ].join("\n"),
    "utf8"
  );
  await fs.writeFile(
    path.join(job.outputFolder, "export-summary.json"),
    JSON.stringify(createExportSummary(job), null, 2),
    "utf8"
  );
}

async function hasProgramRecording(episodeId: string) {
  try {
    const entries = await fs.readdir(programFolder(episodeId));
    return entries.some((entry) => /\.(webm|mp4|mov|mkv|wav|mp3)$/i.test(entry));
  } catch {
    return false;
  }
}

function outputFileName(type: ExportRequest["type"]) {
  if (type === "audio-only") return "what-about-it-audio-only.txt";
  if (type === "archive-master") return "what-about-it-archive-master.txt";
  return "what-about-it-full-episode-video.txt";
}

export async function createExport(request: ExportRequest): Promise<ExportJob> {
  const folder = exportFolder(request.episodeId);
  const queued = createExportJob({
    episodeId: request.episodeId,
    type: request.type,
    qualityPreset: request.qualityPreset,
    outputFolder: folder
  });
  const running: ExportJob = {
    ...queued,
    status: "running",
    progress: 45,
    updatedAt: new Date().toISOString(),
    message: "Exporting your episode"
  };
  await writeExportArtifacts(running);

  const canExport = request.practice || (await hasProgramRecording(request.episodeId));
  if (!canExport) {
    const failed = failExportJob(running, "recording-missing");
    await writeExportArtifacts(failed);
    await logger.warning("ExportService", "Recording file missing for export.", { episodeId: request.episodeId });
    return failed;
  }

  const fileName = outputFileName(request.type);
  await fs.writeFile(
    path.join(folder, fileName),
    [
      "What About It? Studio local export placeholder",
      "A real media worker can replace this file once source media is available.",
      "Your original recording stays safe."
    ].join("\n"),
    "utf8"
  );
  const complete = completeExportJob(running, fileName);
  await writeExportArtifacts(complete);
  await logger.info("ExportService", "Created local export foundation artifacts.", { episodeId: request.episodeId });
  return complete;
}

export async function cancelExport(episodeId: string, job: ExportJob): Promise<ExportJob> {
  const canceled = cancelExportJob({ ...job, outputFolder: exportFolder(episodeId) });
  await writeExportArtifacts(canceled);
  await logger.info("ExportService", "Canceled local export job.", { episodeId });
  return canceled;
}

export async function openExportFolder(episodeId: string): Promise<string> {
  const folder = exportFolder(episodeId);
  await fs.mkdir(folder, { recursive: true });
  await shell.openPath(folder);
  return folder;
}
