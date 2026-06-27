import path from "node:path";
import fs from "node:fs/promises";
import type { TimelineDraft } from "../shared/timeline";
import { getEpisodesRoot } from "./config-service";
import { logger } from "./logger";

function timelinePath(episodeId: string) {
  return path.join(getEpisodesRoot(), episodeId, "Session", "draft-timeline.json");
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function loadTimelineDraft(episodeId: string): Promise<TimelineDraft | null> {
  return readJsonFile<TimelineDraft>(timelinePath(episodeId));
}

export async function saveTimelineDraft(episodeId: string, draft: TimelineDraft): Promise<TimelineDraft> {
  const filePath = timelinePath(episodeId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const nextDraft = { ...draft, episodeId, updatedAt: new Date().toISOString(), nonDestructive: true as const };
  await fs.writeFile(filePath, JSON.stringify(nextDraft, null, 2), "utf8");
  await logger.info("TimelineReview", "Saved local draft timeline.", { episodeId });
  return nextDraft;
}

