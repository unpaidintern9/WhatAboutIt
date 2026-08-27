import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CollaborationAssetManifestEntry } from "../shared/collaboration";
import { prepareCollaborationUploadSources } from "./collaboration-upload-snapshot";

describe("collaboration upload snapshots", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("freezes mutable project bytes while leaving finalized originals zero-copy", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "wai-upload-snapshot-"));
    const episodeFolder = path.join(root, "episode");
    const snapshotFolder = path.join(root, "snapshots");
    await fs.mkdir(path.join(episodeFolder, "Collaboration"), { recursive: true });
    await fs.mkdir(path.join(episodeFolder, "Program"), { recursive: true });
    const workspacePath = path.join(episodeFolder, "Collaboration", "workspace.json");
    const originalPath = path.join(episodeFolder, "Program", "program.webm");
    await fs.writeFile(workspacePath, "before");
    await fs.writeFile(originalPath, "media");
    const base = { localOriginal: false, state: "local-only", updatedAt: "2026-08-27T00:00:00.000Z" } as const;
    const assets: CollaborationAssetManifestEntry[] = [
      { ...base, id: "workspace", kind: "comments", relativePath: "Collaboration/workspace.json", contentHash: "stale", bytes: 1 },
      { ...base, id: "program", kind: "original-video", relativePath: "Program/program.webm", localOriginal: true, contentHash: "media-hash", bytes: 5 }
    ];

    const [workspace, original] = await prepareCollaborationUploadSources(episodeFolder, assets, snapshotFolder);
    await fs.writeFile(workspacePath, "after-change");

    expect(await fs.readFile(workspace.absolutePath, "utf8")).toBe("before");
    expect(workspace.asset.bytes).toBe(6);
    expect(workspace.asset.contentHash).toHaveLength(64);
    expect(original.absolutePath).toBe(originalPath);
  });
});
