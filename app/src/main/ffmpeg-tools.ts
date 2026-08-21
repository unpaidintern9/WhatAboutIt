import { execFile, spawn } from "node:child_process";
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

export type HardwareVideoEncoder = "h264_nvenc" | "h264_qsv" | "h264_amf";

let hardwareEncoderPromise:
  Promise<HardwareVideoEncoder | undefined> | undefined;

export interface FfmpegRunResult {
  stdout: string;
  stderr: string;
}

export interface FfmpegProgressOptions {
  durationMs: number;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export interface FfmpegStreamingOptions {
  signal?: AbortSignal;
  onStderr?: (text: string) => void;
}

export interface MediaValidationRequirements {
  video?: boolean;
  audio?: boolean;
  decode?: boolean;
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

export function resolveBundledToolPath(bundledPath: string) {
  return bundledPath.replace(
    /([\\/])app\.asar([\\/])/,
    "$1app.asar.unpacked$2",
  );
}

function configuredToolPath(envName: string, bundledPath: string) {
  const override = process.env[envName]?.trim();
  if (override) return override;
  return resolveBundledToolPath(bundledPath);
}

export async function detectMediaTools(): Promise<MediaToolsStatus> {
  const ffmpegPath = configuredToolPath(
    "WHAT_ABOUT_IT_FFMPEG_PATH",
    ffmpegInstaller.path,
  );
  const ffprobePath = configuredToolPath(
    "WHAT_ABOUT_IT_FFPROBE_PATH",
    ffprobeInstaller.path,
  );

  if (process.env.WHAT_ABOUT_IT_DISABLE_BUNDLED_MEDIA_TOOLS === "1") {
    return {
      ready: false,
      message: "Media tools need setup before export",
    };
  }

  const [ffmpegExists, ffprobeExists] = await Promise.all([
    canExecute(ffmpegPath),
    canExecute(ffprobePath),
  ]);
  if (!ffmpegExists || !ffprobeExists) {
    return {
      ready: false,
      message: "Media tools need setup before export",
    };
  }

  try {
    const [ffmpegVersion, ffprobeVersion] = await Promise.all([
      execFileAsync(ffmpegPath, ["-version"]),
      execFileAsync(ffprobePath, ["-version"]),
    ]);

    return {
      ready: true,
      message: "Media tools are ready",
      ffmpegPath,
      ffprobePath,
      ffmpegVersion: firstLine(ffmpegVersion.stdout),
      ffprobeVersion: firstLine(ffprobeVersion.stdout),
    };
  } catch {
    return {
      ready: false,
      message: "Media tools need setup before export",
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
    ffprobeVersion: status.ffprobeVersion ?? "Version unavailable",
  };
}

export async function detectHardwareVideoEncoder(tools?: MediaTools) {
  if (hardwareEncoderPromise) return hardwareEncoderPromise;
  hardwareEncoderPromise = (async () => {
    const resolvedTools = tools ?? (await requireMediaTools());
    for (const encoder of [
      "h264_nvenc",
      "h264_qsv",
      "h264_amf",
    ] as HardwareVideoEncoder[]) {
      try {
        await execFileAsync(
          resolvedTools.ffmpegPath,
          [
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=64x64:d=0.1",
            "-frames:v",
            "1",
            "-c:v",
            encoder,
            "-f",
            "null",
            "-",
          ],
          { timeout: 3000, maxBuffer: 1024 * 1024 },
        );
        return encoder;
      } catch {
        // Try the next supported Windows hardware encoder.
      }
    }
    return undefined;
  })();
  return hardwareEncoderPromise;
}

export async function runFfmpeg(
  args: string[],
  tools?: MediaTools,
): Promise<FfmpegRunResult> {
  const resolvedTools = tools ?? (await requireMediaTools());
  const result = await execFileAsync(resolvedTools.ffmpegPath, args, {
    maxBuffer: 1024 * 1024 * 8,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

export async function runFfmpegStreaming(
  args: string[],
  options: FfmpegStreamingOptions = {},
  tools?: MediaTools,
): Promise<FfmpegRunResult> {
  const resolvedTools = tools ?? (await requireMediaTools());
  return new Promise((resolve, reject) => {
    const child = spawn(resolvedTools.ffmpegPath, args, { windowsHide: true });
    let stdout = "";
    let stderrTail = "";
    let aborted = false;
    const abort = () => {
      aborted = true;
      child.kill();
    };
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 1024 * 1024) stdout = stdout.slice(-1024 * 1024);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      options.onStderr?.(text);
      stderrTail += text;
      if (stderrTail.length > 1024 * 1024)
        stderrTail = stderrTail.slice(-1024 * 1024);
    });
    child.on("error", (error) => {
      options.signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.on("close", (code) => {
      options.signal?.removeEventListener("abort", abort);
      if (aborted) {
        const error = new Error("FFmpeg analysis was canceled");
        error.name = "AbortError";
        reject(error);
      } else if (code === 0) {
        resolve({ stdout, stderr: stderrTail });
      } else {
        reject(
          new Error(
            stderrTail.trim() || `FFmpeg exited with code ${code ?? "unknown"}`,
          ),
        );
      }
    });
  });
}

export async function runFfmpegWithProgress(
  args: string[],
  options: FfmpegProgressOptions,
  tools?: MediaTools,
): Promise<FfmpegRunResult> {
  const resolvedTools = tools ?? (await requireMediaTools());

  return new Promise((resolve, reject) => {
    const child = spawn(
      resolvedTools.ffmpegPath,
      ["-progress", "pipe:1", "-nostats", ...args],
      {
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    let progressBuffer = "";
    let aborted = false;

    const abort = () => {
      aborted = true;
      child.kill();
    };
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      progressBuffer += text;
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const [key, rawValue] = line.split("=", 2);
        if (key !== "out_time_us" && key !== "out_time_ms") continue;
        const encodedMicroseconds = Number(rawValue);
        if (!Number.isFinite(encodedMicroseconds) || options.durationMs <= 0)
          continue;
        options.onProgress?.(
          Math.min(
            99,
            Math.max(
              0,
              (encodedMicroseconds / 1000 / options.durationMs) * 100,
            ),
          ),
        );
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 1024 * 1024 * 8)
        stderr = stderr.slice(-1024 * 1024 * 8);
    });
    child.on("error", (error) => {
      options.signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.on("close", (code) => {
      options.signal?.removeEventListener("abort", abort);
      if (aborted) {
        const error = new Error("Export was canceled");
        error.name = "AbortError";
        reject(error);
      } else if (code === 0) {
        options.onProgress?.(100);
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            stderr.trim() || `FFmpeg exited with code ${code ?? "unknown"}`,
          ),
        );
      }
    });
  });
}

export async function runFfprobe(
  args: string[],
  tools?: MediaTools,
): Promise<FfmpegRunResult> {
  const resolvedTools = tools ?? (await requireMediaTools());
  const result = await execFileAsync(resolvedTools.ffprobePath, args, {
    maxBuffer: 1024 * 1024 * 8,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

export async function getMediaDurationMs(filePath: string, tools?: MediaTools) {
  const result = await runFfprobe(
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      filePath,
    ],
    tools,
  );
  const parsed = JSON.parse(result.stdout) as {
    format?: { duration?: string };
  };
  const durationMs = Number(parsed.format?.duration ?? 0) * 1000;
  return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
}

export async function validatePlayableMedia(
  filePath: string,
  tools?: MediaTools,
  requirements: MediaValidationRequirements = {},
) {
  const result = await runFfprobe(
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration,size",
      "-show_streams",
      "-of",
      "json",
      filePath,
    ],
    tools,
  );
  const parsed = JSON.parse(result.stdout) as {
    streams?: Array<{ codec_type?: string }>;
    format?: { duration?: string; size?: string };
  };
  const duration = Number(parsed.format?.duration ?? 0);
  const size = Number(parsed.format?.size ?? 0);
  const hasStreams = Boolean(parsed.streams?.length);
  const hasVideo = Boolean(
    parsed.streams?.some((stream) => stream.codec_type === "video"),
  );
  const hasAudio = Boolean(
    parsed.streams?.some((stream) => stream.codec_type === "audio"),
  );
  const hasMedia =
    (Number.isFinite(duration) && duration > 0) ||
    (hasStreams && Number.isFinite(size) && size > 0);
  if (
    !hasMedia ||
    (requirements.video && !hasVideo) ||
    (requirements.audio && !hasAudio)
  )
    return false;
  if (!requirements.decode) return true;

  const maps = [
    requirements.video ? ["-map", "0:v:0"] : [],
    requirements.audio ? ["-map", "0:a:0"] : [],
  ].flat();
  try {
    await runFfmpeg(
      ["-v", "error", "-i", filePath, ...maps, "-t", "3", "-f", "null", "-"],
      tools,
    );
    return true;
  } catch {
    return false;
  }
}
