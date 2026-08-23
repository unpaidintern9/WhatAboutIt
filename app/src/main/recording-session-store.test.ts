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

  it("flags a decodable microphone file that contains no audible signal", async () => {
    const { createRecordingSession, saveRecordedTracks } = await import("./recording-session-store");
    const { runFfmpeg } = await import("./ffmpeg-tools");
    const silentSourcePath = path.join(mockPaths.episodesRoot, "silent-audio.webm");
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-t",
      "1",
      "-c:a",
      "libopus",
      silentSourcePath
    ]);
    const session = await createRecordingSession({
      episodeId: "episode-silent-mic",
      episodeTitle: "Silent Mic",
      deviceDefaults: { cameras: {}, microphones: { morganMic: "mic-a" } }
    });

    const [result] = await saveRecordedTracks(session.folderPath, [
      { slot: "morganMic", kind: "audio", bytes: await fs.readFile(silentSourcePath), mimeType: "audio/webm" }
    ]);

    expect(result.status).toBe("needs-attention");
    expect(result.message).toBe("Saved, but no audible signal was detected");
    await expect(fs.stat(result.filePath as string)).resolves.toBeTruthy();
    await expect(fs.readFile(path.join(session.folderPath, "Logs", "errors.log"), "utf8")).resolves.toContain("contains no audible signal");
  }, 20000);

  it("appends recoverable media chunks during recording, finalizes them, and mirrors verified media to a second folder", async () => {
    const { appendRecordingChunk, beginRecordingMedia, createRecordingSession, finalizeRecordingMedia } = await import("./recording-session-store");
    const { runFfmpeg, validatePlayableMedia } = await import("./ffmpeg-tools");
    const programSource = path.join(mockPaths.episodesRoot, "disk-first-program.webm");
    const audioSource = path.join(mockPaths.episodesRoot, "disk-first-audio.webm");
    const backupRoot = path.join(mockPaths.episodesRoot, "external-backup");
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=20",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "1", "-c:v", "libvpx", "-c:a", "libopus", "-shortest", programSource
    ]);
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000",
      "-t", "1", "-c:a", "libopus", audioSource
    ]);
    const session = await createRecordingSession({
      episodeId: "episode-disk-first",
      episodeTitle: "Disk First",
      backupFolderPath: backupRoot,
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } }
    });
    await beginRecordingMedia(session.folderPath);

    async function appendFile(target: "program" | "morganMic", kind: "program" | "audio", mimeType: string, source: string, sourceStartedAt: string) {
      const bytes = await fs.readFile(source);
      let sequence = 0;
      for (let offset = 0; offset < bytes.length; offset += 4096) {
        await appendRecordingChunk(session.folderPath, {
          target,
          kind,
          mimeType,
          sequence,
          sourceStartedAt,
          bytes: bytes.subarray(offset, offset + 4096)
        });
        sequence += 1;
      }
    }

    await Promise.all([
      appendFile("program", "program", "video/webm", programSource, "2026-08-23T12:00:00.000Z"),
      appendFile("morganMic", "audio", "audio/webm", audioSource, "2026-08-23T12:00:00.650Z")
    ]);
    const result = await finalizeRecordingMedia(session.folderPath);
    const syncMetadata = JSON.parse(await fs.readFile(path.join(session.folderPath, "Session", "sync-metadata.json"), "utf8")) as {
      deviceStartTimestamps: Record<string, string>;
      sourceStartOffsetsMs: Record<string, number>;
    };

    expect(result.integrity.playable).toBe(true);
    expect(result.integrity.savedSourceCount).toBe(1);
    expect(result.integrity.backupPath).toContain("disk-first");
    expect(syncMetadata.deviceStartTimestamps["recording:program"]).toBeTruthy();
    expect(syncMetadata.deviceStartTimestamps["recording:morganMic"]).toBeTruthy();
    expect(syncMetadata.sourceStartOffsetsMs).toMatchObject({ program: 0, morganMic: 650 });
    expect(await validatePlayableMedia(result.programPath as string)).toBe(true);
    expect(await validatePlayableMedia(result.tracks[0].filePath as string)).toBe(true);
    await expect(fs.stat(path.join(result.integrity.backupPath as string, "Program", "program.webm"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(result.integrity.backupPath as string, "Audio", "morgan-mic.m4a"))).resolves.toBeTruthy();
  }, 30000);

  it("pads isolated microphones to the Program audio packet start", async () => {
    const { appendRecordingChunk, beginRecordingMedia, createRecordingSession, finalizeRecordingMedia } = await import("./recording-session-store");
    const { getMediaStreamStartMs, runFfmpeg } = await import("./ffmpeg-tools");
    const programSource = path.join(mockPaths.episodesRoot, "delayed-program-audio.webm");
    const audioSource = path.join(mockPaths.episodesRoot, "immediate-isolated-audio.webm");
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=20",
      "-itsoffset", "0.125", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "1", "-c:v", "libvpx", "-c:a", "libopus", programSource
    ]);
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "1", "-c:a", "libopus", audioSource
    ]);
    const session = await createRecordingSession({
      episodeId: "episode-encoded-audio-offset",
      episodeTitle: "Encoded Audio Offset",
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } }
    });
    await beginRecordingMedia(session.folderPath);

    async function appendFile(target: "program" | "morganMic", kind: "program" | "audio", source: string) {
      const bytes = await fs.readFile(source);
      let sequence = 0;
      for (let offset = 0; offset < bytes.length; offset += 4096) {
        await appendRecordingChunk(session.folderPath, {
          target,
          kind,
          mimeType: kind === "program" ? "video/webm" : "audio/webm",
          sequence,
          sourceStartedAt: "2026-08-23T12:00:00.000Z",
          bytes: bytes.subarray(offset, offset + 4096)
        });
        sequence += 1;
      }
    }

    await Promise.all([
      appendFile("program", "program", programSource),
      appendFile("morganMic", "audio", audioSource)
    ]);
    const result = await finalizeRecordingMedia(session.folderPath);
    const programAudioStartMs = await getMediaStreamStartMs(result.programPath as string, "audio");
    const microphonePath = result.tracks[0].filePath as string;
    const silence = await runFfmpeg(["-i", microphonePath, "-af", "silencedetect=noise=-40dB:d=0.05", "-f", "null", "-"]);
    const silenceEndSeconds = Number(/silence_end:\s*([\d.]+)/.exec(silence.stderr)?.[1] ?? 0);

    expect(programAudioStartMs).toBeGreaterThanOrEqual(80);
    expect(programAudioStartMs).toBeLessThanOrEqual(160);
    expect(silenceEndSeconds * 1000).toBeGreaterThanOrEqual(programAudioStartMs - 20);
    expect(silenceEndSeconds * 1000).toBeLessThanOrEqual(programAudioStartMs + 30);
  }, 30000);

  it("keeps a playable Program available when an optional isolated microphone is silent", async () => {
    const { appendRecordingChunk, beginRecordingMedia, createRecordingSession, finalizeRecordingMedia } = await import("./recording-session-store");
    const { runFfmpeg } = await import("./ffmpeg-tools");
    const programSource = path.join(mockPaths.episodesRoot, "program-with-silent-isolated-mic.webm");
    const silentMicSource = path.join(mockPaths.episodesRoot, "silent-isolated-mic.webm");
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=20",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "1", "-c:v", "libvpx", "-c:a", "libopus", "-shortest", programSource
    ]);
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
      "-t", "1", "-c:a", "libopus", silentMicSource
    ]);
    const session = await createRecordingSession({
      episodeId: "episode-silent-isolated-mic",
      episodeTitle: "Silent Isolated Mic",
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { guestMic: "mic-b" } }
    });
    await beginRecordingMedia(session.folderPath);

    async function appendFile(target: "program" | "guestMic", kind: "program" | "audio", mimeType: string, source: string) {
      const bytes = await fs.readFile(source);
      let sequence = 0;
      for (let offset = 0; offset < bytes.length; offset += 4096) {
        await appendRecordingChunk(session.folderPath, { target, kind, mimeType, sequence, bytes: bytes.subarray(offset, offset + 4096) });
        sequence += 1;
      }
    }

    await Promise.all([
      appendFile("program", "program", "video/webm", programSource),
      appendFile("guestMic", "audio", "audio/webm", silentMicSource)
    ]);
    const result = await finalizeRecordingMedia(session.folderPath);

    expect(result.integrity.programPlayable).toBe(true);
    expect(result.integrity.playable).toBe(true);
    expect(result.integrity.savedSourceCount).toBe(0);
    expect(result.integrity.expectedSourceCount).toBe(1);
    expect(result.integrity.warnings).toContain("guestMic: Saved, but no audible signal was detected");
    expect(result.tracks[0]).toMatchObject({ slot: "guestMic", status: "needs-attention", filePath: expect.any(String) });
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
    const { appendRecordingChunk, beginRecordingMedia, createRecordingSession, listUnfinishedRecordingSessions } = await import("./recording-session-store");
    const session = await createRecordingSession({
      episodeId: "episode-recovery",
      episodeTitle: "Recovery Recording",
      deviceDefaults: {
        cameras: { camera1: "camera-a" },
        microphones: { morganMic: "mic-a" }
      }
    });
    await beginRecordingMedia(session.folderPath);
    await appendRecordingChunk(session.folderPath, {
      target: "program",
      kind: "program",
      mimeType: "video/webm",
      sequence: 0,
      bytes: new Uint8Array([1, 2, 3, 4])
    });

    const unfinished = await listUnfinishedRecordingSessions();

    expect(unfinished).toHaveLength(1);
    expect(unfinished[0]).toMatchObject({ id: session.id, status: "interrupted", recoverableBytes: 4 });
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
