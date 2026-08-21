import path from "node:path";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import type { ReviewMediaAsset, ReviewMediaImportProgress, ReviewMediaImportSlot, ReviewMediaIntegrityResult, ReviewMediaInventory, ReviewMediaKind, ReviewMediaSyncResult } from "../shared/review-media";
import type { CameraSlotKey, MicrophoneSlotKey } from "../shared/types";
import { getEpisodesRoot } from "./config-service";
import { getMediaDurationMs, runFfmpeg, runFfmpegWithProgress, runFfprobe, validatePlayableMedia } from "./ffmpeg-tools";
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

interface ImportedMediaManifest {
  version: 1 | 2;
  assets: Partial<Record<ReviewMediaImportSlot, { relativePath: string; importedAt: string; sizeBytes?: number; sha256?: string }>>;
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
  const originalPaths = await loadImportedOriginalPaths(episodeId);
  const fallbackDurationMs = await loadRecordingDuration(episodeFolder);
  const assets = await Promise.all(expectedAssets.map(async (asset) => ({
    ...(await inspectAsset(episodeFolder, asset, fallbackDurationMs)),
    originalFilePath: originalPaths[asset.id as ReviewMediaImportSlot]
  })));
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
  const audio = await Promise.all(assets.filter((asset) => asset.kind === "audio").map((asset) => ensureMediaWaveform(episodeFolder, asset)));
  const program = await ensureVideoFilmstrip(episodeFolder, await ensureMediaWaveform(episodeFolder, await ensureReviewProxy(episodeFolder, rawProgram)));
  const cameras: ReviewMediaAsset[] = [];
  for (const camera of rawCameras) {
    const pairedAudio = camera.pairedAudioId ? audio.find((asset) => asset.id === camera.pairedAudioId) : undefined;
    cameras.push(await ensureVideoFilmstrip(episodeFolder, await ensureMediaWaveform(episodeFolder, await ensureReviewProxy(episodeFolder, camera, pairedAudio))));
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

async function ensureVideoFilmstrip(episodeFolder: string, asset: ReviewMediaAsset): Promise<ReviewMediaAsset> {
  if (asset.status !== "ready" || !asset.filePath || asset.kind === "audio") return asset;
  const filmstripPath = path.join(episodeFolder, "Session", "Review", `${asset.id}-filmstrip.jpg`);
  const posterPath = path.join(episodeFolder, "Session", "Review", `${asset.id}-poster.jpg`);
  const durationSeconds = Math.max(1, (asset.durationMs ?? 0) / 1000);
  const framesPerSecond = 12 / durationSeconds;
  try {
    await fs.mkdir(path.dirname(filmstripPath), { recursive: true });
    if (await proxyNeedsRefresh(posterPath, [asset.filePath])) {
      await runFfmpeg([
        "-y",
        "-ss",
        String(Math.min(durationSeconds * 0.15, 5)),
        "-i",
        asset.filePath,
        "-vf",
        "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720",
        "-frames:v",
        "1",
        "-q:v",
        "3",
        posterPath
      ]);
    }
    if (await proxyNeedsRefresh(filmstripPath, [asset.filePath])) {
      await runFfmpeg([
        "-y",
        "-i",
        asset.filePath,
        "-vf",
        `fps=${framesPerSecond},scale=160:90:force_original_aspect_ratio=increase,crop=160:90,tile=12x1`,
        "-frames:v",
        "1",
        "-q:v",
        "4",
        filmstripPath
      ]);
    }
    return {
      ...asset,
      posterUrl: mediaFilePlaybackUrl(posterPath),
      filmstripUrl: mediaFilePlaybackUrl(filmstripPath)
    };
  } catch (error) {
    await logger.warning("ReviewMedia", "Video filmstrip could not be prepared.", { filePath: asset.filePath, error: String(error) });
    return asset;
  }
}

async function ensureMediaWaveform(episodeFolder: string, asset: ReviewMediaAsset): Promise<ReviewMediaAsset> {
  if (asset.status !== "ready" || !asset.filePath) return asset;
  const waveformPath = path.join(episodeFolder, "Session", "Review", `${asset.id}-waveform.png`);
  try {
    await fs.mkdir(path.dirname(waveformPath), { recursive: true });
    if (await proxyNeedsRefresh(waveformPath, [asset.filePath])) {
      await runFfmpeg(["-y", "-i", asset.filePath, "-filter_complex", "aformat=channel_layouts=mono,showwavespic=s=1400x120:colors=white", "-frames:v", "1", waveformPath]);
    }
    return { ...asset, waveformUrl: mediaFilePlaybackUrl(waveformPath) };
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

export async function importReviewMediaFile(
  episodeId: string,
  slot: ReviewMediaImportSlot,
  sourceFilePath: string,
  options: { signal?: AbortSignal; onProgress?: (progress: ReviewMediaImportProgress) => void } = {}
) {
  const target = importTargets[slot];
  const episodeFolder = path.join(getEpisodesRoot(), episodeId);
  const targetPath = path.join(episodeFolder, target.relativePath);
  const extension = path.extname(targetPath);
  const temporaryPath = `${targetPath.slice(0, -extension.length)}.importing${extension}`;
  const sourceExtension = /^\.[a-z0-9]{1,8}$/i.test(path.extname(sourceFilePath)) ? path.extname(sourceFilePath).toLowerCase() : ".media";
  const originalPath = path.join(episodeFolder, "Originals", `${slot}${sourceExtension}`);
  const temporaryOriginalPath = `${originalPath}.importing`;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.mkdir(path.dirname(originalPath), { recursive: true });
  await assertImportDiskSpace(sourceFilePath, episodeFolder, [originalPath, targetPath]);
  const report = (progress: number, message: string) => options.onProgress?.({ episodeId, slot, progress: Math.round(progress), message });
  const assertNotCanceled = () => {
    if (!options.signal?.aborted) return;
    const error = new Error("Media import was canceled.");
    error.name = "AbortError";
    throw error;
  };
  await fs.rm(temporaryPath, { force: true });
  await fs.rm(temporaryOriginalPath, { force: true });
  try {
    assertNotCanceled();
    report(3, "Checking available storage");
    await fs.copyFile(sourceFilePath, temporaryOriginalPath);
    assertNotCanceled();
    report(20, "Protecting the full-quality original");
    if (!(await validatePlayableMedia(temporaryOriginalPath, undefined, target.kind === "video" ? { video: true } : { audio: true }))) {
      throw new Error(`${target.label} original could not be decoded.`);
    }
    assertNotCanceled();
    const durationMs = await getMediaDurationMs(temporaryOriginalPath).catch(() => 0);
    if (target.kind === "video") {
      await runFfmpegWithProgress(["-y", "-i", temporaryOriginalPath, "-map", "0:v:0", "-map", "0:a?", "-vf", "scale='min(1280,iw)':-2", "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-c:a", "libopus", "-b:a", "128k", temporaryPath], {
        durationMs,
        signal: options.signal,
        onProgress: (progress) => report(25 + progress * 0.6, "Building a responsive editing copy")
      });
    } else {
      await runFfmpegWithProgress(["-y", "-i", temporaryOriginalPath, "-vn", "-c:a", "aac", "-b:a", "160k", temporaryPath], {
        durationMs,
        signal: options.signal,
        onProgress: (progress) => report(25 + progress * 0.6, "Building a responsive editing copy")
      });
    }
    assertNotCanceled();
    report(87, "Verifying the editing copy");
    if (!(await validatePlayableMedia(temporaryPath, undefined, target.kind === "video" ? { video: true } : { audio: true }))) {
      throw new Error(`${target.label} could not be decoded after import.`);
    }
    assertNotCanceled();
    report(92, "Safely installing the imported media");
    await backupExistingImportedMedia(episodeFolder, originalPath, `${slot}-original`);
    await backupExistingImportedMedia(episodeFolder, targetPath, slot);
    await fs.rename(temporaryOriginalPath, originalPath);
    await fs.rename(temporaryPath, targetPath);
    report(96, "Fingerprinting the protected original");
    await saveImportedOriginalPath(episodeId, slot, originalPath);
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
    report(100, "Media is ready to edit");
    return loadReviewMedia(episodeId);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    await fs.rm(temporaryOriginalPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function loadImportedOriginalPaths(episodeId: string): Promise<Partial<Record<ReviewMediaImportSlot, string>>> {
  const episodeFolder = path.join(getEpisodesRoot(), episodeId);
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(episodeFolder, "Session", "imported-media.json"), "utf8")) as ImportedMediaManifest;
    const resolved: Partial<Record<ReviewMediaImportSlot, string>> = {};
    for (const [slot, asset] of Object.entries(manifest.assets) as Array<[ReviewMediaImportSlot, { relativePath: string }]>) {
      const candidate = path.resolve(episodeFolder, asset.relativePath);
      if (candidate !== episodeFolder && candidate.startsWith(`${episodeFolder}${path.sep}`)) {
        try {
          await fs.access(candidate);
          resolved[slot] = candidate;
        } catch {
          // A missing original falls back to the editor copy.
        }
      }
    }
    return resolved;
  } catch {
    return {};
  }
}

async function saveImportedOriginalPath(episodeId: string, slot: ReviewMediaImportSlot, originalPath: string) {
  const episodeFolder = path.join(getEpisodesRoot(), episodeId);
  const sessionFolder = path.join(episodeFolder, "Session");
  const manifestPath = path.join(sessionFolder, "imported-media.json");
  await fs.mkdir(sessionFolder, { recursive: true });
  let manifest: ImportedMediaManifest = { version: 2, assets: {} };
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as ImportedMediaManifest;
  } catch {
    // First imported source creates the manifest.
  }
  const stat = await fs.stat(originalPath);
  const nextManifest: ImportedMediaManifest = {
    version: 2,
    assets: {
      ...manifest.assets,
      [slot]: {
        relativePath: path.relative(episodeFolder, originalPath),
        importedAt: new Date().toISOString(),
        sizeBytes: stat.size,
        sha256: await calculateFileSha256(originalPath)
      }
    }
  };
  const temporaryPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(nextManifest, null, 2), "utf8");
  await fs.rename(temporaryPath, manifestPath);
}

function calculateFileSha256(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function verifyImportedMediaIntegrity(episodeId: string): Promise<ReviewMediaIntegrityResult> {
  const episodeFolder = path.join(getEpisodesRoot(), episodeId);
  let manifest: ImportedMediaManifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(episodeFolder, "Session", "imported-media.json"), "utf8")) as ImportedMediaManifest;
  } catch {
    return { items: [], message: "No protected imported originals have been indexed yet." };
  }
  const items = await Promise.all((Object.entries(manifest.assets) as Array<[ReviewMediaImportSlot, NonNullable<ImportedMediaManifest["assets"][ReviewMediaImportSlot]>]>).map(async ([slot, asset]) => {
    const filePath = path.resolve(episodeFolder, asset.relativePath);
    try {
      const stat = await fs.stat(filePath);
      if (!asset.sha256) return { slot, status: "not-indexed" as const, message: "Original found. Relink it once to add an integrity fingerprint." };
      if (asset.sizeBytes !== undefined && stat.size !== asset.sizeBytes) return { slot, status: "changed" as const, message: "Original size changed after import." };
      const matches = await calculateFileSha256(filePath) === asset.sha256;
      return matches
        ? { slot, status: "verified" as const, message: "Original matches its protected SHA-256 fingerprint." }
        : { slot, status: "changed" as const, message: "Original contents changed after import." };
    } catch {
      return { slot, status: "missing" as const, message: "Original is missing. Use Relink original to restore it." };
    }
  }));
  const problems = items.filter((item) => item.status !== "verified").length;
  return { items, message: problems === 0 ? `Verified ${items.length} protected original${items.length === 1 ? "" : "s"}.` : `${problems} original${problems === 1 ? " needs" : "s need"} attention.` };
}

export async function relinkImportedMediaFile(episodeId: string, slot: ReviewMediaImportSlot, sourceFilePath: string) {
  const episodeFolder = path.join(getEpisodesRoot(), episodeId);
  const manifestPath = path.join(episodeFolder, "Session", "imported-media.json");
  let manifest: ImportedMediaManifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as ImportedMediaManifest;
  } catch {
    throw new Error("Import this source once before using Relink original.");
  }
  const expected = manifest.assets[slot];
  if (!expected) throw new Error("Import this source once before using Relink original.");
  const targetPath = path.resolve(episodeFolder, expected.relativePath);
  if (targetPath === episodeFolder || !targetPath.startsWith(`${episodeFolder}${path.sep}`)) throw new Error("The saved original path is invalid.");
  const target = importTargets[slot];
  if (!(await validatePlayableMedia(sourceFilePath, undefined, target.kind === "video" ? { video: true } : { audio: true }))) throw new Error("The selected file is not playable media.");
  const sourceHash = await calculateFileSha256(sourceFilePath);
  if (expected.sha256 && sourceHash !== expected.sha256) throw new Error("That file does not match the original imported recording.");
  const temporaryPath = `${targetPath}.${randomUUID()}.relinking`;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.copyFile(sourceFilePath, temporaryPath);
    await backupExistingImportedMedia(episodeFolder, targetPath, `${slot}-original`);
    await fs.rename(temporaryPath, targetPath);
    await saveImportedOriginalPath(episodeId, slot, targetPath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  return loadReviewMedia(episodeId);
}

const IMPORT_BACKUP_RETENTION = 5;

async function assertImportDiskSpace(sourceFilePath: string, destinationFolder: string, replacedFiles: string[]) {
  try {
    const sourceBytes = (await fs.stat(sourceFilePath)).size;
    let backupBytes = 0;
    for (const filePath of replacedFiles) {
      try {
        backupBytes += (await fs.stat(filePath)).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const volume = await fs.statfs(destinationFolder);
    const availableBytes = Number(volume.bavail) * Number(volume.bsize);
    const requiredBytes = Math.ceil(sourceBytes * 1.75) + backupBytes + 512 * 1024 * 1024;
    if (availableBytes < requiredBytes) {
      throw new Error(`There is not enough free disk space to import this file safely. Free at least ${formatBytes(requiredBytes - availableBytes)} and try again.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("There is not enough free disk space")) throw error;
    await logger.warning("ReviewMedia", "Could not complete the import disk-space preflight.", { error: String(error) });
  }
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${Math.ceil(bytes / 1024 ** 3)} GB`;
  return `${Math.ceil(bytes / 1024 ** 2)} MB`;
}

export async function backupExistingImportedMedia(episodeFolder: string, filePath: string, label: string) {
  try {
    await fs.access(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const backupFolder = path.join(episodeFolder, "Backup", "Imported Media");
  await fs.mkdir(backupFolder, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const extension = path.extname(filePath);
  const prefix = `${label}-`;
  const backupPath = path.join(backupFolder, `${prefix}${timestamp}-${randomUUID()}${extension}`);
  try {
    await fs.copyFile(filePath, backupPath);
  } catch (error) {
    throw new Error(`The existing ${label} could not be backed up, so the import was stopped before anything was replaced.`, { cause: error });
  }
  const matchingBackups = (await fs.readdir(backupFolder, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const oldBackup of matchingBackups.slice(IMPORT_BACKUP_RETENTION)) {
    await fs.rm(path.join(backupFolder, oldBackup), { force: true });
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
  const referenceEnvelope = await extractWaveformEnvelope(referencePath).catch(() => []);
  const referenceOnsets = referenceEnvelope.length === 0 ? await detectSoundOnsetsMs(referencePath) : [];
  if (referenceEnvelope.length === 0 && referenceOnsets.length === 0)
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
      const cameraEnvelope = referenceEnvelope.length > 0 ? await extractWaveformEnvelope(cameraPath).catch(() => []) : [];
      const alignment = cameraEnvelope.length > 0
        ? correlateAudioEnvelopes(referenceEnvelope, cameraEnvelope)
        : alignSoundOnsets(referenceOnsets.length > 0 ? referenceOnsets : await detectSoundOnsetsMs(referencePath), await detectSoundOnsetsMs(cameraPath));
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
        ? `Aligned ${count} camera ${count === 1 ? "track" : "tracks"} by matching their audio waveforms.`
        : `Aligned ${count} camera ${count === 1 ? "track" : "tracks"} from the strongest audio match. Review a spoken word and use Sync nudge if needed.`
      : "No clear camera audio was available for automatic sync."
  };
}

const SYNC_ENVELOPE_INTERVAL_MS = 20;

async function extractWaveformEnvelope(filePath: string) {
  const rawPath = path.join(path.dirname(filePath), `.sync-${randomUUID()}.s16le`);
  try {
    await runFfmpeg(["-y", "-hide_banner", "-loglevel", "error", "-i", filePath, "-t", "120", "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", rawPath]);
    const pcm = await fs.readFile(rawPath);
    const samplesPerWindow = 8000 / (1000 / SYNC_ENVELOPE_INTERVAL_MS);
    const envelope: number[] = [];
    for (let byteOffset = 0; byteOffset + samplesPerWindow * 2 <= pcm.length; byteOffset += samplesPerWindow * 2) {
      let energy = 0;
      for (let sample = 0; sample < samplesPerWindow; sample += 1) {
        const value = pcm.readInt16LE(byteOffset + sample * 2) / 32768;
        energy += value * value;
      }
      envelope.push(Math.log1p(Math.sqrt(energy / samplesPerWindow) * 1000));
    }
    return envelope;
  } finally {
    await fs.rm(rawPath, { force: true }).catch(() => undefined);
  }
}

export function correlateAudioEnvelopes(reference: number[], camera: number[], intervalMs = SYNC_ENVELOPE_INTERVAL_MS) {
  const maxLag = Math.round(30000 / intervalMs);
  const minimumOverlap = Math.min(reference.length, camera.length, Math.round(5000 / intervalMs));
  if (minimumOverlap < Math.round(1000 / intervalMs)) return undefined;
  const normalize = (values: number[]) => {
    const mean = values.reduce((total, value) => total + value, 0) / values.length;
    return values.map((value) => value - mean);
  };
  const normalizedReference = normalize(reference);
  const normalizedCamera = normalize(camera);
  const scores: Array<{ lag: number; score: number }> = [];
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    const referenceStart = Math.max(0, -lag);
    const cameraStart = Math.max(0, lag);
    const overlap = Math.min(reference.length - referenceStart, camera.length - cameraStart);
    if (overlap < minimumOverlap) continue;
    let product = 0;
    let referenceEnergy = 0;
    let cameraEnergy = 0;
    for (let index = 0; index < overlap; index += 1) {
      const referenceValue = normalizedReference[referenceStart + index];
      const cameraValue = normalizedCamera[cameraStart + index];
      product += referenceValue * cameraValue;
      referenceEnergy += referenceValue * referenceValue;
      cameraEnergy += cameraValue * cameraValue;
    }
    const denominator = Math.sqrt(referenceEnergy * cameraEnergy);
    if (denominator > 0) scores.push({ lag, score: product / denominator });
  }
  scores.sort((left, right) => right.score - left.score);
  const best = scores[0];
  if (!best || best.score < 0.2) return undefined;
  const separatedRunnerUp = scores.find((candidate) => Math.abs(candidate.lag - best.lag) >= Math.round(200 / intervalMs));
  const margin = best.score - (separatedRunnerUp?.score ?? 0);
  return {
    offsetMs: Math.max(-30000, Math.min(30000, Math.round(best.lag * intervalMs))),
    confidence: best.score >= 0.5 && margin >= 0.05 ? "high" as const : "review" as const,
    score: Number(best.score.toFixed(3)),
    margin: Number(margin.toFixed(3))
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
        ? ["-y", "-nostats", "-fflags", "+genpts", "-i", sourceFile, "-i", pairedAudioFile, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "libopus", "-b:a", "160k", proxyPath]
        : asset.kind === "program"
          ? ["-y", "-nostats", "-fflags", "+genpts", "-i", sourceFile, "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", proxyPath]
          : ["-y", "-nostats", "-fflags", "+genpts", "-i", sourceFile, "-map", "0:v:0", "-an", "-c:v", "copy", proxyPath];
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
      playbackUrl: mediaFilePlaybackUrl(proxyPath),
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
      playbackUrl: mediaFilePlaybackUrl(filePath),
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
        playbackUrl: mediaFilePlaybackUrl(filePath),
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

export function mediaFilePlaybackUrl(filePath: string) {
  const encodedPath = Buffer.from(filePath, "utf8").toString("base64url");
  return mediaPlaybackBaseUrl ? `${mediaPlaybackBaseUrl}/media/${encodedPath}` : `wai-media://episode/${encodedPath}`;
}
