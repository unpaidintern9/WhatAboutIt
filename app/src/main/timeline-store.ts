import path from "node:path";
import fs from "node:fs/promises";
import type { TimelineDraft } from "../shared/timeline";
import { compactTimelineDraftForPersistence, markTimelineSaved } from "../shared/timeline";
import { getEpisodesRoot } from "./config-service";
import { acquireCollaborationEditorLease, getCollaborationRemoteConfig, sendCollaborationPresence } from "./collaboration-remote-service";
import { logger } from "./logger";

function timelinePath(episodeId: string) {
  if (!episodeId || path.basename(episodeId) !== episodeId || episodeId === "." || episodeId === "..") {
    throw new Error("Invalid episode identifier for timeline storage.");
  }
  return path.join(getEpisodesRoot(), episodeId, "Session", "draft-timeline.json");
}

function backupPath(filePath: string) {
  return `${filePath}.backup`;
}

function isMissingFile(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function syncDirectory(directory: string) {
  try {
    const handle = await fs.open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Windows may not permit syncing a directory handle; the file itself is still synced.
  }
}

export async function loadTimelineDraft(episodeId: string): Promise<TimelineDraft | null> {
  void sendCollaborationPresence(episodeId, "viewing").catch(() => undefined);
  const filePath = timelinePath(episodeId);
  try {
    return await readJsonFile<TimelineDraft>(filePath);
  } catch (primaryError) {
    const backupFilePath = backupPath(filePath);
    try {
      const recovered = await readJsonFile<TimelineDraft>(backupFilePath);
      await logger.warning("TimelineReview", "Recovered draft timeline from the previous good save.", { episodeId });
      return recovered;
    } catch (backupError) {
      if (isMissingFile(primaryError) && isMissingFile(backupError)) return null;
      await logger.error("TimelineReview", "Draft timeline could not be read from the primary or backup file.", {
        episodeId,
        primaryError: String(primaryError),
        backupError: String(backupError)
      });
      throw new Error("This episode's saved draft is damaged and could not be recovered automatically.", { cause: backupError });
    }
  }
}

export async function saveTimelineDraft(episodeId: string, draft: TimelineDraft): Promise<TimelineDraft> {
  if (draft.episodeId && draft.episodeId !== episodeId) {
    throw new Error(`Refusing to save draft for ${draft.episodeId} into episode ${episodeId}.`);
  }

  const remoteConfig = await getCollaborationRemoteConfig();
  let collaboration;
  if (remoteConfig.apiUrl) {
    try {
      collaboration = await acquireCollaborationEditorLease(episodeId);
    } catch (error) {
      throw new Error("Cloud collaboration is configured but edit ownership could not be verified. Your local changes are still open, but the shared timeline was not overwritten.", { cause: error });
    }
    if (!collaboration.connected) {
      throw new Error("Cloud collaboration is temporarily unavailable. Your local changes are still open, but the shared timeline was not overwritten.");
    }
    if (collaboration.activeEditor && collaboration.activeEditor.memberId !== collaboration.self.memberId) {
      throw new Error(`${collaboration.activeEditor.displayName} is editing this episode right now. Your local changes were not written over their timeline.`);
    }
  }

  const filePath = timelinePath(episodeId);
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(directory, { recursive: true });
  const nextDraft = markTimelineSaved({
    ...draft,
    episodeId,
    nonDestructive: true as const
  });
  const persistedDraft = compactTimelineDraftForPersistence(nextDraft);
  let temporaryHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    temporaryHandle = await fs.open(temporaryPath, "wx");
    await temporaryHandle.writeFile(JSON.stringify(persistedDraft, null, 2), "utf8");
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = undefined;
    try {
      await fs.copyFile(filePath, backupPath(filePath));
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    await fs.rename(temporaryPath, filePath);
    await syncDirectory(directory);
  } finally {
    await temporaryHandle?.close().catch(() => undefined);
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  await logger.info("TimelineReview", "Saved local draft timeline.", {
    episodeId,
    collaborationEditor: collaboration?.self.displayName
  });
  return nextDraft;
}
