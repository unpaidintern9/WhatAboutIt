import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getEpisodesRoot } from "./config-service";
import { durableJson } from "./durable-file";

const queues = new Map<string, Promise<unknown>>();
export function withLocalProjectSave<T>(episodeId: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(episodeId) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(operation);
  queues.set(episodeId, task);
  void task.finally(() => { if (queues.get(episodeId) === task) queues.delete(episodeId); }).catch(() => undefined);
  return task;
}
function pendingPath(episodeId: string) {
  if (!episodeId || path.basename(episodeId) !== episodeId || episodeId === "." || episodeId === "..") throw new Error("Invalid episode identifier.");
  // Local coordination only: hidden files never enter cloud asset manifests.
  return path.join(getEpisodesRoot(), episodeId, "Session", ".local-save-pending.json");
}
export async function readPendingProjectSave(episodeId: string): Promise<string | undefined> {
  try { return (JSON.parse(await fs.readFile(pendingPath(episodeId), "utf8")) as { token: string }).token; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
/** Called inside withLocalProjectSave, before replacing the local draft. */
export async function markProjectSavePending(episodeId: string) {
  await durableJson(pendingPath(episodeId), { token: randomUUID() });
}
export async function clearPendingProjectSave(episodeId: string, token: string) {
  await withLocalProjectSave(episodeId, async () => {
    if (await readPendingProjectSave(episodeId) === token) await fs.rm(pendingPath(episodeId), { force: true });
  });
}
