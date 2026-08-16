import fs from "node:fs/promises";
import path from "node:path";
import type { EpisodeCleanupScope, EpisodeStorageBucket, EpisodeStorageSummary } from "../shared/episode-maintenance";
import { getEpisodesRoot } from "./config-service";

async function measurePath(filePath: string): Promise<{ sizeBytes: number; fileCount: number }> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.isFile()) return { sizeBytes: stat.size, fileCount: 1 };
    const entries = await fs.readdir(filePath, { withFileTypes: true });
    const children = await Promise.all(entries.map((entry) => measurePath(path.join(filePath, entry.name))));
    return children.reduce((total, child) => ({ sizeBytes: total.sizeBytes + child.sizeBytes, fileCount: total.fileCount + child.fileCount }), { sizeBytes: 0, fileCount: 0 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { sizeBytes: 0, fileCount: 0 };
    throw error;
  }
}

function getEpisodeFolder(episodeId: string) {
  const root = path.resolve(getEpisodesRoot());
  const folder = path.resolve(root, episodeId);
  if (!episodeId || folder === root || !folder.startsWith(`${root}${path.sep}`)) throw new Error("The episode storage path is invalid.");
  return folder;
}

export async function getEpisodeStorageSummary(episodeId: string): Promise<EpisodeStorageSummary> {
  const folder = getEpisodeFolder(episodeId);
  const definitions: Array<{ id: EpisodeStorageBucket["id"]; label: string; paths: string[]; rebuildable: boolean }> = [
    { id: "originals", label: "Protected originals", paths: ["Originals", "Program"], rebuildable: false },
    { id: "editing-media", label: "Editing media", paths: ["Cameras", "Audio"], rebuildable: false },
    { id: "review-cache", label: "Review cache", paths: [path.join("Session", "Review")], rebuildable: true },
    { id: "backups", label: "Imported-media backups", paths: [path.join("Backup", "Imported Media")], rebuildable: false },
    { id: "exports", label: "Finished exports", paths: ["Exports"], rebuildable: false }
  ];
  const buckets = await Promise.all(definitions.map(async (definition) => {
    const values = await Promise.all(definition.paths.map((relativePath) => measurePath(path.join(folder, relativePath))));
    return {
      id: definition.id,
      label: definition.label,
      rebuildable: definition.rebuildable,
      sizeBytes: values.reduce((total, value) => total + value.sizeBytes, 0),
      fileCount: values.reduce((total, value) => total + value.fileCount, 0)
    };
  }));
  return { episodeId, buckets, totalBytes: buckets.reduce((total, bucket) => total + bucket.sizeBytes, 0) };
}

export async function cleanupEpisodeStorage(episodeId: string, scope: EpisodeCleanupScope) {
  if (scope !== "review-cache" && scope !== "exports") throw new Error("That episode cleanup option is not supported.");
  const folder = getEpisodeFolder(episodeId);
  const target = scope === "review-cache" ? path.join(folder, "Session", "Review") : path.join(folder, "Exports");
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });
  return getEpisodeStorageSummary(episodeId);
}
