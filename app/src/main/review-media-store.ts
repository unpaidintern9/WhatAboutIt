import path from "node:path";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { ReviewMediaAsset, ReviewMediaInventory, ReviewMediaKind } from "../shared/review-media";
import { getEpisodesRoot } from "./config-service";
import { runFfprobe } from "./ffmpeg-tools";
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
  const assets = await Promise.all(expectedAssets.map((asset) => inspectAsset(episodeFolder, asset)));
  const program = assets.find((asset) => asset.kind === "program") ?? missingAsset(episodeFolder, expectedAssets[0]);
  const cameras = assets.filter((asset) => asset.kind === "camera");
  const audio = assets.filter((asset) => asset.kind === "audio");
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

async function inspectAsset(
  episodeFolder: string,
  asset: Omit<ReviewMediaAsset, "status" | "message">
): Promise<ReviewMediaAsset> {
  const filePath = path.join(episodeFolder, asset.relativePath);

  try {
    const stat = await fs.stat(filePath);
    const probe = await probeMedia(filePath);
    const duration = Number(probe.format?.duration ?? 0);

    return {
      ...asset,
      filePath,
      playbackUrl: pathToPlaybackUrl(filePath),
      status: "ready",
      durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : undefined,
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
  return pathToFileURL(filePath).toString();
}
