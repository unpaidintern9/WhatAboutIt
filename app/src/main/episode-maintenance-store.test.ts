import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPaths = vi.hoisted(() => ({ episodesRoot: "" }));

vi.mock("./config-service", () => ({
  getEpisodesRoot: () => mockPaths.episodesRoot
}));

describe("episode maintenance store", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockPaths.episodesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wai-episode-storage-"));
  });

  afterEach(async () => {
    await fs.rm(mockPaths.episodesRoot, { recursive: true, force: true });
  });

  it("measures episode storage and only removes the selected disposable files", async () => {
    const { cleanupEpisodeStorage, getEpisodeStorageSummary } = await import("./episode-maintenance-store");
    const episodeId = "episode-storage";
    const folder = path.join(mockPaths.episodesRoot, episodeId);
    const files = {
      original: path.join(folder, "Originals", "camera.mp4"),
      program: path.join(folder, "Program", "program.webm"),
      editing: path.join(folder, "Cameras", "camera-1.webm"),
      review: path.join(folder, "Session", "Review", "camera-1-review.webm"),
      backup: path.join(folder, "Backup", "Imported Media", "camera-1-old.webm"),
      export: path.join(folder, "Exports", "episode.mp4")
    };
    await Promise.all(Object.values(files).map((filePath) => fs.mkdir(path.dirname(filePath), { recursive: true })));
    await Promise.all(Object.entries(files).map(([name, filePath]) => fs.writeFile(filePath, name)));

    const summary = await getEpisodeStorageSummary(episodeId);
    expect(summary.buckets).toHaveLength(5);
    expect(summary.buckets.find((bucket) => bucket.id === "originals")).toMatchObject({ fileCount: 2, rebuildable: false });
    expect(summary.buckets.find((bucket) => bucket.id === "review-cache")).toMatchObject({ fileCount: 1, rebuildable: true });
    expect(summary.buckets.find((bucket) => bucket.id === "exports")).toMatchObject({ fileCount: 1, rebuildable: false });
    expect(summary.totalBytes).toBe(Object.keys(files).reduce((total, name) => total + name.length, 0));

    const afterReviewCleanup = await cleanupEpisodeStorage(episodeId, "review-cache");
    expect(afterReviewCleanup.buckets.find((bucket) => bucket.id === "review-cache")?.fileCount).toBe(0);
    await expect(fs.readFile(files.original, "utf8")).resolves.toBe("original");
    await expect(fs.readFile(files.export, "utf8")).resolves.toBe("export");

    const afterExportCleanup = await cleanupEpisodeStorage(episodeId, "exports");
    expect(afterExportCleanup.buckets.find((bucket) => bucket.id === "exports")?.fileCount).toBe(0);
    await expect(fs.readFile(files.editing, "utf8")).resolves.toBe("editing");
    await expect(fs.readFile(files.backup, "utf8")).resolves.toBe("backup");
  });

  it("rejects paths and cleanup options outside the episode allowlist", async () => {
    const { cleanupEpisodeStorage, getEpisodeStorageSummary } = await import("./episode-maintenance-store");

    await expect(getEpisodeStorageSummary("../outside")).rejects.toThrow("invalid");
    await expect(cleanupEpisodeStorage("episode-a", "everything" as "exports")).rejects.toThrow("not supported");
  });
});
