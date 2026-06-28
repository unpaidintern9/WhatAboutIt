import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import type {
  RecordingSession,
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
    practice: Boolean(input.practice)
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
        results.push({ ...session, status: "interrupted" });
      }
    }

    return results;
  } catch {
    return [];
  }
}
