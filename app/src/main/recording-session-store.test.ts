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
    vi.resetModules();
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
    await expect(fs.stat(path.join(session.folderPath, "Session", "sync-metadata.json"))).resolves.toBeTruthy();
  });

  it("saves and validates real program media with camera and audio outputs", async () => {
    const { createRecordingSession, saveProgramRecording } = await import("./recording-session-store");
    const { runFfmpeg, validatePlayableMedia } = await import("./ffmpeg-tools");
    const sourcePath = path.join(mockPaths.episodesRoot, "source-recording.webm");
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=640x360:rate=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "1",
      "-c:v",
      "libvpx",
      "-c:a",
      "libopus",
      "-shortest",
      sourcePath
    ]);

    const session = await createRecordingSession({
      episodeId: "episode-media",
      episodeTitle: "Media Recording",
      deviceDefaults: {
        cameras: { camera1: "camera-a" },
        microphones: { morganMic: "mic-a" }
      }
    });
    const savedPath = await saveProgramRecording(session.folderPath, await fs.readFile(sourcePath));
    const cameraPath = path.join(session.folderPath, "Cameras", "camera-1.webm");
    const audioPath = path.join(session.folderPath, "Audio", "morgan-mic.m4a");
    const syncMetadata = JSON.parse(await fs.readFile(path.join(session.folderPath, "Session", "sync-metadata.json"), "utf8")) as {
      savedMediaFiles?: { program?: string; camera1?: string; morganMic?: string };
      validation?: { programPlayable: boolean };
    };

    expect(savedPath).toBe(path.join(session.folderPath, "Program", "program.webm"));
    await expect(fs.stat(cameraPath)).resolves.toBeTruthy();
    await expect(fs.stat(audioPath)).resolves.toBeTruthy();
    expect(await validatePlayableMedia(savedPath)).toBe(true);
    expect(await validatePlayableMedia(cameraPath)).toBe(true);
    expect(await validatePlayableMedia(audioPath)).toBe(true);
    expect(syncMetadata.savedMediaFiles?.program).toBe(savedPath);
    expect(syncMetadata.savedMediaFiles?.camera1).toBe(cameraPath);
    expect(syncMetadata.savedMediaFiles?.morganMic).toBe(audioPath);
    expect(syncMetadata.validation?.programPlayable).toBe(true);
  }, 20000);

  it("detects unfinished recording sessions for recovery", async () => {
    const { createRecordingSession, listUnfinishedRecordingSessions } = await import("./recording-session-store");
    const session = await createRecordingSession({
      episodeId: "episode-recovery",
      episodeTitle: "Recovery Recording",
      deviceDefaults: {
        cameras: { camera1: "camera-a" },
        microphones: { morganMic: "mic-a" }
      }
    });

    const unfinished = await listUnfinishedRecordingSessions();

    expect(unfinished).toHaveLength(1);
    expect(unfinished[0]).toMatchObject({ id: session.id, status: "interrupted" });
  });

  it("rejects invalid program media instead of pretending it recorded", async () => {
    const { createRecordingSession, saveProgramRecording } = await import("./recording-session-store");
    const session = await createRecordingSession({
      episodeId: "episode-invalid",
      episodeTitle: "Invalid Recording",
      deviceDefaults: {
        cameras: { camera1: "camera-a" },
        microphones: { morganMic: "mic-a" }
      }
    });

    await expect(saveProgramRecording(session.folderPath, Uint8Array.from([1, 2, 3]))).rejects.toThrow(
      "Saved recording could not be validated."
    );
    await expect(fs.readFile(path.join(session.folderPath, "Logs", "errors.log"), "utf8")).resolves.toContain(
      "Program recording could not be validated."
    );
  }, 20000);
});
