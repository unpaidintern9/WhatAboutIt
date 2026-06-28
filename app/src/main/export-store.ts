import path from "node:path";
import fs from "node:fs/promises";
import { shell } from "electron";
import type { ExportJob, ExportRequest } from "../shared/export";
import { completeExportJob, createExportJob, createExportSummary, failExportJob, cancelExportJob } from "../shared/export";
import { getEpisodesRoot } from "./config-service";
import { detectMediaTools, requireMediaTools, runFfmpeg, validatePlayableMedia } from "./ffmpeg-tools";
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

async function findProgramRecording(episodeId: string) {
  try {
    const folder = programFolder(episodeId);
    const entries = await fs.readdir(folder);
    const recording = entries.find((entry) => /\.(webm|mp4|mov|mkv|wav|mp3|m4a)$/i.test(entry));
    return recording ? path.join(folder, recording) : null;
  } catch {
    return null;
  }
}

function outputFileName(type: ExportRequest["type"]) {
  if (type === "audio-only") return "what-about-it-audio-only.m4a";
  if (type === "archive-master") return "what-about-it-archive-master.mkv";
  return "what-about-it-full-episode-video.mp4";
}

function qualityArgs(type: ExportRequest["type"], preset: ExportRequest["qualityPreset"]) {
  if (type === "audio-only") {
    return ["-vn", "-c:a", "aac", "-b:a", preset === "high" || preset === "archive" ? "192k" : "160k"];
  }

  if (type === "archive-master") {
    return ["-vf", "fps=30", "-r", "30", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-c:a", "aac", "-b:a", "256k"];
  }

  const crf = preset === "high" ? "20" : preset === "archive" ? "18" : "23";
  return ["-vf", "fps=30", "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", crf, "-c:a", "aac", "-b:a", preset === "high" ? "192k" : "160k"];
}

async function createPracticeSource(episodeId: string) {
  const folder = programFolder(episodeId);
  const output = path.join(folder, "practice-export-source.mp4");
  await fs.mkdir(folder, { recursive: true });

  try {
    await fs.access(output);
    return output;
  } catch {
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=1280x720:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:sample_rate=48000",
      "-t",
      "2",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      "-shortest",
      output
    ]);
    return output;
  }
}

async function renderExport(request: ExportRequest, sourceFile: string, outputPath: string) {
  await runFfmpeg(["-y", "-i", sourceFile, ...qualityArgs(request.type, request.qualityPreset), outputPath]);
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

  const mediaTools = await detectMediaTools();
  if (!mediaTools.ready) {
    const failed = failExportJob(running, "media-tools-missing");
    await writeExportArtifacts(failed);
    await logger.warning("ExportService", "Media tools missing for export.", { episodeId: request.episodeId });
    return failed;
  }

  const canExport = request.practice || (await hasProgramRecording(request.episodeId));
  if (!canExport) {
    const failed = failExportJob(running, "recording-missing");
    await writeExportArtifacts(failed);
    await logger.warning("ExportService", "Recording file missing for export.", { episodeId: request.episodeId });
    return failed;
  }

  const fileName = outputFileName(request.type);
  const outputPath = path.join(folder, fileName);
  const tools = await requireMediaTools();
  const sourceFile = request.practice ? await createPracticeSource(request.episodeId) : await findProgramRecording(request.episodeId);
  if (!sourceFile) {
    const failed = failExportJob(running, "recording-missing");
    await writeExportArtifacts(failed);
    await logger.warning("ExportService", "Recording file missing for export.", { episodeId: request.episodeId });
    return failed;
  }

  try {
    await renderExport(request, sourceFile, outputPath);
    const isPlayable = await validatePlayableMedia(outputPath, tools);
    if (!isPlayable) throw new Error("Export output could not be validated.");
  } catch (error) {
    const failed = failExportJob(running, "needs-attention");
    await writeExportArtifacts(failed);
    await logger.error("ExportService", "FFmpeg export failed.", { episodeId: request.episodeId, error: String(error) });
    return failed;
  }

  const complete = completeExportJob(running, fileName);
  await writeExportArtifacts(complete);
  await logger.info("ExportService", "Created playable local export.", {
    episodeId: request.episodeId,
    outputFileName: fileName,
    ffmpegVersion: tools.ffmpegVersion,
    ffprobeVersion: tools.ffprobeVersion
  });
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

export { detectMediaTools };
