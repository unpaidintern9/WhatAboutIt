import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import type {
  RecordingSession,
  RecordingSessionCreateInput,
  RecordingState
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
  const cameraFilePath = path.join(folderPath, "Cameras", "camera-1.webm");
  const audioFilePath = path.join(folderPath, "Audio", "morgan-mic.m4a");
  await fs.writeFile(filePath, bytes);
  const programPlayable = await isPlayableRecording(filePath);
  if (!programPlayable) {
    await appendRecordingError(folderPath, "Program recording could not be validated.");
    throw new Error("Saved recording could not be validated.");
  }

  await fs.copyFile(filePath, cameraFilePath);

  try {
    await runFfmpeg(["-y", "-i", filePath, "-vn", "-c:a", "aac", "-b:a", "160k", audioFilePath]);
  } catch (error) {
    await appendRecordingError(folderPath, "Mic needs attention");
    await logger.warning("RecordingService", "Could not extract recording audio track.", {
      filePath,
      error: String(error)
    });
  }

  const syncMetadataPath = path.join(folderPath, "Session", "sync-metadata.json");
  const syncMetadata = (await readJsonFile<SyncMetadata>(syncMetadataPath)) ?? createSyncMetadata({ cameras: {}, microphones: {} });
  const nextSyncMetadata: SyncMetadata = {
    ...syncMetadata,
    savedMediaFiles: {
      ...syncMetadata.savedMediaFiles,
      program: filePath,
      camera1: cameraFilePath,
      morganMic: await fileExists(audioFilePath) ? audioFilePath : syncMetadata.savedMediaFiles?.morganMic
    },
    validation: {
      programPlayable,
      validatedAt: new Date().toISOString()
    }
  };
  await writeJson(syncMetadataPath, nextSyncMetadata);
  await logger.info("RecordingService", "Saved and validated local program recording.", { filePath, cameraFilePath });
  return filePath;
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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
