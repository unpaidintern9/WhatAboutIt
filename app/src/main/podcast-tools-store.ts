import path from "node:path";
import fs from "node:fs/promises";
import type { PodcastToolsState } from "../shared/podcast-tools";
import { withPodcastToolDefaults } from "../shared/podcast-tools";
import { getEpisodesRoot } from "./config-service";
import { logger } from "./logger";

function podcastToolsPath(episodeId: string) {
  return path.join(getEpisodesRoot(), episodeId, "Session", "podcast-tools.json");
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function loadPodcastTools(episodeId: string): Promise<PodcastToolsState> {
  const filePath = podcastToolsPath(episodeId);
  const saved = await readJsonFile<PodcastToolsState>(filePath);
  return withPodcastToolDefaults(saved, episodeId);
}

export async function savePodcastTools(episodeId: string, state: PodcastToolsState): Promise<PodcastToolsState> {
  const filePath = podcastToolsPath(episodeId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const nextState = withPodcastToolDefaults(
    {
      ...state,
      episodeId,
      updatedAt: new Date().toISOString()
    },
    episodeId
  );
  await fs.writeFile(filePath, JSON.stringify(nextState, null, 2), "utf8");
  await logger.info("PodcastTools", "Saved local podcast tools state.", { episodeId });
  return nextState;
}

