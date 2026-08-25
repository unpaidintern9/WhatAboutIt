import path from "node:path";
import fs from "node:fs/promises";
import type { TimelineDraft } from "../shared/timeline";
import { compactTimelineDraftForPersistence, markTimelineSaved } from "../shared/timeline";
import { getEpisodesRoot } from "./config-service";
import { acquireCollaborationEditorLease, getCollaborationRemoteConfig, sendCollaborationPresence } from "./collaboration-remote-service";
import { assertProjectRevisionCurrent, pullLatestProjectChanges, pushProjectChanges } from "./collaboration-project-sync";
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
  try {
    const pulled = await pullLatestProjectChanges(episodeId);
    if (pulled.changed > 0) {
      await logger.info("TimelineReview", "Applied newer collaborative project files before opening Review.", {
        episodeId,
        changedFiles: pulled.changed
      });
    }
  } catch (error) {
    await logger.warning("TimelineReview", "Could not refresh collaborative project files before opening Review.", {
      episodeId,
      error: String(error)
    });
  }

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
    await assertProjectRevisionCurrent(episodeId);
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

  if (remoteConfig.apiUrl) {
    try {
      await pushProjectChanges(episodeId);
    } catch (error) {
      await logger.warning("TimelineReview", "Timeline is safe locally but automatic cloud project sync failed.", {
        episodeId,
        error: String(error)
      });
      throw new Error("Your edit was saved safely on this computer, but Cloudflare sync did not finish. Retry Save before handing the episode to the other editor.", { cause: error });
    }
  }

  await logger.info("TimelineReview", "Saved local draft timeline.", {
    episodeId,
    collaborationEditor: collaboration?.self.displayName,
    automaticCloudSync: Boolean(remoteConfig.apiUrl)
  });
  return nextDraft;
}
