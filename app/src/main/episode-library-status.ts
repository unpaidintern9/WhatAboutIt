import fs from "node:fs/promises";
import path from "node:path";
import type { EpisodeMetadata } from "../shared/types";

async function readObject(file: string): Promise<Record<string, unknown> | undefined> {
  try { return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>; } catch { return undefined; }
}

/** Derive library badges from durable journals; never rewrite episode/project metadata. */
export async function withEpisodeLibraryStatus(episode: EpisodeMetadata): Promise<EpisodeMetadata> {
  const [state, session] = await Promise.all([
    readObject(path.join(episode.folderPath, "Session", "recording-state.json")),
    readObject(path.join(episode.folderPath, "Session", "recording-session.json"))
  ]);
  const paused = state?.status === "paused" && session?.durablePaused === true;
  let status = state?.status === "stopped" ? "recorded" as const : episode.status;
  let activityAt = typeof state?.updatedAt === "string" ? state.updatedAt : episode.updatedAt;
  const durationMs = typeof state?.elapsedMs === "number" && Number.isFinite(state.elapsedMs) ? Math.max(0, state.elapsedMs) : undefined;
  try {
    const exportsRoot = path.join(episode.folderPath, "Exports");
    const entries = (await fs.readdir(exportsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => b.name.localeCompare(a.name));
    for (const entry of entries) {
      const job = await readObject(path.join(exportsRoot, entry.name, "export-job.json"));
      if (job?.status !== "complete" || job.practice === true) continue;
      status = "exported";
      if (typeof job.completedAt === "string" && job.completedAt > activityAt) activityAt = job.completedAt;
      break;
    }
  } catch { /* A new episode has no Exports folder yet. */ }
  return { ...episode, status, resumeAvailable: paused || (state?.status === "stopped" && Boolean(session?.captureFolderPath)), durationMs, updatedAt: activityAt > episode.updatedAt ? activityAt : episode.updatedAt };
}
