import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildEpisodeAssetManifest } from "./collaboration-asset-index";

describe("collaboration asset index", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("never uploads local sync and download-completion markers", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "wai-asset-index-"));
    await fs.mkdir(path.join(root, "Collaboration"), { recursive: true });
    await fs.mkdir(path.join(root, "Session"), { recursive: true });
    await fs.writeFile(path.join(root, "metadata.json"), "{}");
    await fs.writeFile(path.join(root, "Collaboration", "workspace.json"), "{}");
    await fs.writeFile(path.join(root, "Collaboration", "project-sync.json"), "{}");
    await fs.writeFile(path.join(root, "Session", "cloud-download-complete.json"), "{}");

    const manifest = await buildEpisodeAssetManifest(root, "episode-a");
    const paths = manifest.map((asset) => asset.relativePath);

    expect(paths).toContain("metadata.json");
    expect(paths).toContain("Collaboration/workspace.json");
    expect(paths).not.toContain("Collaboration/project-sync.json");
    expect(paths).not.toContain("Session/cloud-download-complete.json");
  });

  it("does not hash large media when preparing a project-only sync", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "wai-project-only-index-"));
    await fs.mkdir(path.join(root, "Cameras"), { recursive: true });
    await fs.mkdir(path.join(root, "Session"), { recursive: true });
    await fs.writeFile(path.join(root, "metadata.json"), "{}");
    await fs.writeFile(path.join(root, "Session", "draft-timeline.json"), "{}");
    await fs.writeFile(path.join(root, "Cameras", "camera-1.webm"), Buffer.alloc(1024));

    const manifest = await buildEpisodeAssetManifest(root, "episode-a", "project-only");

    expect(manifest.map((asset) => asset.relativePath)).toEqual(["metadata.json", "Session/draft-timeline.json"]);
  });
});
