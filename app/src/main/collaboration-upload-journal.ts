import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type { MultipartUploadCheckpoint } from "./collaboration-asset-upload";

type UploadJournal = {
  version: 1;
  episodeId: string;
  assets: Record<string, MultipartUploadCheckpoint>;
};

const updateQueues = new Map<string, Promise<void>>();

function journalPath(episodeId: string) {
  const safeEpisodeId = episodeId.replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(app.getPath("userData"), "collaboration-uploads", `${safeEpisodeId}.json`);
}

async function readJournal(episodeId: string): Promise<UploadJournal> {
  try {
    const parsed = JSON.parse(await fs.readFile(journalPath(episodeId), "utf8")) as UploadJournal;
    if (parsed.version !== 1 || parsed.episodeId !== episodeId || !parsed.assets) throw new Error("Invalid upload journal.");
    return parsed;
  } catch {
    return { version: 1, episodeId, assets: {} };
  }
}

async function writeJournal(journal: UploadJournal) {
  const destination = journalPath(journal.episodeId);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(journal, null, 2), "utf8");
  await fs.rename(temporary, destination);
}

export async function getUploadCheckpoint(episodeId: string, relativePath: string) {
  return (await readJournal(episodeId)).assets[relativePath];
}

export async function setUploadCheckpoint(episodeId: string, relativePath: string, checkpoint: MultipartUploadCheckpoint | undefined) {
  const previous = updateQueues.get(episodeId) ?? Promise.resolve();
  const next = previous.then(async () => {
    const journal = await readJournal(episodeId);
    if (checkpoint) journal.assets[relativePath] = checkpoint;
    else delete journal.assets[relativePath];
    if (Object.keys(journal.assets).length === 0) {
      await fs.rm(journalPath(episodeId), { force: true });
      return;
    }
    await writeJournal(journal);
  });
  updateQueues.set(episodeId, next.catch(() => undefined));
  await next;
}
