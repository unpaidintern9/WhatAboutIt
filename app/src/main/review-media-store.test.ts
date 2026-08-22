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
    const camera2Path = path.join(mockPaths.episodesRoot, episodeId, "Cameras", "camera-2.webm");
    const camera3Path = path.join(mockPaths.episodesRoot, episodeId, "Cameras", "camera-3.webm");
    const audioPath = path.join(mockPaths.episodesRoot, episodeId, "Audio", "morgan-mic.m4a");
    const guestAudioPath = path.join(mockPaths.episodesRoot, episodeId, "Audio", "guest-mic.m4a");
    const extraAudioPath = path.join(mockPaths.episodesRoot, episodeId, "Audio", "extra-mic.m4a");
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
    await fs.copyFile(programPath, camera2Path);
    await fs.copyFile(programPath, camera3Path);
    await runFfmpeg(["-y", "-i", programPath, "-vn", "-c:a", "aac", audioPath]);
    await fs.copyFile(audioPath, guestAudioPath);
    await fs.copyFile(audioPath, extraAudioPath);

    const inventory = await loadReviewMedia(episodeId);

    expect(inventory.hasPlayableProgram).toBe(true);
    expect(inventory.program.status).toBe("ready");
    expect(inventory.program.durationMs).toBeGreaterThan(0);
    expect(inventory.cameras.find((asset) => asset.id === "camera-1")?.status).toBe("ready");
    expect(inventory.cameras.find((asset) => asset.id === "camera-2")?.status).toBe("ready");
    expect(inventory.cameras.find((asset) => asset.id === "camera-3")?.status).toBe("ready");
    expect(inventory.audio.find((asset) => asset.id === "morgan-mic")?.status).toBe("ready");
    expect(inventory.audio.find((asset) => asset.id === "guest-mic")?.status).toBe("ready");
    expect(inventory.audio.find((asset) => asset.id === "extra-mic")?.status).toBe("ready");
    expect(inventory.program.playbackUrl).toMatch(/^wai-media:\/\/episode\//);
    expect(inventory.program.waveformUrl).toMatch(/^wai-media:\/\/episode\//);
    expect(inventory.program.posterUrl).toMatch(/^wai-media:\/\/episode\//);
    expect(inventory.program.filmstripUrl).toMatch(/^wai-media:\/\/episode\//);
    expect(inventory.cameras.find((asset) => asset.id === "camera-1")?.pairedAudioId).toBe("morgan-mic");
    expect(inventory.cameras.find((asset) => asset.id === "camera-1")?.waveformUrl).toBeUndefined();
    expect(inventory.cameras.find((asset) => asset.id === "camera-1")?.filmstripUrl).toMatch(/^wai-media:\/\/episode\//);
    expect(inventory.audio.find((asset) => asset.id === "morgan-mic")?.waveformUrl).toMatch(/^wai-media:\/\/episode\//);
    expect(inventory.cameras.find((asset) => asset.id === "camera-2")?.pairedAudioId).toBe("guest-mic");
    expect(inventory.program.reviewProxyPath).toBeUndefined();
    expect(inventory.cameras.find((asset) => asset.id === "camera-1")?.includesPairedAudio).toBe(false);
  }, 20000);

  it("uses recording state duration when a WebM file has no embedded duration", async () => {
    const { loadReviewMedia } = await import("./review-media-store");
    const episodeId = "episode-webm-durationless";
    const episodeFolder = path.join(mockPaths.episodesRoot, episodeId);
    const programPath = path.join(episodeFolder, "Program", "program.webm");
    const statePath = path.join(episodeFolder, "Session", "recording-state.json");
    await fs.mkdir(path.dirname(programPath), { recursive: true });
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(programPath, "not an actual webm");
    await fs.writeFile(statePath, JSON.stringify({ elapsedMs: 54749 }));

    const ffmpegTools = await import("./ffmpeg-tools");
    const probeSpy = vi.spyOn(ffmpegTools, "runFfprobe").mockResolvedValue({
      stdout: JSON.stringify({
        streams: [{ codec_type: "video", codec_name: "vp9", width: 1024, height: 576 }],
        format: { size: "12345" }
      }),
      stderr: ""
    });

    const inventory = await loadReviewMedia(episodeId);

    expect(inventory.program.status).toBe("ready");
    expect(inventory.program.durationMs).toBe(54749);

    probeSpy.mockRestore();
  });

  it("does not scan a long recording end to end for timeline thumbnails", async () => {
    const episodeId = "episode-long-recording";
    const episodeFolder = path.join(mockPaths.episodesRoot, episodeId);
    const programPath = path.join(episodeFolder, "Program", "program.webm");
    const statePath = path.join(episodeFolder, "Session", "recording-state.json");
    await fs.mkdir(path.dirname(programPath), { recursive: true });
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(programPath, "webm placeholder");
    await fs.writeFile(statePath, JSON.stringify({ elapsedMs: 662000 }));

    const ffmpegTools = await import("./ffmpeg-tools");
    const probeSpy = vi.spyOn(ffmpegTools, "runFfprobe").mockResolvedValue({
      stdout: JSON.stringify({
        streams: [{ codec_type: "video", codec_name: "vp9", width: 1280, height: 720 }, { codec_type: "audio", codec_name: "opus" }],
        format: { size: "12345" }
      }),
      stderr: ""
    });
    const ffmpegSpy = vi.spyOn(ffmpegTools, "runFfmpeg").mockResolvedValue({ stdout: "", stderr: "" });
    const { loadReviewMedia } = await import("./review-media-store");

    const inventory = await loadReviewMedia(episodeId);

    expect(inventory.hasPlayableProgram).toBe(true);
    expect(inventory.program.filmstripUrl).toBe(inventory.program.posterUrl);
    expect(ffmpegSpy.mock.calls.some(([args]) => args.some((argument) => argument.includes("tile=12x1")))).toBe(false);
    probeSpy.mockRestore();
    ffmpegSpy.mockRestore();
  });

  it("does not present silent microphone files as usable stems or waveforms", async () => {
    const { runFfmpeg } = await import("./ffmpeg-tools");
    const { loadReviewMedia } = await import("./review-media-store");
    const episodeId = "episode-silent-mic";
    const episodeFolder = path.join(mockPaths.episodesRoot, episodeId);
    const programPath = path.join(episodeFolder, "Program", "program.webm");
    const cameraPath = path.join(episodeFolder, "Cameras", "camera-1.webm");
    const audioPath = path.join(episodeFolder, "Audio", "morgan-mic.m4a");
    const metadataPath = path.join(episodeFolder, "Session", "sync-metadata.json");
    await fs.mkdir(path.dirname(programPath), { recursive: true });
    await fs.mkdir(path.dirname(cameraPath), { recursive: true });
    await fs.mkdir(path.dirname(audioPath), { recursive: true });
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "0.5", "-c:v", "libvpx", "-c:a", "libopus", "-shortest", programPath
    ]);
    await fs.copyFile(programPath, cameraPath);
    await runFfmpeg(["-y", "-i", programPath, "-vn", "-c:a", "aac", audioPath]);
    await fs.writeFile(metadataPath, JSON.stringify({
      trackStates: {
        morganMic: { status: "needs-attention", message: "Saved, but no audible signal was detected" }
      }
    }));

    const inventory = await loadReviewMedia(episodeId);
    const microphone = inventory.audio.find((asset) => asset.id === "morgan-mic");
    const camera = inventory.cameras.find((asset) => asset.id === "camera-1");

    expect(inventory.program.audioSignal).toBe("silent");
    expect(inventory.program.waveformUrl).toBeUndefined();
    expect(microphone?.audioSignal).toBe("silent");
    expect(microphone?.waveformUrl).toBeUndefined();
    expect(microphone?.message).toContain("No audible signal");
    expect(camera?.includesPairedAudio).toBe(false);
    expect(camera?.audioSignal).toBe("silent");
  }, 20000);

  it("does not try to build a waveform for a video-only camera", async () => {
    const { runFfmpeg } = await import("./ffmpeg-tools");
    const { logger } = await import("./logger");
    const { loadReviewMedia } = await import("./review-media-store");
    const episodeId = "episode-video-only-camera";
    const episodeFolder = path.join(mockPaths.episodesRoot, episodeId);
    const programPath = path.join(episodeFolder, "Program", "program.webm");
    const cameraPath = path.join(episodeFolder, "Cameras", "camera-1.webm");
    await fs.mkdir(path.dirname(programPath), { recursive: true });
    await fs.mkdir(path.dirname(cameraPath), { recursive: true });
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x180:rate=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "0.5",
      "-c:v",
      "libvpx",
      "-c:a",
      "libopus",
      "-shortest",
      programPath
    ]);
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x180:rate=24",
      "-t",
      "0.5",
      "-an",
      "-c:v",
      "libvpx",
      cameraPath
    ]);

    const inventory = await loadReviewMedia(episodeId);
    const camera = inventory.cameras.find((asset) => asset.id === "camera-1");

    expect(camera?.status).toBe("ready");
    expect(camera?.hasAudio).toBe(false);
    expect(camera?.waveformUrl).toBeUndefined();
    expect(logger.warning).not.toHaveBeenCalledWith(
      "ReviewMedia",
      "Audio waveform could not be prepared.",
      expect.objectContaining({ filePath: expect.stringContaining("camera-1.webm") })
    );
  }, 20000);

  it("imports an external camera file into Camera 1 and creates the Program fallback", async () => {
    const { runFfmpeg } = await import("./ffmpeg-tools");
    const { importReviewMediaFile, relinkImportedMediaFile, verifyImportedMediaIntegrity } = await import("./review-media-store");
    const episodeId = "episode-import";
    const sourcePath = path.join(mockPaths.episodesRoot, "phone-camera.mp4");
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x180:rate=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "0.5",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      "-shortest",
      sourcePath
    ]);

    const progress: number[] = [];
    const inventory = await importReviewMediaFile(episodeId, "camera-1", sourcePath, { onProgress: (update) => progress.push(update.progress) });

    expect(inventory.cameras.find((asset) => asset.id === "camera-1")?.status).toBe("ready");
    expect(inventory.cameras.find((asset) => asset.id === "camera-1")?.originalFilePath).toBe(path.join(mockPaths.episodesRoot, episodeId, "Originals", "camera-1.mp4"));
    expect(inventory.program.status).toBe("ready");
    await expect(fs.stat(path.join(mockPaths.episodesRoot, episodeId, "Originals", "camera-1.mp4"))).resolves.toBeTruthy();
    expect(await fs.readFile(path.join(mockPaths.episodesRoot, episodeId, "Originals", "camera-1.mp4"))).toEqual(await fs.readFile(sourcePath));
    await expect(fs.stat(path.join(mockPaths.episodesRoot, episodeId, "Cameras", "camera-1.webm"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(mockPaths.episodesRoot, episodeId, "Program", "program.webm"))).resolves.toBeTruthy();
    const manifest = JSON.parse(await fs.readFile(path.join(mockPaths.episodesRoot, episodeId, "Session", "imported-media.json"), "utf8")) as {
      version: number;
      assets: Record<string, { relativePath: string; sizeBytes: number; sha256: string }>;
    };
    expect(manifest.version).toBe(2);
    expect(manifest.assets["camera-1"].relativePath).toBe(path.join("Originals", "camera-1.mp4"));
    expect(manifest.assets["camera-1"].sizeBytes).toBeGreaterThan(0);
    expect(manifest.assets["camera-1"].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(progress[0]).toBe(3);
    expect(progress.some((value) => value > 20 && value < 100)).toBe(true);
    expect(progress).toContain(96);
    expect(progress.at(-1)).toBe(100);

    await expect(verifyImportedMediaIntegrity(episodeId)).resolves.toMatchObject({
      items: [expect.objectContaining({ slot: "camera-1", status: "verified" })]
    });
    const protectedOriginal = path.join(mockPaths.episodesRoot, episodeId, "Originals", "camera-1.mp4");
    await fs.appendFile(protectedOriginal, "changed");
    await expect(verifyImportedMediaIntegrity(episodeId)).resolves.toMatchObject({
      items: [expect.objectContaining({ slot: "camera-1", status: "changed" })]
    });
    await expect(relinkImportedMediaFile(episodeId, "camera-1", path.join(mockPaths.episodesRoot, episodeId, "Cameras", "camera-1.webm"))).rejects.toThrow("does not match");
    await relinkImportedMediaFile(episodeId, "camera-1", sourcePath);
    await expect(verifyImportedMediaIntegrity(episodeId)).resolves.toMatchObject({
      items: [expect.objectContaining({ slot: "camera-1", status: "verified" })]
    });
  }, 20000);

  it("cancels before changing episode media and cleans temporary files", async () => {
    const { importReviewMediaFile } = await import("./review-media-store");
    const episodeId = "episode-canceled-import";
    const sourcePath = path.join(mockPaths.episodesRoot, "cancel-source.mp4");
    await fs.writeFile(sourcePath, "source");
    const controller = new AbortController();
    controller.abort();

    await expect(importReviewMediaFile(episodeId, "camera-1", sourcePath, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    await expect(fs.stat(path.join(mockPaths.episodesRoot, episodeId, "Cameras", "camera-1.webm"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(mockPaths.episodesRoot, episodeId, "Originals", "camera-1.mp4.importing"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stops replacement when the existing media cannot be backed up", async () => {
    const { backupExistingImportedMedia } = await import("./review-media-store");
    const episodeFolder = path.join(mockPaths.episodesRoot, "episode-backup-safety");
    const existingPath = path.join(episodeFolder, "Cameras", "camera-1.webm");
    await fs.mkdir(path.dirname(existingPath), { recursive: true });
    await fs.writeFile(existingPath, "existing recording");
    const copySpy = vi.spyOn(fs, "copyFile").mockRejectedValueOnce(new Error("disk failure"));

    await expect(backupExistingImportedMedia(episodeFolder, existingPath, "camera-1")).rejects.toThrow("import was stopped before anything was replaced");
    expect(await fs.readFile(existingPath, "utf8")).toBe("existing recording");
    copySpy.mockRestore();
  });

  it("keeps only the five newest imported-media backups for each slot", async () => {
    const { backupExistingImportedMedia } = await import("./review-media-store");
    const episodeFolder = path.join(mockPaths.episodesRoot, "episode-backup-retention");
    const existingPath = path.join(episodeFolder, "Cameras", "camera-1.webm");
    await fs.mkdir(path.dirname(existingPath), { recursive: true });
    await fs.writeFile(existingPath, "existing recording");

    for (let index = 0; index < 7; index += 1) await backupExistingImportedMedia(episodeFolder, existingPath, "camera-1");

    const backups = await fs.readdir(path.join(episodeFolder, "Backup", "Imported Media"));
    expect(backups.filter((fileName) => fileName.startsWith("camera-1-"))).toHaveLength(5);
  });

  it("ignores imported-original manifest paths outside the episode", async () => {
    const { loadImportedOriginalPaths } = await import("./review-media-store");
    const episodeId = "episode-safe-paths";
    const sessionFolder = path.join(mockPaths.episodesRoot, episodeId, "Session");
    await fs.mkdir(sessionFolder, { recursive: true });
    await fs.writeFile(path.join(sessionFolder, "imported-media.json"), JSON.stringify({
      version: 1,
      assets: { "camera-1": { relativePath: path.join("..", "..", "outside.mp4"), importedAt: "now" } }
    }));

    await expect(loadImportedOriginalPaths(episodeId)).resolves.toEqual({});
  });

  it("only reports high sync confidence for several tightly matching sound moments", async () => {
    const { alignSoundOnsets } = await import("./review-media-store");

    expect(alignSoundOnsets([1000, 5000, 9100], [1750, 5750, 9850])).toMatchObject({
      offsetMs: 750,
      confidence: "high",
      matchCount: 3,
      maxErrorMs: 0
    });
    expect(alignSoundOnsets([1000], [1750])).toMatchObject({
      offsetMs: 750,
      confidence: "review",
      matchCount: 1
    });
  });

  it("chooses the repeated sync offset despite unrelated camera sounds", async () => {
    const { alignSoundOnsets } = await import("./review-media-store");
    const result = alignSoundOnsets([1000, 5000, 9000, 14000], [200, 2220, 6210, 10230, 15210, 28000]);

    expect(result?.offsetMs).toBeGreaterThanOrEqual(1200);
    expect(result?.offsetMs).toBeLessThanOrEqual(1230);
    expect(result?.confidence).toBe("high");
  });

  it("finds an audio waveform delay even without a clean clap", async () => {
    const { correlateAudioEnvelopes } = await import("./review-media-store");
    const reference = Array.from({ length: 900 }, (_, index) => Math.sin(index * 0.071) + Math.sin(index * 0.019) * 0.4 + (index % 47 === 0 ? 1.5 : 0));
    const delayed = [...Array.from({ length: 37 }, () => 0), ...reference, ...Array.from({ length: 20 }, () => 0)];
    const result = correlateAudioEnvelopes(reference, delayed, 20);

    expect(result?.offsetMs).toBe(740);
    expect(result?.confidence).toBe("high");
    expect(result?.score).toBeGreaterThan(0.9);
  });

  it("rejects unrelated waveforms instead of applying a random sync offset", async () => {
    const { correlateAudioEnvelopes } = await import("./review-media-store");
    const reference = Array.from({ length: 500 }, (_, index) => Math.sin(index * 0.1));
    const unrelated = Array.from({ length: 500 }, (_, index) => Math.sin(index * 0.173 + 1));

    expect(correlateAudioEnvelopes(reference, unrelated, 20)).toBeUndefined();
  });
});
