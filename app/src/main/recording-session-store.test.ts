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

describe("recording session store", () => {
  beforeEach(async () => {
    mockPaths.episodesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wai-recording-"));
  });

  afterEach(async () => {
    await fs.rm(mockPaths.episodesRoot, { recursive: true, force: true });
  });

  it("creates a local recording session folder set", async () => {
    const { createRecordingSession } = await import("./recording-session-store");
    const session = await createRecordingSession({
      episodeId: "episode-a",
      episodeTitle: "Full Flow QA",
      deviceDefaults: {
        cameras: { camera1: "camera-a" },
        microphones: { morganMic: "mic-a" }
      }
    });

    for (const folder of ["Program", "Cameras", "Audio", "Backup", "Session", "Logs"]) {
      await expect(fs.stat(path.join(session.folderPath, folder))).resolves.toBeTruthy();
    }
    await expect(fs.stat(path.join(session.folderPath, "Session", "recording-session.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(session.folderPath, "Session", "device-map.json"))).resolves.toBeTruthy();
  });
});
