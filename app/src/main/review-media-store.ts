import path from "node:path";
import fs from "node:fs/promises";
import type { ReviewMediaAsset, ReviewMediaImportSlot, ReviewMediaInventory, ReviewMediaKind, ReviewMediaSyncResult } from "../shared/review-media";
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
  {
    id: "program",
    label: "Program video",
    kind: "program",
    relativePath: path.join("Program", "program.webm")
  },
  {
    id: "camera-1",
    label: "Camera 1",
    kind: "camera",
    relativePath: path.join("Cameras", "camera-1.webm")
  },
  {
    id: "camera-2",
    label: "Camera 2",
    kind: "camera",
    relativePath: path.join("Cameras", "camera-2.webm")
  },
  {
    id: "camera-3",
    label: "Camera 3",
    kind: "camera",
    relativePath: path.join("Cameras", "camera-3.webm")
  },
  {
    id: "morgan-mic",
    label: "Morgan Mic",
    kind: "audio",
    relativePath: path.join("Audio", "morgan-mic.m4a")
  },
  {
    id: "guest-mic",
    label: "Guest Mic",
    kind: "audio",
    relativePath: path.join("Audio", "guest-mic.m4a")
  },
  {
    id: "extra-mic",
    label: "Extra Mic",
    kind: "audio",
    relativePath: path.join("Audio", "extra-mic.m4a")
  }
];

export async function loadReviewMedia(episodeId: string): Promise<ReviewMediaInventory> {
  const episodeFolder = path.join(getEpisodesRoot(), episodeId);
  const fallbackDurationMs = await loadRecordingDuration(episodeFolder);
  const assets = await Promise.all(expectedAssets.map((asset) => inspectAsset(episodeFolder, asset, fallbackDurationMs)));
  const rawProgram = assets.find((asset) => asset.kind === "program") ?? missingAsset(episodeFolder, expectedAssets[0]);
  const cameraMicrophones = await loadCameraMicrophones(episodeFolder);
  const rawCameras = assets
    .filter((asset) => asset.kind === "camera")
    .map((asset, index) => {
      const cameraSlot = `camera${index + 1}` as CameraSlotKey;
      const microphoneSlot = cameraMicrophones[cameraSlot] ?? fallbackCameraMicrophones[cameraSlot];
      return {
        ...asset,
        pairedAudioId: microphoneAssetIds[microphoneSlot],
        pairedAudioLabel: microphoneLabels[microphoneSlot]
      };
    });
  const audio = await Promise.all(assets.filter((asset) => asset.kind === "audio").map((asset) => ensureAudioWaveform(episodeFolder, asset)));
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

async function ensureAudioWaveform(episodeFolder: string, asset: ReviewMediaAsset): Promise<ReviewMediaAsset> {
  if (asset.status !== "ready" || !asset.filePath) return asset;
  const waveformPath = path.join(episodeFolder, "Session", "Review", `${asset.id}-waveform.png`);
  try {
    await fs.mkdir(path.dirname(waveformPath), { recursive: true });
    if (await proxyNeedsRefresh(waveformPath, [asset.filePath])) {
      await runFfmpeg(["-y", "-i", asset.filePath, "-filter_complex", "aformat=channel_layouts=mono,showwavespic=s=1400x120:colors=white", "-frames:v", "1", waveformPath]);
    }
    return { ...asset, waveformUrl: pathToPlaybackUrl(waveformPath) };
  } catch (error) {
    await logger.warning("ReviewMedia", "Audio waveform could not be prepared.", { filePath: asset.filePath, error: String(error) });
    return asset;
  }
}

const importTargets: Record<ReviewMediaImportSlot, { relativePath: string; kind: "video" | "audio"; label: string }> = {
  "camera-1": {
    relativePath: path.join("Cameras", "camera-1.webm"),
    kind: "video",
    label: "Camera 1"
  },
  "camera-2": {
    relativePath: path.join("Cameras", "camera-2.webm"),
    kind: "video",
    label: "Camera 2"
  },
  "camera-3": {
    relativePath: path.join("Cameras", "camera-3.webm"),
    kind: "video",
    label: "Camera 3"
  },
  "morgan-mic": {
    relativePath: path.join("Audio", "morgan-mic.m4a"),
    kind: "audio",
    label: "Main Audio"
  },
  "guest-mic": {
    relativePath: path.join("Audio", "guest-mic.m4a"),
    kind: "audio",
    label: "Guest Mic"
  },
  "extra-mic": {
    relativePath: path.join("Audio", "extra-mic.m4a"),
    kind: "audio",
    label: "Extra Mic"
  }
};

export async function importReviewMediaFile(episodeId: string, slot: ReviewMediaImportSlot, sourceFilePath: string) {
  const target = importTargets[slot];
  const episodeFolder = path.join(getEpisodesRoot(), episodeId);
  const targetPath = path.join(episodeFolder, target.relativePath);
  const extension = path.extname(targetPath);
  const temporaryPath = `${targetPath.slice(0, -extension.length)}.importing${extension}`;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.rm(temporaryPath, { force: true });
  try {
    if (target.kind === "video") {
      await runFfmpeg(["-y", "-i", sourceFilePath, "-map", "0:v:0", "-map", "0:a?", "-c:v", "libvpx-vp9", "-crf", "28", "-b:v", "0", "-deadline", "good", "-cpu-used", "4", "-c:a", "libopus", "-b:a", "160k", temporaryPath]);
    } else {
      await runFfmpeg(["-y", "-i", sourceFilePath, "-vn", "-c:a", "aac", "-b:a", "192k", temporaryPath]);
    }
    if (!(await validatePlayableMedia(temporaryPath, undefined, target.kind === "video" ? { video: true } : { audio: true }))) {
      throw new Error(`${target.label} could not be decoded after import.`);
    }
    await backupExistingImportedMedia(episodeFolder, targetPath, slot);
    await fs.rename(temporaryPath, targetPath);
    if (slot === "camera-1") {
      const programPath = path.join(episodeFolder, "Program", "program.webm");
      const fallbackMarkerPath = path.join(episodeFolder, "Session", "program-from-camera-1.json");
      let shouldRefreshProgram = false;
      try {
        await fs.access(fallbackMarkerPath);
        shouldRefreshProgram = true;
      } catch {
        try {
          await fs.access(programPath);
        } catch {
          shouldRefreshProgram = true;
        }
      }
      if (shouldRefreshProgram) {
        await fs.mkdir(path.dirname(programPath), { recursive: true });
        await backupExistingImportedMedia(episodeFolder, programPath, "program-fallback");
        await fs.copyFile(targetPath, programPath);
        await fs.mkdir(path.dirname(fallbackMarkerPath), { recursive: true });
        await fs.writeFile(fallbackMarkerPath, JSON.stringify({ source: "camera-1", updatedAt: new Date().toISOString() }, null, 2), "utf8");
      }
    }
    await logger.info("ReviewMedia", "Imported episode media.", {
      episodeId,
      slot,
      sourceFilePath,
      targetPath
    });
    return loadReviewMedia(episodeId);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function backupExistingImportedMedia(episodeFolder: string, filePath: string, label: string) {
  try {
    await fs.access(filePath);
    const backupFolder = path.join(episodeFolder, "Backup", "Imported Media");
    await fs.mkdir(backupFolder, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const extension = path.extname(filePath);
    await fs.copyFile(filePath, path.join(backupFolder, `${label}-${timestamp}${extension}`));
  } catch {
    // There is nothing to back up on the first import.
  }
}

export async function analyzeReviewMediaSync(episodeId: string): Promise<ReviewMediaSyncResult> {
  const episodeFolder = path.join(getEpisodesRoot(), episodeId);
  const referenceCandidates = [path.join(episodeFolder, "Audio", "morgan-mic.m4a"), path.join(episodeFolder, "Program", "program.webm")];
  const referencePath = await firstExistingPath(referenceCandidates);
  if (!referencePath)
    return {
      offsetsMs: {},
      confidence: "review",
      message: "Add the main audio before automatic sync."
    };
  const referenceOnsets = await detectSoundOnsetsMs(referencePath);
  if (referenceOnsets.length === 0)
    return {
      offsetsMs: {},
      confidence: "review",
      message: "Automatic sync could not find a clear sound in the main audio. Use Sync nudge to line up a clap or spoken word."
    };
  const offsetsMs: Record<string, number> = {};
  const cameraConfidence: Array<ReviewMediaSyncResult["confidence"]> = [];
  for (const index of [1, 2, 3]) {
    const cameraPath = path.join(episodeFolder, "Cameras", `camera-${index}.webm`);
    try {
      await fs.access(cameraPath);
      const alignment = alignSoundOnsets(referenceOnsets, await detectSoundOnsetsMs(cameraPath));
      if (!alignment) continue;
      offsetsMs[`camera-camera${index}`] = alignment.offsetMs;
      cameraConfidence.push(alignment.confidence);
    } catch {
      // Missing cameras remain untouched.
    }
  }
  const count = Object.keys(offsetsMs).length;
  const confidence = count > 0 && cameraConfidence.every((value) => value === "high") ? "high" : "review";
  return {
    offsetsMs,
    confidence,
    message: count > 0
      ? confidence === "high"
        ? `Aligned ${count} camera ${count === 1 ? "track" : "tracks"} from multiple matching sound moments.`
        : `Aligned ${count} camera ${count === 1 ? "track" : "tracks"} from the clearest sound available. Review a clap or spoken word and use Sync nudge if needed.`
      : "No clear camera audio was available for automatic sync."
  };
}

export function alignSoundOnsets(referenceOnsetsMs: number[], cameraOnsetsMs: number[]) {
  const candidates = referenceOnsetsMs.flatMap((reference) =>
    cameraOnsetsMs.map((camera) => camera - reference).filter((offset) => Math.abs(offset) <= 30000)
  );
  if (candidates.length === 0) return undefined;
  const scored = candidates.map((candidate) => {
    const possibleMatches = referenceOnsetsMs.flatMap((reference, referenceIndex) =>
      cameraOnsetsMs.map((camera, cameraIndex) => ({
        referenceIndex,
        cameraIndex,
        difference: camera - reference,
        errorMs: Math.abs(camera - reference - candidate)
      }))
    ).filter((match) => match.errorMs <= 250).sort((left, right) => left.errorMs - right.errorMs);
    const usedReferences = new Set<number>();
    const usedCameras = new Set<number>();
    const matches = possibleMatches.filter((match) => {
      if (usedReferences.has(match.referenceIndex) || usedCameras.has(match.cameraIndex)) return false;
      usedReferences.add(match.referenceIndex);
      usedCameras.add(match.cameraIndex);
      return true;
    });
    const differences = matches.map((match) => match.difference);
    const errors = differences.map((difference) => Math.abs(difference - candidate));
    const matchedReferenceTimes = matches.map((match) => referenceOnsetsMs[match.referenceIndex]);
    return {
      candidate,
      differences,
      matchCount: differences.length,
      matchSpanMs: matchedReferenceTimes.length > 1 ? Math.max(...matchedReferenceTimes) - Math.min(...matchedReferenceTimes) : 0,
      averageErrorMs: errors.length > 0 ? errors.reduce((total, error) => total + error, 0) / errors.length : Number.POSITIVE_INFINITY,
      maxErrorMs: errors.length > 0 ? Math.max(...errors) : Number.POSITIVE_INFINITY
    };
  }).sort((left, right) => right.matchCount - left.matchCount || left.averageErrorMs - right.averageErrorMs);
  const best = scored[0];
  const orderedDifferences = [...best.differences].sort((left, right) => left - right);
  const offsetMs = Math.round(orderedDifferences[Math.floor(orderedDifferences.length / 2)] ?? best.candidate);
  return {
    offsetMs: Math.max(-30000, Math.min(30000, offsetMs)),
    confidence: best.matchCount >= 3 && best.matchSpanMs >= 1000 && best.maxErrorMs <= 120 ? "high" as const : "review" as const,
    matchCount: best.matchCount,
    maxErrorMs: Math.round(best.maxErrorMs)
  };
}

async function detectSoundOnsetsMs(filePath: string) {
  const result = await runFfmpeg(["-hide_banner", "-i", filePath, "-af", "silencedetect=noise=-35dB:d=0.15", "-t", "120", "-f", "null", "-"]);
  const silenceStarts = [...result.stderr.matchAll(/silence_start:\s*([\d.]+)/g)].map((match) => Number(match[1]) * 1000);
  const silenceEnds = [...result.stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((match) => Math.round(Number(match[1]) * 1000));
  const beginsWithSound = silenceStarts.length === 0 || silenceStarts[0] > 50;
  return [...(beginsWithSound ? [0] : []), ...silenceEnds].filter((value) => Number.isFinite(value)).slice(0, 12);
}

async function firstExistingPath(paths: string[]) {
  for (const filePath of paths) {
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      // Try the next reference source.
    }
  }
  return undefined;
}

async function ensureReviewProxy(episodeFolder: string, asset: ReviewMediaAsset, pairedAudio?: ReviewMediaAsset): Promise<ReviewMediaAsset> {
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
        ? ["-y", "-fflags", "+genpts", "-i", sourceFile, "-i", pairedAudioFile, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "libopus", "-b:a", "160k", proxyPath]
        : asset.kind === "program"
          ? ["-y", "-fflags", "+genpts", "-i", sourceFile, "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", proxyPath]
          : ["-y", "-fflags", "+genpts", "-i", sourceFile, "-map", "0:v:0", "-an", "-c:v", "copy", proxyPath];
      await runFfmpeg(args);
    }
    const requirements = {
      video: true,
      audio: asset.kind === "program" || Boolean(usablePairedAudio)
    };
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

async function inspectAsset(episodeFolder: string, asset: Omit<ReviewMediaAsset, "status" | "message">, fallbackDurationMs?: number): Promise<ReviewMediaAsset> {
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
    return typeof state.elapsedMs === "number" && Number.isFinite(state.elapsedMs) && state.elapsedMs > 0 ? Math.round(state.elapsedMs) : undefined;
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
  const result = await runFfprobe(["-v", "error", "-show_entries", "format=duration,size:stream=codec_type,codec_name,width,height,sample_rate,channels", "-of", "json", filePath]);
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
