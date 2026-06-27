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
  requiredRecordingSessionFolders
} from "../shared/recording";
import { getEpisodesRoot } from "./config-service";
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
  await writeJson(path.join(folderPath, "Session", "device-map.json"), deviceMap);
  await writeJson(path.join(folderPath, "Session", "recording-state.json"), state);
  await writeJson(path.join(folderPath, "Session", "sync-metadata.json"), syncMetadata);
  await fs.writeFile(path.join(folderPath, "Logs", "errors.log"), "", "utf8");
  await logger.info("RecordingService", "Created local recording session.", { sessionId: session.id, episodeId });

  return session;
}

export async function writeRecordingState(folderPath: string, state: RecordingState) {
  const nextState = {
    ...state,
    updatedAt: new Date().toISOString(),
    lastSavedAt: new Date().toISOString()
  };
  await writeJson(path.join(folderPath, "Session", "recording-state.json"), nextState);
  return nextState;
}

export async function saveProgramRecording(folderPath: string, bytes: Uint8Array) {
  const filePath = path.join(folderPath, "Program", "program.webm");
  await fs.writeFile(filePath, bytes);
  await logger.info("RecordingService", "Saved local program recording.", { filePath });
  return filePath;
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
