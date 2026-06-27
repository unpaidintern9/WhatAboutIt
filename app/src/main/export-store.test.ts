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
    vi.resetModules();
    delete process.env.WHAT_ABOUT_IT_DISABLE_BUNDLED_MEDIA_TOOLS;
    delete process.env.WHAT_ABOUT_IT_FFMPEG_PATH;
    delete process.env.WHAT_ABOUT_IT_FFPROBE_PATH;
    mockPaths.episodesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wai-export-"));
  });

  afterEach(async () => {
    await fs.rm(mockPaths.episodesRoot, { recursive: true, force: true });
  });

  it("detects bundled FFmpeg media tools", async () => {
    const { detectMediaTools } = await import("./ffmpeg-tools");
    const status = await detectMediaTools();

    expect(status.ready).toBe(true);
    expect(status.message).toBe("Media tools are ready");
    expect(status.ffmpegPath).toMatch(/ffmpeg/i);
    expect(status.ffprobePath).toMatch(/ffprobe/i);
  });

  it("creates a real playable export and summary artifacts for practice export", async () => {
    const { createExport } = await import("./export-store");
    const { validatePlayableMedia } = await import("./ffmpeg-tools");
    const job = await createExport({
      episodeId: "episode-a",
      type: "full-episode-video",
      qualityPreset: "standard",
      practice: true,
      draft: createTimelineDraft({ episodeId: "episode-a", deviceDefaults: { cameras: {}, microphones: {} } })
    });
    const folder = path.join(mockPaths.episodesRoot, "episode-a", "Exports");
    const summary = JSON.parse(await fs.readFile(path.join(folder, "export-summary.json"), "utf8")) as { originalRecordingSafe: boolean };
    const outputPath = path.join(folder, job.outputFileName ?? "");

    expect(job.status).toBe("complete");
    expect(job.outputFileName).toBe("what-about-it-full-episode-video.mp4");
    expect(await validatePlayableMedia(outputPath)).toBe(true);
    expect(await fs.readFile(path.join(folder, "export-job.json"), "utf8")).toContain("Export complete");
    expect(await fs.readFile(path.join(folder, "export-log.txt"), "utf8")).toContain("Your original recording stays safe");
    expect(summary.originalRecordingSafe).toBe(true);
  }, 20000);

  it("creates a real audio-only export from generated local media", async () => {
    const { createExport } = await import("./export-store");
    const { validatePlayableMedia } = await import("./ffmpeg-tools");
    const job = await createExport({
      episodeId: "episode-audio",
      type: "audio-only",
      qualityPreset: "high",
      practice: true,
      draft: createTimelineDraft({ episodeId: "episode-audio", deviceDefaults: { cameras: {}, microphones: {} } })
    });

    const outputPath = path.join(mockPaths.episodesRoot, "episode-audio", "Exports", job.outputFileName ?? "");

    expect(job.status).toBe("complete");
    expect(job.outputFileName).toBe("what-about-it-audio-only.m4a");
    expect(await validatePlayableMedia(outputPath)).toBe(true);
  }, 20000);

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

  it("returns a friendly media tools setup state when FFmpeg is unavailable", async () => {
    process.env.WHAT_ABOUT_IT_DISABLE_BUNDLED_MEDIA_TOOLS = "1";
    vi.resetModules();
    const { createExport } = await import("./export-store");
    const job = await createExport({
      episodeId: "episode-c",
      type: "full-episode-video",
      qualityPreset: "standard",
      practice: true,
      draft: createTimelineDraft({ episodeId: "episode-c", deviceDefaults: { cameras: {}, microphones: {} } })
    });

    expect(job.status).toBe("error");
    expect(job.error).toBe("media-tools-missing");
    expect(job.message).toBe("Media tools need setup before export");
  });
});
