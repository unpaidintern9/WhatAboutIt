import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTimelineDraft } from "../shared/timeline";

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

describe("auto edit store", () => {
  beforeEach(async () => {
    mockPaths.episodesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wai-auto-edit-"));
  });

  afterEach(async () => {
    await fs.rm(mockPaths.episodesRoot, { recursive: true, force: true });
  });

  it("writes AutoEditReport and draft timeline locally", async () => {
    const { runAutoEdit } = await import("./auto-edit-store");
    const result = await runAutoEdit({
      episodeId: "episode-a",
      mode: "balanced",
      draft: createTimelineDraft({ episodeId: "episode-a", deviceDefaults: { cameras: {}, microphones: {} } })
    });
    const folder = path.join(mockPaths.episodesRoot, "episode-a", "Session");

    expect(result.report.originalRecordingSafe).toBe(true);
    await expect(fs.stat(path.join(folder, "AutoEditReport.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(folder, "draft-timeline.json"))).resolves.toBeTruthy();
  });
});
