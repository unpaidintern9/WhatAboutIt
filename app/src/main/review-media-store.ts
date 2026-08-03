import path from "node:path";
import fs from "node:fs/promises";
import type { ReviewMediaAsset, ReviewMediaInventory, ReviewMediaKind } from "../shared/review-media";
import type { CameraSlotKey, MicrophoneSlotKey } from "../shared/types";
import { getEpisodesRoot } from "./config-service";
import { runFfmpeg, runFfprobe, validatePlayableMedia } from "./ffmpeg-tools";
import { logger } from "./logger";

interface MediaProbeResult {
  format?: {
    duration?: string;
    size?: string;
  };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    sample_rate?: string;
    channels?: number;
  }>;
}

interface RecordingStateFile {
  elapsedMs?: number;
}

interface DeviceMapFile {
  cameraMicrophones?: Partial<Record<CameraSlotKey, MicrophoneSlotKey>>;
}

const fallbackCameraMicrophones: Record<CameraSlotKey, MicrophoneSlotKey> = {
  camera1: "morganMic",
  camera2: "guestMic",
  camera3: "extraMic"
};

const microphoneAssetIds: Record<MicrophoneSlotKey, string> = {
  morganMic: "morgan-mic",
  guestMic: "guest-mic",
  extraMic: "extra-mic"
};

const microphoneLabels: Record<MicrophoneSlotKey, string> = {
  morganMic: "Morgan Mic",
  guestMic: "Guest Mic",
  extraMic: "Extra Mic"
};

let mediaPlaybackBaseUrl: string | undefined;

export function configureMediaPlaybackBaseUrl(baseUrl: string) {
  mediaPlaybackBaseUrl = baseUrl.replace(/\/$/, "");
}

const expectedAssets: Array<Omit<ReviewMediaAsset, "status" | "message">> = [
  { id: "program", label: "Program video", kind: "program", relativePath: path.join("Program", "program.webm") },
  { id: "camera-1", label: "Camera 1", kind: "camera", relativePath: path.join("Cameras", "camera-1.webm") },
  { id: "camera-2", label: "Camera 2", kind: "camera", relativePath: path.join("Cameras", "camera-2.webm") },
  { id: "camera-3", label: "Camera 3", kind: "camera", relativePath: path.join("Cameras", "camera-3.webm") },
  { id: "morgan-mic", label: "Morgan Mic", kind: "audio", relativePath: path.join("Audio", "morgan-mic.m4a") },
  { id: "guest-mic", label: "Guest Mic", kind: "audio", relativePath: path.join("Audio", "guest-mic.m4a") },
  { id: "extra-mic", label: "Extra Mic", kind: "audio", relativePath: path.join("Audio", "extra-mic.m4a") }
];

export async function loadReviewMedia(episodeId: string): Promise<ReviewMediaInventory> {
  const episodeFolder = path.join(getEpisodesRoot(), episodeId);
  const fallbackDurationMs = await loadRecordingDuration(episodeFolder);
  const assets = await Promise.all(expectedAssets.map((asset) => inspectAsset(episodeFolder, asset, fallbackDurationMs)));
  const rawProgram = assets.find((asset) => asset.kind === "program") ?? missingAsset(episodeFolder, expectedAssets[0]);
  const cameraMicrophones = await loadCameraMicrophones(episodeFolder);
  const rawCameras = assets.filter((asset) => asset.kind === "camera").map((asset, index) => {
    const cameraSlot = `camera${index + 1}` as CameraSlotKey;
    const microphoneSlot = cameraMicrophones[cameraSlot] ?? fallbackCameraMicrophones[cameraSlot];
    return {
      ...asset,
      pairedAudioId: microphoneAssetIds[microphoneSlot],
      pairedAudioLabel: microphoneLabels[microphoneSlot]
    };
  });
  const audio = assets.filter((asset) => asset.kind === "audio");
  const program = await ensureReviewProxy(episodeFolder, rawProgram);
  const cameras: ReviewMediaAsset[] = [];
  for (const camera of rawCameras) {
    const pairedAudio = camera.pairedAudioId ? audio.find((asset) => asset.id === camera.pairedAudioId) : undefined;
    cameras.push(await ensureReviewProxy(episodeFolder, camera, pairedAudio));
  }
  const hasPlayableProgram = program.status === "ready";

  return {
    episodeId,
    episodeFolder,
    loadedAt: new Date().toISOString(),
    program,
    cameras,
    audio,
    hasPlayableProgram,
    message: hasPlayableProgram ? "Review your recording" : "No program video found yet"
  };
}

async function ensureReviewProxy(
  episodeFolder: string,
  asset: ReviewMediaAsset,
  pairedAudio?: ReviewMediaAsset
): Promise<ReviewMediaAsset> {
  if (asset.status !== "ready" || !asset.filePath) return asset;
  const sourceFile = asset.filePath;
  const proxyFolder = path.join(episodeFolder, "Session", "Review");
  const proxyPath = path.join(proxyFolder, `${asset.id}-review.webm`);
  const usablePairedAudio = pairedAudio?.status === "ready" && pairedAudio.filePath ? pairedAudio : undefined;
  const pairedAudioFile = usablePairedAudio?.filePath;
  const proxySources = [sourceFile];
  if (pairedAudioFile) proxySources.push(pairedAudioFile);

  try {
    await fs.mkdir(proxyFolder, { recursive: true });
    if (await proxyNeedsRefresh(proxyPath, proxySources)) {
      const args = pairedAudioFile
        ? [
            "-y", "-fflags", "+genpts", "-i", sourceFile,
            "-i", pairedAudioFile,
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "copy", "-c:a", "libopus", "-b:a", "160k", proxyPath
          ]
        : asset.kind === "program"
          ? ["-y", "-fflags", "+genpts", "-i", sourceFile, "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", proxyPath]
          : ["-y", "-fflags", "+genpts", "-i", sourceFile, "-map", "0:v:0", "-an", "-c:v", "copy", proxyPath];
      await runFfmpeg(args);
    }
    const requirements = { video: true, audio: asset.kind === "program" || Boolean(usablePairedAudio) };
    if (!(await validatePlayableMedia(proxyPath, undefined, requirements))) throw new Error("Review proxy validation failed.");
    const probe = await probeMedia(proxyPath);
    const duration = Number(probe.format?.duration ?? 0);
    return {
      ...asset,
      playbackUrl: pathToPlaybackUrl(proxyPath),
      reviewProxyPath: proxyPath,
      includesPairedAudio: Boolean(usablePairedAudio),
      durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : asset.durationMs,
      message: usablePairedAudio ? `Ready with ${asset.pairedAudioLabel}` : asset.message
    };
  } catch (error) {
    await fs.rm(proxyPath, { force: true }).catch(() => undefined);
    await logger.warning("ReviewMedia", "Review proxy could not be prepared; using the original file.", { filePath: sourceFile, error: String(error) });
    return asset;
  }
}

async function proxyNeedsRefresh(proxyPath: string, sourcePaths: string[]) {
  try {
    const [proxyStat, ...sourceStats] = await Promise.all([fs.stat(proxyPath), ...sourcePaths.map((sourcePath) => fs.stat(sourcePath))]);
    return sourceStats.some((sourceStat) => sourceStat.mtimeMs > proxyStat.mtimeMs);
  } catch {
    return true;
  }
}

async function loadCameraMicrophones(episodeFolder: string) {
  try {
    const deviceMap = JSON.parse(await fs.readFile(path.join(episodeFolder, "Session", "device-map.json"), "utf8")) as DeviceMapFile;
    return deviceMap.cameraMicrophones ?? {};
  } catch {
    return {};
  }
}

async function inspectAsset(
  episodeFolder: string,
  asset: Omit<ReviewMediaAsset, "status" | "message">,
  fallbackDurationMs?: number
): Promise<ReviewMediaAsset> {
  const filePath = path.join(episodeFolder, asset.relativePath);

  try {
    const stat = await fs.stat(filePath);
    const probe = await probeMedia(filePath);
    const duration = Number(probe.format?.duration ?? 0);
    const probedDurationMs = Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : undefined;

    return {
      ...asset,
      filePath,
      playbackUrl: pathToPlaybackUrl(filePath),
      status: "ready",
      durationMs: probedDurationMs ?? fallbackDurationMs,
      sizeBytes: stat.size,
      codecSummary: summarizeCodecs(probe, asset.kind),
      message: "Ready to review"
    };
  } catch (error) {
    try {
      await fs.access(filePath);
      await logger.warning("ReviewMedia", "Media exists but could not be probed.", { filePath, error: String(error) });
      return {
        ...asset,
        filePath,
        playbackUrl: pathToPlaybackUrl(filePath),
        status: "needs-proxy",
        message: "This file needs a review proxy before playback"
      };
    } catch {
      return missingAsset(episodeFolder, asset);
    }
  }
}

async function loadRecordingDuration(episodeFolder: string) {
  try {
    const statePath = path.join(episodeFolder, "Session", "recording-state.json");
    const state = JSON.parse(await fs.readFile(statePath, "utf8")) as RecordingStateFile;
    return typeof state.elapsedMs === "number" && Number.isFinite(state.elapsedMs) && state.elapsedMs > 0
      ? Math.round(state.elapsedMs)
      : undefined;
  } catch {
    return undefined;
  }
}

function missingAsset(episodeFolder: string, asset: Omit<ReviewMediaAsset, "status" | "message">): ReviewMediaAsset {
  return {
    ...asset,
    filePath: path.join(episodeFolder, asset.relativePath),
    status: "missing",
    message: "Not recorded in this episode"
  };
}

async function probeMedia(filePath: string): Promise<MediaProbeResult> {
  const result = await runFfprobe([
    "-v",
    "error",
    "-show_entries",
    "format=duration,size:stream=codec_type,codec_name,width,height,sample_rate,channels",
    "-of",
    "json",
    filePath
  ]);
  return JSON.parse(result.stdout) as MediaProbeResult;
}

function summarizeCodecs(probe: MediaProbeResult, kind: ReviewMediaKind) {
  const stream = probe.streams?.find((candidate) => candidate.codec_type === (kind === "audio" ? "audio" : "video")) ?? probe.streams?.[0];
  if (!stream?.codec_name) return "Media file";
  if (stream.width && stream.height) return `${stream.codec_name} ${stream.width}x${stream.height}`;
  if (stream.sample_rate) return `${stream.codec_name} ${stream.sample_rate} Hz`;
  return stream.codec_name;
}

function pathToPlaybackUrl(filePath: string) {
  const encodedPath = Buffer.from(filePath, "utf8").toString("base64url");
  return mediaPlaybackBaseUrl ? `${mediaPlaybackBaseUrl}/media/${encodedPath}` : `wai-media://episode/${encodedPath}`;
}
