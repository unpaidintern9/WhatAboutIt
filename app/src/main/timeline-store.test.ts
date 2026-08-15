import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTimelineEdit, createTimelineDraft, selectTimelinePoint } from "../shared/timeline";

const mockPaths = vi.hoisted(() => ({
  episodesRoot: ""
}));

vi.mock("./config-service", () => ({
  getEpisodesRoot: () => mockPaths.episodesRoot
}));

vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

describe("timeline store", () => {
  beforeEach(async () => {
    mockPaths.episodesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wai-timeline-"));
  });

  afterEach(async () => {
    await fs.rm(mockPaths.episodesRoot, { recursive: true, force: true });
  });

  it("saves draft edits locally without changing originals", async () => {
    const { saveTimelineDraft, loadTimelineDraft } = await import("./timeline-store");
    const draft = applyTimelineEdit(
      selectTimelinePoint(
        createTimelineDraft({
          episodeId: "episode-a",
          deviceDefaults: { cameras: {}, microphones: {} }
        }),
        { timestampMs: 12000, source: "timeline" }
      ),
      "split"
    );

    const saved = await saveTimelineDraft("episode-a", draft);
    const loaded = await loadTimelineDraft("episode-a");

    expect(saved.nonDestructive).toBe(true);
    expect(saved.hasUnsavedChanges).toBe(false);
    expect(loaded?.editLog[0].label).toBe("Split here");
    await expect(fs.stat(path.join(mockPaths.episodesRoot, "episode-a", "Session", "draft-timeline.json"))).resolves.toBeTruthy();
  });

  it("recovers the previous good draft when the primary save is damaged", async () => {
    const { saveTimelineDraft, loadTimelineDraft } = await import("./timeline-store");
    const first = createTimelineDraft({
      episodeId: "episode-a",
      deviceDefaults: { cameras: {}, microphones: {} },
      durationMs: 10000
    });
    const second = { ...first, durationMs: 20000, version: first.version + 1 };
    const filePath = path.join(mockPaths.episodesRoot, "episode-a", "Session", "draft-timeline.json");

    await saveTimelineDraft("episode-a", first);
    await saveTimelineDraft("episode-a", second);
    await fs.writeFile(filePath, "{damaged", "utf8");

    await expect(loadTimelineDraft("episode-a")).resolves.toMatchObject({
      episodeId: "episode-a",
      durationMs: 10000
    });
  });

  it("refuses to cross-save a draft into another episode", async () => {
    const { saveTimelineDraft } = await import("./timeline-store");
    const draft = createTimelineDraft({
      episodeId: "episode-a",
      deviceDefaults: { cameras: {}, microphones: {} }
    });

    await expect(saveTimelineDraft("episode-b", draft)).rejects.toThrow("Refusing to save draft for episode-a into episode episode-b");
  });

  it("keeps undo history in memory without persisting large snapshots", async () => {
    const { saveTimelineDraft, loadTimelineDraft } = await import("./timeline-store");
    const draft = applyTimelineEdit(
      selectTimelinePoint(createTimelineDraft({
        episodeId: "episode-history",
        deviceDefaults: { cameras: {}, microphones: {} },
        durationMs: 30000
      }), { timestampMs: 5000, source: "timeline" }),
      "split"
    );

    const saved = await saveTimelineDraft("episode-history", draft);
    const loaded = await loadTimelineDraft("episode-history");

    expect(saved.history).toHaveLength(1);
    expect(loaded?.history).toEqual([]);
    expect(loaded?.redoHistory).toEqual([]);
    expect(loaded?.editLog).toHaveLength(1);
  });
});
