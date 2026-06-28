import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("review media store", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockPaths.episodesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wai-review-media-"));
  });

  afterEach(async () => {
    await fs.rm(mockPaths.episodesRoot, { recursive: true, force: true });
  });

  it("loads real program, camera, and audio files from the episode folder", async () => {
    const { runFfmpeg } = await import("./ffmpeg-tools");
    const { loadReviewMedia } = await import("./review-media-store");
    const episodeId = "episode-a";
    const programPath = path.join(mockPaths.episodesRoot, episodeId, "Program", "program.webm");
    const cameraPath = path.join(mockPaths.episodesRoot, episodeId, "Cameras", "camera-1.webm");
    const audioPath = path.join(mockPaths.episodesRoot, episodeId, "Audio", "morgan-mic.m4a");
    await fs.mkdir(path.dirname(programPath), { recursive: true });
    await fs.mkdir(path.dirname(cameraPath), { recursive: true });
    await fs.mkdir(path.dirname(audioPath), { recursive: true });

    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x180:rate=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=550:sample_rate=48000",
      "-t",
      "1",
      "-c:v",
      "libvpx",
      "-c:a",
      "libopus",
      "-shortest",
      programPath
    ]);
    await fs.copyFile(programPath, cameraPath);
    await runFfmpeg(["-y", "-i", programPath, "-vn", "-c:a", "aac", audioPath]);

    const inventory = await loadReviewMedia(episodeId);

    expect(inventory.hasPlayableProgram).toBe(true);
    expect(inventory.program.status).toBe("ready");
    expect(inventory.program.durationMs).toBeGreaterThan(0);
    expect(inventory.cameras.find((asset) => asset.id === "camera-1")?.status).toBe("ready");
    expect(inventory.audio.find((asset) => asset.id === "morgan-mic")?.status).toBe("ready");
    expect(inventory.audio.find((asset) => asset.id === "guest-mic")?.status).toBe("missing");
    expect(inventory.program.playbackUrl).toMatch(/^file:\/\//);
  }, 20000);
});
