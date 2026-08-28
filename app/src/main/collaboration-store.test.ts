import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCollaborationWorkspace, prepareCollaborationUpload, recordCollaborationDownloadComplete, recordCollaborationUploadComplete } from "./collaboration-store";

describe("collaboration sync history", () => {
  let episodeFolder: string | undefined;

  afterEach(async () => {
    if (episodeFolder) await fs.rm(episodeFolder, { recursive: true, force: true });
  });

  it("keeps upload and download activity scoped to the episode workspace", async () => {
    episodeFolder = await fs.mkdtemp(path.join(os.tmpdir(), "wai-sync-history-"));
    await fs.writeFile(path.join(episodeFolder, "metadata.json"), "{}");
    const plan = await prepareCollaborationUpload(episodeFolder, "episode-a", "Episode A", "full-backup");
    await recordCollaborationUploadComplete(episodeFolder, "episode-a", "Episode A", plan.assets.map((asset) => asset.id));
    await recordCollaborationDownloadComplete(episodeFolder, "episode-a", "Episode A", plan.assets);

    const workspace = await loadCollaborationWorkspace(episodeFolder, "episode-a", "Episode A");
    expect(workspace.syncHistory).toHaveLength(2);
    expect(workspace.syncHistory?.map((entry) => entry.direction)).toEqual(["download", "upload"]);
    expect(workspace.syncHistory?.every((entry) => entry.status === "complete")).toBe(true);
  });
});
