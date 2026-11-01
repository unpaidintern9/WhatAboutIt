import fs from "node:fs/promises";
import path from "node:path";
import { getEpisodesRoot } from "./config-service";
import type { EpisodeMetadata } from "../shared/types";

export async function deleteLocalEpisode(episodeId: string, options: {
  isBusy: () => boolean;
  confirm: (episode: EpisodeMetadata) => Promise<boolean>;
  beforeDelete: (folder: string) => Promise<void>;
}): Promise<boolean> {
  if (typeof episodeId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(episodeId)) throw new Error("The episode ID is invalid.");
  const root = await fs.realpath(getEpisodesRoot());
  const folder = path.join(root, episodeId);
  const stat = await fs.lstat(folder);
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(await fs.realpath(folder)) !== root) throw new Error("Only a local episode folder can be deleted.");
  const episode = JSON.parse(await fs.readFile(path.join(folder, "metadata.json"), "utf8")) as EpisodeMetadata;
  if (episode.id !== episodeId) throw new Error("The episode folder does not match its metadata.");
  const assertIdle = () => {
    if (options.isBusy()) throw new Error("Finish recording, saving, syncing, exporting, importing, or transcription before deleting an episode.");
  };
  assertIdle();
  if (!await options.confirm({ ...episode, folderPath: folder })) return false;
  assertIdle();
  await options.beforeDelete(folder);
  assertIdle();
  await fs.rm(folder, { recursive: true });
  return true;
}
