import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import type {
  RecordingSession,
  RecordingChunkInput,
  RecordingFinalizeResult,
  RecordingMediaTarget,
  RecordingSessionCreateInput,
  RecordingState,
  RecordingTrackSaveInput,
  RecordingTrackSaveResult,
  RecordingTrackSaveStatus,
  RecordingTrackSlot
} from "../shared/recording";
import {
  createDeviceMap,
  createInitialRecordingState,
  createSyncMetadata,
  isUnfinishedRecordingState,
  requiredRecordingSessionFolders,
  type SyncMetadata
} from "../shared/recording";
import type { EpisodeMetadata } from "../shared/types";
import { getEpisodesRoot } from "./config-service";
import { runFfmpeg, validatePlayableMedia } from "./ffmpeg-tools";
import { logger } from "./logger";

function slugify(input: string) {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "recording-session"
  );
}

async function writeJson(filePath: string, value: unknown) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function createRecordingSession(input: RecordingSessionCreateInput): Promise<RecordingSession> {
  const now = new Date().toISOString();
  const episodeTitle = input.episodeTitle?.trim() || "Quick Recording";
  const episodeId = input.episodeId || `${now.slice(0, 10)}-${slugify(episodeTitle)}-${crypto.randomUUID().slice(0, 8)}`;
  const folderPath = path.join(getEpisodesRoot(), episodeId);

  await fs.mkdir(folderPath, { recursive: true });
  await Promise.all(requiredRecordingSessionFolders.map((folder) => fs.mkdir(path.join(folderPath, folder), { recursive: true })));

  const session: RecordingSession = {
    id: crypto.randomUUID(),
    episodeId,
    episodeTitle,
    folderPath,
    startedAt: now,
    status: input.practice ? "stopped" : "recording",
    practice: Boolean(input.practice),
    backupFolderPath: input.backupFolderPath
  };

  const state = createInitialRecordingState(session.id, now);
  const deviceMap = createDeviceMap(input.deviceDefaults);
  const syncMetadata = createSyncMetadata(input.deviceDefaults, now);

  await writeJson(path.join(folderPath, "Session", "recording-session.json"), session);
  await ensureRecordingMetadata(folderPath, {
    id: episodeId,
    title: episodeTitle,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    folderPath,
    phase: "phase-1-shell"
  });
  await writeJson(path.join(folderPath, "Session", "device-map.json"), deviceMap);
  await writeJson(path.join(folderPath, "Session", "recording-state.json"), state);
  await writeJson(path.join(folderPath, "Session", "sync-metadata.json"), syncMetadata);
  await fs.writeFile(path.join(folderPath, "Logs", "errors.log"), "", "utf8");
  await logger.info("RecordingService", "Created local recording session.", { sessionId: session.id, episodeId });

  return session;
}

interface CaptureManifestSource {
  target: RecordingMediaTarget;
  kind: RecordingChunkInput["kind"];
  mimeType: string;
  partialPath: string;
  bytesWritten: number;
  lastSequence: number;
  firstChunkAt?: string;
  lastChunkAt: string;
}

interface CaptureManifest {
  sessionId: string;
  startedAt: string;
  updatedAt: string;
  sources: Partial<Record<RecordingMediaTarget, CaptureManifestSource>>;
}

const captureManifestQueues = new Map<string, Promise<void>>();

function assertRecordingFolder(folderPath: string) {
  const episodesRoot = path.resolve(getEpisodesRoot());
  const resolved = path.resolve(folderPath);
  if (resolved !== episodesRoot && !resolved.startsWith(`${episodesRoot}${path.sep}`)) {
    throw new Error("Recording folder is outside the local episodes library.");
  }
  return resolved;
}

function captureManifestPath(folderPath: string) {
  return path.join(folderPath, "Session", "capture-manifest.json");
}

function mediaBaseName(target: RecordingMediaTarget) {
  if (target === "program") return "program";
  if (target.startsWith("camera")) return target.replace("camera", "camera-");
  if (target === "morganMic") return "morgan-mic";
  if (target === "guestMic") return "guest-mic";
  return "extra-mic";
}

function partialMediaPath(folderPath: string, target: RecordingMediaTarget, mimeType: string) {
  if (target === "program") return path.join(folderPath, "Program", "program.partial.webm");
  if (target.startsWith("camera")) return path.join(folderPath, "Cameras", `${mediaBaseName(target)}.partial.webm`);
  const extension = mimeType.includes("mp4") || mimeType.includes("m4a") ? "m4a" : "webm";
  return path.join(folderPath, "Audio", `${mediaBaseName(target)}.source.partial.${extension}`);
}

async function enqueueManifestWrite(folderPath: string, update: () => Promise<void>) {
  const previous = captureManifestQueues.get(folderPath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(update);
  captureManifestQueues.set(folderPath, next);
  try {
    await next;
  } finally {
    if (captureManifestQueues.get(folderPath) === next) captureManifestQueues.delete(folderPath);
  }
}

async function backupExistingRecordingFiles(folderPath: string) {
  const candidates = [
    path.join(folderPath, "Program", "program.webm"),
    ...(["camera-1.webm", "camera-2.webm", "camera-3.webm"] as const).map((name) => path.join(folderPath, "Cameras", name)),
    ...(["morgan-mic.m4a", "guest-mic.m4a", "extra-mic.m4a"] as const).map((name) => path.join(folderPath, "Audio", name))
  ];
  const existing: string[] = [];
  for (const candidate of candidates) {
    try {
      if ((await fs.stat(candidate)).size > 0) existing.push(candidate);
    } catch {
      // A new episode normally has no previous media.
    }
  }
  if (existing.length === 0) return;
  const backupFolder = path.join(folderPath, "Backup", "Recordings", new Date().toISOString().replace(/[:.]/g, "-"));
  await fs.mkdir(backupFolder, { recursive: true });
  await Promise.all(existing.map((source) => fs.copyFile(source, path.join(backupFolder, path.basename(source)))));
}

export async function beginRecordingMedia(folderPath: string) {
  const safeFolder = assertRecordingFolder(folderPath);
  const session = await readJsonFile<RecordingSession>(path.join(safeFolder, "Session", "recording-session.json"));
  if (!session) throw new Error("Recording session could not be opened.");
  await backupExistingRecordingFiles(safeFolder);
  const partialCandidates = [
    partialMediaPath(safeFolder, "program", "video/webm"),
    ...(["camera1", "camera2", "camera3"] as const).map((target) => partialMediaPath(safeFolder, target, "video/webm")),
    ...(["morganMic", "guestMic", "extraMic"] as const).flatMap((target) => [
      partialMediaPath(safeFolder, target, "audio/webm"),
      partialMediaPath(safeFolder, target, "audio/mp4")
    ])
  ];
  await Promise.all(partialCandidates.map((candidate) => fs.rm(candidate, { force: true })));
  const now = new Date().toISOString();
  const manifest: CaptureManifest = { sessionId: session.id, startedAt: now, updatedAt: now, sources: {} };
  await writeJson(captureManifestPath(safeFolder), manifest);
  return manifest;
}

export async function appendRecordingChunk(folderPath: string, chunk: RecordingChunkInput) {
  const safeFolder = assertRecordingFolder(folderPath);
  if (chunk.bytes.length === 0) return { bytesWritten: 0, lastChunkAt: new Date().toISOString() };
  const partialPath = partialMediaPath(safeFolder, chunk.target, chunk.mimeType);
  await fs.appendFile(partialPath, chunk.bytes);
  const stats = await fs.stat(partialPath);
  const lastChunkAt = new Date().toISOString();
  if (chunk.sequence === 0 || chunk.sequence % 5 === 0) {
    await enqueueManifestWrite(safeFolder, async () => {
      const manifestPath = captureManifestPath(safeFolder);
      const current = await readJsonFile<CaptureManifest>(manifestPath);
      if (!current) throw new Error("Recording capture manifest is missing.");
      current.updatedAt = lastChunkAt;
      const previousSource = current.sources[chunk.target];
      current.sources[chunk.target] = {
        target: chunk.target,
        kind: chunk.kind,
        mimeType: chunk.mimeType,
        partialPath,
        bytesWritten: stats.size,
        lastSequence: chunk.sequence,
        firstChunkAt: previousSource?.firstChunkAt ?? lastChunkAt,
        lastChunkAt
      };
      await writeJson(manifestPath, current);
    });
  }
  return { bytesWritten: stats.size, lastChunkAt };
}

async function finalizeProgramSource(folderPath: string, source?: CaptureManifestSource) {
  if (!source) return { programPath: undefined, playable: false };
  const finalPath = path.join(folderPath, "Program", "program.webm");
  await fs.rm(finalPath, { force: true });
  await fs.rename(source.partialPath, finalPath);
  return { programPath: finalPath, playable: await isPlayableRecording(finalPath) };
}

async function finalizeTrackSource(folderPath: string, source: CaptureManifestSource): Promise<RecordingTrackSaveResult> {
  const slot = source.target as RecordingTrackSlot;
  try {
    if (source.kind === "camera") {
      const finalPath = path.join(folderPath, "Cameras", `${mediaBaseName(slot)}.webm`);
      await fs.rm(finalPath, { force: true });
      await fs.rename(source.partialPath, finalPath);
      if (!(await isPlayableRecording(finalPath))) throw new Error("Camera track failed validation.");
      return { slot, kind: "camera", status: "saved", filePath: finalPath, message: "Saved and verified" };
    }
    const finalPath = path.join(folderPath, "Audio", `${mediaBaseName(slot)}.m4a`);
    await fs.rm(finalPath, { force: true });
    await runFfmpeg(["-y", "-i", source.partialPath, "-vn", "-c:a", "aac", "-b:a", "160k", finalPath]);
    if (!(await isPlayableRecording(finalPath))) throw new Error("Audio track failed validation.");
    if (!(await hasAudibleSignal(finalPath))) {
      await fs.rm(source.partialPath, { force: true });
      await appendRecordingError(folderPath, `${slot} was saved but contains no audible signal.`);
      return { slot, kind: "audio", status: "needs-attention", filePath: finalPath, message: "Saved, but no audible signal was detected" };
    }
    await fs.rm(source.partialPath, { force: true });
    return { slot, kind: "audio", status: "saved", filePath: finalPath, message: "Saved and verified" };
  } catch (error) {
    await appendRecordingError(folderPath, `${slot} could not be finalized: ${String(error)}`);
    return { slot, kind: source.kind === "camera" ? "camera" : "audio", status: "needs-attention", message: "Partial recording kept for recovery" };
  }
}

async function hasAudibleSignal(filePath: string) {
  try {
    const result = await runFfmpeg(["-nostats", "-i", filePath, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"]);
    const match = /max_volume:\s*(-?inf|-?\d+(?:\.\d+)?)\s*dB/i.exec(result.stderr);
    if (!match || match[1].toLowerCase() === "-inf") return false;
    const maxVolumeDb = Number(match[1]);
    return Number.isFinite(maxVolumeDb) && maxVolumeDb > -70;
  } catch {
    return false;
  }
}

async function copyFinalizedRecordingToBackup(session: RecordingSession, programPath: string | undefined, tracks: RecordingTrackSaveResult[]) {
  if (!session.backupFolderPath) return undefined;
  const backupPath = path.join(session.backupFolderPath, `${slugify(session.episodeTitle)}-${session.id.slice(0, 8)}`);
  await fs.mkdir(backupPath, { recursive: true });
  const files = [programPath, ...tracks.map((track) => track.filePath)].filter((filePath): filePath is string => Boolean(filePath));
  await Promise.all(files.map(async (source) => {
    const group = path.basename(path.dirname(source));
    const destinationFolder = path.join(backupPath, group);
    await fs.mkdir(destinationFolder, { recursive: true });
    await fs.copyFile(source, path.join(destinationFolder, path.basename(source)));
  }));
  return backupPath;
}

export async function finalizeRecordingMedia(folderPath: string): Promise<RecordingFinalizeResult> {
  const safeFolder = assertRecordingFolder(folderPath);
  await logger.info("RecordingService", "Finalization started.", { folderPath: safeFolder });
  await captureManifestQueues.get(safeFolder)?.catch(() => undefined);
  const manifest = await readJsonFile<CaptureManifest>(captureManifestPath(safeFolder));
  const session = await readJsonFile<RecordingSession>(path.join(safeFolder, "Session", "recording-session.json"));
  if (!manifest || !session) throw new Error("Recording recovery information is missing.");
  const sources = Object.values(manifest.sources).filter((source): source is CaptureManifestSource => Boolean(source));
  const programSource = sources.find((source) => source.target === "program");
  const trackSources = sources.filter((source) => source.target !== "program");
  const [{ programPath, playable: programPlayable }, tracks] = await Promise.all([
    finalizeProgramSource(safeFolder, programSource),
    Promise.all(trackSources.map((source) => finalizeTrackSource(safeFolder, source)))
  ]);
  await logger.info("RecordingService", "Program and isolated sources finalized.", {
    programPlayable,
    expectedSources: trackSources.length,
    savedSources: tracks.filter((track) => track.status === "saved").length,
    tracks: tracks.map((track) => ({ slot: track.slot, kind: track.kind, status: track.status, message: track.message }))
  });
  const savedTracks = tracks.filter((track) => track.status === "saved");
  let backupPath: string | undefined;
  const warnings = tracks.filter((track) => track.status !== "saved").map((track) => `${track.slot}: ${track.message}`);
  if (!programPlayable) warnings.unshift("Program recording needs attention; partial source files were preserved.");
  try {
    backupPath = await copyFinalizedRecordingToBackup(session, programPath, tracks);
  } catch (error) {
    warnings.push(`Secondary backup failed: ${String(error)}`);
    await appendRecordingError(safeFolder, warnings.at(-1) ?? "Secondary backup failed.");
  }
  const integrity = {
    checkedAt: new Date().toISOString(),
    playable: programPlayable && savedTracks.length === trackSources.length,
    programPlayable,
    savedSourceCount: savedTracks.length,
    expectedSourceCount: trackSources.length,
    warnings,
    backupPath
  };
  const syncMetadataPath = path.join(safeFolder, "Session", "sync-metadata.json");
  const syncMetadata = (await readJsonFile<SyncMetadata>(syncMetadataPath)) ?? createSyncMetadata({ cameras: {}, microphones: {} });
  const savedMediaFiles = { ...syncMetadata.savedMediaFiles, ...(programPath && programPlayable ? { program: programPath } : {}) };
  const trackStates = { ...syncMetadata.trackStates };
  const deviceStartTimestamps = { ...syncMetadata.deviceStartTimestamps };
  for (const source of sources) deviceStartTimestamps[`recording:${source.target}`] = source.firstChunkAt ?? source.lastChunkAt;
  for (const result of tracks) {
    trackStates[result.slot] = result;
    if (result.status === "saved" && result.filePath) savedMediaFiles[result.slot] = result.filePath;
  }
  await Promise.all([
    writeJson(syncMetadataPath, {
      ...syncMetadata,
      deviceStartTimestamps,
      savedMediaFiles,
      trackStates,
      validation: { programPlayable, validatedAt: integrity.checkedAt }
    }),
    writeJson(path.join(safeFolder, "Session", "recording-integrity.json"), integrity)
  ]);
  await logger.info("RecordingService", "Finalized disk-first recording media.", { sessionId: session.id, programPlayable, savedSources: savedTracks.length, backupPath });
  return { programPath: programPlayable ? programPath : undefined, tracks, integrity };
}

export async function recoverRecordingSession(folderPath: string) {
  const result = await finalizeRecordingMedia(folderPath);
  const statePath = path.join(assertRecordingFolder(folderPath), "Session", "recording-state.json");
  const state = await readJsonFile<RecordingState>(statePath);
  if (state) await writeRecordingState(folderPath, { ...state, status: result.integrity.programPlayable ? "stopped" : "interrupted" });
  return result;
}

async function ensureRecordingMetadata(folderPath: string, metadata: EpisodeMetadata) {
  const metadataPath = path.join(folderPath, "metadata.json");
  try {
    await fs.access(metadataPath);
  } catch {
    await writeJson(metadataPath, metadata);
  }
}

export async function writeRecordingState(folderPath: string, state: RecordingState) {
  const nextState = {
    ...state,
    updatedAt: new Date().toISOString(),
    lastSavedAt: new Date().toISOString()
  };
  await writeJson(path.join(folderPath, "Session", "recording-state.json"), nextState);
  await syncRecordingSessionStatus(folderPath, nextState);
  return nextState;
}

async function syncRecordingSessionStatus(folderPath: string, state: RecordingState) {
  const sessionPath = path.join(folderPath, "Session", "recording-session.json");
  const session = await readJsonFile<RecordingSession>(sessionPath);
  if (!session || session.status === state.status) return;

  const nextSession: RecordingSession = {
    ...session,
    status: state.status,
    stoppedAt: state.status === "stopped" ? state.updatedAt : session.stoppedAt
  };
  await writeJson(sessionPath, nextSession);
}

export async function saveProgramRecording(folderPath: string, bytes: Uint8Array) {
  const filePath = path.join(folderPath, "Program", "program.webm");
  await fs.writeFile(filePath, bytes);
  const programPlayable = await isPlayableRecording(filePath);
  if (!programPlayable) {
    await appendRecordingError(folderPath, "Program recording could not be validated.");
    throw new Error("Saved recording could not be validated.");
  }

  const syncMetadataPath = path.join(folderPath, "Session", "sync-metadata.json");
  const syncMetadata = (await readJsonFile<SyncMetadata>(syncMetadataPath)) ?? createSyncMetadata({ cameras: {}, microphones: {} });
  const nextSyncMetadata: SyncMetadata = {
    ...syncMetadata,
    savedMediaFiles: {
      ...syncMetadata.savedMediaFiles,
      program: filePath
    },
    validation: {
      programPlayable,
      validatedAt: new Date().toISOString()
    }
  };
  await writeJson(syncMetadataPath, nextSyncMetadata);
  await logger.info("RecordingService", "Saved and validated local program recording.", { filePath });
  return filePath;
}

export async function saveRecordedTracks(folderPath: string, tracks: RecordingTrackSaveInput[]) {
  const results: RecordingTrackSaveResult[] = [];

  for (const track of tracks) {
    results.push(await saveRecordedTrack(folderPath, track));
  }

  const syncMetadataPath = path.join(folderPath, "Session", "sync-metadata.json");
  const syncMetadata = (await readJsonFile<SyncMetadata>(syncMetadataPath)) ?? createSyncMetadata({ cameras: {}, microphones: {} });
  const savedMediaFiles = { ...syncMetadata.savedMediaFiles };
  const trackStates = { ...syncMetadata.trackStates };

  for (const result of results) {
    trackStates[result.slot] = result;
    if (result.status === "saved" && result.filePath) savedMediaFiles[result.slot] = result.filePath;
  }

  await writeJson(syncMetadataPath, {
    ...syncMetadata,
    savedMediaFiles,
    trackStates
  });

  return results;
}

async function saveRecordedTrack(folderPath: string, track: RecordingTrackSaveInput): Promise<RecordingTrackSaveResult> {
  if (!track.bytes?.length) {
    const status = track.status ?? "preview-only";
    return {
      slot: track.slot,
      kind: track.kind,
      status,
      message: track.message ?? defaultTrackMessage(status)
    };
  }

  try {
    const filePath = track.kind === "camera"
      ? await saveCameraTrack(folderPath, track.slot, track.bytes)
      : await saveAudioTrack(folderPath, track.slot, track.bytes, track.mimeType);

    if (track.kind === "audio" && !(await hasAudibleSignal(filePath))) {
      await appendRecordingError(folderPath, `${track.slot} was saved but contains no audible signal.`);
      return {
        slot: track.slot,
        kind: track.kind,
        status: "needs-attention",
        filePath,
        message: "Saved, but no audible signal was detected"
      };
    }

    return {
      slot: track.slot,
      kind: track.kind,
      status: "saved",
      filePath,
      message: "Saved"
    };
  } catch (error) {
    await appendRecordingError(folderPath, `${track.slot} could not be saved separately.`);
    await logger.warning("RecordingService", "Track could not be saved separately.", {
      slot: track.slot,
      kind: track.kind,
      error: String(error)
    });
    return {
      slot: track.slot,
      kind: track.kind,
      status: "needs-attention",
      message: "This device can preview but could not save separately"
    };
  }
}

async function saveCameraTrack(folderPath: string, slot: RecordingTrackSlot, bytes: Uint8Array) {
  const filePath = path.join(folderPath, "Cameras", `${slot.replace("camera", "camera-")}.webm`);
  await fs.writeFile(filePath, bytes);
  if (!(await isPlayableRecording(filePath))) throw new Error("Camera track failed ffprobe validation.");
  return filePath;
}

async function saveAudioTrack(folderPath: string, slot: RecordingTrackSlot, bytes: Uint8Array, mimeType?: string) {
  const fileName = slot === "morganMic" ? "morgan-mic" : slot === "guestMic" ? "guest-mic" : "extra-mic";
  const tempExtension = mimeType?.includes("mp4") || mimeType?.includes("m4a") ? "m4a" : "webm";
  const tempPath = path.join(folderPath, "Audio", `${fileName}.source.${tempExtension}`);
  const filePath = path.join(folderPath, "Audio", `${fileName}.m4a`);
  await fs.writeFile(tempPath, bytes);
  await runFfmpeg(["-y", "-i", tempPath, "-vn", "-c:a", "aac", "-b:a", "160k", filePath]);
  await fs.rm(tempPath, { force: true });
  if (!(await isPlayableRecording(filePath))) throw new Error("Audio track failed ffprobe validation.");
  return filePath;
}

function defaultTrackMessage(status: RecordingTrackSaveStatus) {
  if (status === "saved") return "Saved";
  if (status === "needs-attention") return "Needs Attention";
  return "Preview only";
}

async function isPlayableRecording(filePath: string) {
  try {
    return await validatePlayableMedia(filePath);
  } catch {
    return false;
  }
}

export async function appendRecordingError(folderPath: string, message: string) {
  const line = `${new Date().toISOString()} ${message}\n`;
  await fs.appendFile(path.join(folderPath, "Logs", "errors.log"), line, "utf8");
}

export async function listUnfinishedRecordingSessions() {
  const episodesRoot = getEpisodesRoot();

  try {
    const episodes = await fs.readdir(episodesRoot, { withFileTypes: true });
    const results: RecordingSession[] = [];

    for (const episode of episodes) {
      if (!episode.isDirectory()) continue;
      const folderPath = path.join(episodesRoot, episode.name);
      const sessionPath = path.join(folderPath, "Session", "recording-session.json");
      const statePath = path.join(folderPath, "Session", "recording-state.json");
      const session = await readJsonFile<RecordingSession>(sessionPath);
      const state = await readJsonFile<RecordingState>(statePath);

      if (session && state && isUnfinishedRecordingState(state)) {
        const manifest = await readJsonFile<CaptureManifest>(captureManifestPath(folderPath));
        const recoverableBytes = Object.values(manifest?.sources ?? {}).reduce((total, source) => total + (source?.bytesWritten ?? 0), 0);
        results.push({ ...session, status: "interrupted", recoverableBytes });
      }
    }

    return results;
  } catch {
    return [];
  }
}
