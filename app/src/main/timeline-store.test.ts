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
        createTimelineDraft({ episodeId: "episode-a", deviceDefaults: { cameras: {}, microphones: {} } }),
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
});
