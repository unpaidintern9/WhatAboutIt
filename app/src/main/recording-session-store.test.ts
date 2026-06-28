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
    await expect(fs.readFile(path.join(session.folderPath, "metadata.json"), "utf8")).resolves.toContain("Full Flow QA");
  });

  it("saves and validates real program media", async () => {
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
    const syncMetadata = JSON.parse(await fs.readFile(path.join(session.folderPath, "Session", "sync-metadata.json"), "utf8")) as {
      savedMediaFiles?: { program?: string; camera1?: string; morganMic?: string };
      validation?: { programPlayable: boolean };
    };

    expect(savedPath).toBe(path.join(session.folderPath, "Program", "program.webm"));
    expect(await validatePlayableMedia(savedPath)).toBe(true);
    expect(syncMetadata.savedMediaFiles?.program).toBe(savedPath);
    expect(syncMetadata.validation?.programPlayable).toBe(true);
  }, 20000);

  it("saves and validates separate camera and microphone recorder outputs", async () => {
    const { createRecordingSession, saveRecordedTracks } = await import("./recording-session-store");
    const { runFfmpeg, validatePlayableMedia } = await import("./ffmpeg-tools");
    const cameraSourcePath = path.join(mockPaths.episodesRoot, "camera-source.webm");
    const audioSourcePath = path.join(mockPaths.episodesRoot, "audio-source.webm");
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=640x360:rate=24",
      "-t",
      "1",
      "-c:v",
      "libvpx",
      cameraSourcePath
    ]);
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=550:sample_rate=48000",
      "-t",
      "1",
      "-c:a",
      "libopus",
      audioSourcePath
    ]);

    const session = await createRecordingSession({
      episodeId: "episode-tracks",
      episodeTitle: "Track Recording",
      deviceDefaults: {
        cameras: { camera1: "camera-a", camera2: "camera-b", camera3: "camera-c" },
        microphones: { morganMic: "mic-a", guestMic: "mic-b", extraMic: "mic-c" }
      }
    });
    const cameraBytes = await fs.readFile(cameraSourcePath);
    const audioBytes = await fs.readFile(audioSourcePath);
    const results = await saveRecordedTracks(session.folderPath, [
      { slot: "camera2", kind: "camera", bytes: cameraBytes, mimeType: "video/webm" },
      { slot: "camera3", kind: "camera", bytes: cameraBytes, mimeType: "video/webm" },
      { slot: "guestMic", kind: "audio", bytes: audioBytes, mimeType: "audio/webm" },
      { slot: "extraMic", kind: "audio", bytes: audioBytes, mimeType: "audio/webm" }
    ]);

    const camera2Path = path.join(session.folderPath, "Cameras", "camera-2.webm");
    const camera3Path = path.join(session.folderPath, "Cameras", "camera-3.webm");
    const guestPath = path.join(session.folderPath, "Audio", "guest-mic.m4a");
    const extraPath = path.join(session.folderPath, "Audio", "extra-mic.m4a");
    const syncMetadata = JSON.parse(await fs.readFile(path.join(session.folderPath, "Session", "sync-metadata.json"), "utf8")) as {
      savedMediaFiles?: { camera2?: string; camera3?: string; guestMic?: string; extraMic?: string };
      trackStates?: Record<string, { status: string; message: string }>;
    };

    expect(results.map((result) => [result.slot, result.status])).toEqual([
      ["camera2", "saved"],
      ["camera3", "saved"],
      ["guestMic", "saved"],
      ["extraMic", "saved"]
    ]);
    await expect(fs.stat(camera2Path)).resolves.toBeTruthy();
    await expect(fs.stat(camera3Path)).resolves.toBeTruthy();
    await expect(fs.stat(guestPath)).resolves.toBeTruthy();
    await expect(fs.stat(extraPath)).resolves.toBeTruthy();
    expect(await validatePlayableMedia(camera2Path)).toBe(true);
    expect(await validatePlayableMedia(camera3Path)).toBe(true);
    expect(await validatePlayableMedia(guestPath)).toBe(true);
    expect(await validatePlayableMedia(extraPath)).toBe(true);
    expect(syncMetadata.savedMediaFiles?.camera2).toBe(camera2Path);
    expect(syncMetadata.savedMediaFiles?.camera3).toBe(camera3Path);
    expect(syncMetadata.savedMediaFiles?.guestMic).toBe(guestPath);
    expect(syncMetadata.savedMediaFiles?.extraMic).toBe(extraPath);
    expect(syncMetadata.trackStates?.guestMic?.message).toBe("Saved");
  }, 30000);

  it("keeps preview-only track states truthful", async () => {
    const { createRecordingSession, saveRecordedTracks } = await import("./recording-session-store");
    const session = await createRecordingSession({
      episodeId: "episode-preview-only",
      episodeTitle: "Preview Only",
      deviceDefaults: {
        cameras: { camera2: "camera-b" },
        microphones: { guestMic: "mic-b" }
      }
    });

    const results = await saveRecordedTracks(session.folderPath, [
      { slot: "camera2", kind: "camera", status: "preview-only", message: "This device can preview but could not save separately" }
    ]);

    await expect(fs.stat(path.join(session.folderPath, "Cameras", "camera-2.webm"))).rejects.toThrow();
    expect(results).toEqual([
      {
        slot: "camera2",
        kind: "camera",
        status: "preview-only",
        message: "This device can preview but could not save separately"
      }
    ]);
  });

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

  it("marks the session complete when recording state stops", async () => {
    const { createRecordingSession, writeRecordingState } = await import("./recording-session-store");
    const session = await createRecordingSession({
      episodeId: "episode-stopped",
      episodeTitle: "Stopped Recording",
      deviceDefaults: {
        cameras: { camera1: "camera-a" },
        microphones: { morganMic: "mic-a" }
      }
    });

    await writeRecordingState(session.folderPath, {
      sessionId: session.id,
      status: "stopped",
      updatedAt: "2026-06-27T22:00:00.000Z",
      elapsedMs: 30000,
      lastSavedAt: "2026-06-27T22:00:00.000Z"
    });

    const savedSession = JSON.parse(
      await fs.readFile(path.join(session.folderPath, "Session", "recording-session.json"), "utf8")
    ) as { status: string; stoppedAt?: string };

    expect(savedSession.status).toBe("stopped");
    expect(savedSession.stoppedAt).toBeTruthy();
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
