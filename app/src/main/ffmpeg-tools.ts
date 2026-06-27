import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import type { MediaToolsStatus } from "../shared/export";

const execFileAsync = promisify(execFile);

export interface MediaTools {
  ffmpegPath: string;
  ffprobePath: string;
  ffmpegVersion: string;
  ffprobeVersion: string;
}

export interface FfmpegRunResult {
  stdout: string;
  stderr: string;
}

function firstLine(input: string) {
  return input.split(/\r?\n/).find(Boolean)?.trim() ?? "Version unavailable";
}

async function canExecute(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function configuredToolPath(envName: string, bundledPath: string) {
  const override = process.env[envName]?.trim();
  return override || bundledPath;
}

export async function detectMediaTools(): Promise<MediaToolsStatus> {
  const ffmpegPath = configuredToolPath("WHAT_ABOUT_IT_FFMPEG_PATH", ffmpegInstaller.path);
  const ffprobePath = configuredToolPath("WHAT_ABOUT_IT_FFPROBE_PATH", ffprobeInstaller.path);

  if (process.env.WHAT_ABOUT_IT_DISABLE_BUNDLED_MEDIA_TOOLS === "1") {
    return {
      ready: false,
      message: "Media tools need setup before export"
    };
  }

  const [ffmpegExists, ffprobeExists] = await Promise.all([canExecute(ffmpegPath), canExecute(ffprobePath)]);
  if (!ffmpegExists || !ffprobeExists) {
    return {
      ready: false,
      message: "Media tools need setup before export"
    };
  }

  try {
    const [ffmpegVersion, ffprobeVersion] = await Promise.all([
      execFileAsync(ffmpegPath, ["-version"]),
      execFileAsync(ffprobePath, ["-version"])
    ]);

    return {
      ready: true,
      message: "Media tools are ready",
      ffmpegPath,
      ffprobePath,
      ffmpegVersion: firstLine(ffmpegVersion.stdout),
      ffprobeVersion: firstLine(ffprobeVersion.stdout)
    };
  } catch {
    return {
      ready: false,
      message: "Media tools need setup before export"
    };
  }
}

export async function requireMediaTools(): Promise<MediaTools> {
  const status = await detectMediaTools();
  if (!status.ready || !status.ffmpegPath || !status.ffprobePath) {
    throw new Error(status.message);
  }

  return {
    ffmpegPath: status.ffmpegPath,
    ffprobePath: status.ffprobePath,
    ffmpegVersion: status.ffmpegVersion ?? "Version unavailable",
    ffprobeVersion: status.ffprobeVersion ?? "Version unavailable"
  };
}

export async function runFfmpeg(args: string[], tools?: MediaTools): Promise<FfmpegRunResult> {
  const resolvedTools = tools ?? (await requireMediaTools());
  const result = await execFileAsync(resolvedTools.ffmpegPath, args, { maxBuffer: 1024 * 1024 * 8 });
  return { stdout: result.stdout, stderr: result.stderr };
}

export async function runFfprobe(args: string[], tools?: MediaTools): Promise<FfmpegRunResult> {
  const resolvedTools = tools ?? (await requireMediaTools());
  const result = await execFileAsync(resolvedTools.ffprobePath, args, { maxBuffer: 1024 * 1024 * 8 });
  return { stdout: result.stdout, stderr: result.stderr };
}

export async function validatePlayableMedia(filePath: string, tools?: MediaTools) {
  const result = await runFfprobe(
    ["-v", "error", "-show_entries", "format=duration,size", "-show_streams", "-of", "json", filePath],
    tools
  );
  const parsed = JSON.parse(result.stdout) as { streams?: unknown[]; format?: { duration?: string; size?: string } };
  const duration = Number(parsed.format?.duration ?? 0);
  const size = Number(parsed.format?.size ?? 0);
  const hasStreams = Boolean(parsed.streams?.length);
  return (Number.isFinite(duration) && duration > 0) || (hasStreams && Number.isFinite(size) && size > 0);
}
