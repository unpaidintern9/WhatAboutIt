import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTimelineDraft } from "../shared/timeline";

const mockPaths = vi.hoisted(() => ({
  episodesRoot: ""
}));

vi.mock("electron", () => ({
  shell: {
    openPath: vi.fn(async () => "")
  }
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

describe("export store", () => {
  beforeEach(async () => {
    mockPaths.episodesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wai-export-"));
  });

  afterEach(async () => {
    await fs.rm(mockPaths.episodesRoot, { recursive: true, force: true });
  });

  it("creates export folder and summary artifacts for practice export", async () => {
    const { createExport } = await import("./export-store");
    const job = await createExport({
      episodeId: "episode-a",
      type: "full-episode-video",
      qualityPreset: "standard",
      practice: true,
      draft: createTimelineDraft({ episodeId: "episode-a", deviceDefaults: { cameras: {}, microphones: {} } })
    });
    const folder = path.join(mockPaths.episodesRoot, "episode-a", "Exports");
    const summary = JSON.parse(await fs.readFile(path.join(folder, "export-summary.json"), "utf8")) as { originalRecordingSafe: boolean };

    expect(job.status).toBe("complete");
    expect(await fs.readFile(path.join(folder, "export-job.json"), "utf8")).toContain("Export complete");
    expect(await fs.readFile(path.join(folder, "export-log.txt"), "utf8")).toContain("Your original recording stays safe");
    expect(summary.originalRecordingSafe).toBe(true);
  });

  it("returns a friendly missing recording state when real media is unavailable", async () => {
    const { createExport } = await import("./export-store");
    const job = await createExport({
      episodeId: "episode-b",
      type: "audio-only",
      qualityPreset: "standard",
      draft: createTimelineDraft({ episodeId: "episode-b", deviceDefaults: { cameras: {}, microphones: {} } })
    });

    expect(job.status).toBe("error");
    expect(job.message).toBe("We couldn't find the recording file");
  });
});
