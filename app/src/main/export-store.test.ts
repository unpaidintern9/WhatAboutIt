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
  }, 20000);

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

  it("versions repeated exports instead of overwriting earlier output", async () => {
    const { createExport } = await import("./export-store");
    const request = {
      episodeId: "episode-versioned",
      type: "audio-only" as const,
      qualityPreset: "standard" as const,
      practice: true,
      draft: createTimelineDraft({ episodeId: "episode-versioned", deviceDefaults: { cameras: {}, microphones: {} } })
    };

    const first = await createExport(request);
    const second = await createExport(request);
    const folder = path.join(mockPaths.episodesRoot, request.episodeId, "Exports");

    expect(first.outputFileName).toBe("what-about-it-audio-only.m4a");
    expect(second.outputFileName).toBe("what-about-it-audio-only-2.m4a");
    await expect(fs.stat(path.join(folder, first.outputFileName ?? ""))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(folder, second.outputFileName ?? ""))).resolves.toBeTruthy();
  }, 30000);

  it("creates a real audio-only export from generated local media", async () => {
    const { createExport } = await import("./export-store");
    const { validatePlayableMedia } = await import("./ffmpeg-tools");
    const job = await createExport({
      episodeId: "episode-audio",
      type: "audio-only",
      qualityPreset: "high",
      masteringMode: "measured",
      practice: true,
      draft: createTimelineDraft({ episodeId: "episode-audio", deviceDefaults: { cameras: {}, microphones: {} } })
    });

    const outputPath = path.join(mockPaths.episodesRoot, "episode-audio", "Exports", job.outputFileName ?? "");

    expect(job.status).toBe("complete");
    expect(job.outputFileName).toBe("what-about-it-audio-only.m4a");
    expect(await validatePlayableMedia(outputPath)).toBe(true);
  }, 20000);

  it("renders a playable preview with the selected microphone treatment", async () => {
    const { renderTrackTreatmentPreview } = await import("./export-store");
    const { runFfmpeg, validatePlayableMedia } = await import("./ffmpeg-tools");
    const episodeId = "episode-treatment-preview";
    const audioPath = path.join(mockPaths.episodesRoot, episodeId, "Audio", "morgan-mic.m4a");
    await fs.mkdir(path.dirname(audioPath), { recursive: true });
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1", "-c:a", "aac", audioPath]);
    const draft = createTimelineDraft({ episodeId, durationMs: 1000, deviceDefaults: { cameras: {}, microphones: { morganMic: "mic-a" } } });
    const treatedDraft = {
      ...draft,
      tracks: draft.tracks.map((track) => track.id === "mic-morganMic" ? { ...track, compression: 45, noiseReduction: 20, eqHighDb: 2 } : track)
    };

    const preview = await renderTrackTreatmentPreview({ episodeId, draft: treatedDraft, trackId: "mic-morganMic", timestampMs: 500 });
    const previewFolder = path.join(mockPaths.episodesRoot, episodeId, "Session", "Review");
    const previewFile = (await fs.readdir(previewFolder)).find((fileName) => fileName.startsWith("treatment-preview-mic-morganMic-"));
    const previewPath = path.join(previewFolder, previewFile ?? "missing");

    expect(preview.kind).toBe("audio");
    expect(preview.playbackUrl).toContain("version=");
    expect(await validatePlayableMedia(previewPath, undefined, { audio: true, decode: true })).toBe(true);
  }, 20000);

  it("exports edited captions as a versioned SRT sidecar", async () => {
    const { createExport } = await import("./export-store");
    const draft = createTimelineDraft({ episodeId: "episode-captions", durationMs: 2000, deviceDefaults: { cameras: {}, microphones: {} } });
    draft.captions = [{ id: "caption-1", startMs: 250, endMs: 1500, text: "Welcome to the show" }];

    const first = await createExport({ episodeId: "episode-captions", type: "audio-only", qualityPreset: "standard", practice: true, draft });
    const second = await createExport({ episodeId: "episode-captions", type: "audio-only", qualityPreset: "standard", practice: true, draft });
    const folder = path.join(mockPaths.episodesRoot, "episode-captions", "Exports");

    expect(first.outputFileNames).toContain("captions.srt");
    expect(second.outputFileNames).toContain("captions-2.srt");
    expect(await fs.readFile(path.join(folder, "captions.srt"), "utf8")).toContain("00:00:00,250 --> 00:00:01,500");
  }, 30000);

  it("renders the high preset as a real 1080p video", async () => {
    const { createExport } = await import("./export-store");
    const { runFfprobe } = await import("./ffmpeg-tools");
    const job = await createExport({
      episodeId: "episode-high",
      type: "full-episode-video",
      qualityPreset: "high",
      practice: true,
      draft: createTimelineDraft({ episodeId: "episode-high", deviceDefaults: { cameras: {}, microphones: {} } })
    });
    const outputPath = path.join(mockPaths.episodesRoot, "episode-high", "Exports", job.outputFileName ?? "");
    const probe = await runFfprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", outputPath]);
    const streams = (JSON.parse(probe.stdout) as { streams: Array<{ width: number; height: number }> }).streams;

    expect(job.status).toBe("complete");
    expect(streams[0]).toEqual({ width: 1920, height: 1080 });
  }, 30000);

  it("exports a playable file from an existing program recording", async () => {
    const { createExport } = await import("./export-store");
    const { runFfmpeg, validatePlayableMedia } = await import("./ffmpeg-tools");
    const programFolder = path.join(mockPaths.episodesRoot, "episode-recorded", "Program");
    const sourcePath = path.join(programFolder, "program.webm");
    await fs.mkdir(programFolder, { recursive: true });
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=640x360:rate=24",
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
      sourcePath
    ]);

    const job = await createExport({
      episodeId: "episode-recorded",
      type: "full-episode-video",
      qualityPreset: "standard",
      draft: createTimelineDraft({ episodeId: "episode-recorded", deviceDefaults: { cameras: {}, microphones: {} } })
    });

    const outputPath = path.join(mockPaths.episodesRoot, "episode-recorded", "Exports", job.outputFileName ?? "");

    expect(job.status).toBe("complete");
    expect(job.outputFileName).toBe("what-about-it-full-episode-video.mp4");
    expect(await validatePlayableMedia(outputPath)).toBe(true);
  }, 20000);

  it("exports from the protected Camera 1 original when Program is an imported proxy", async () => {
    const { createExport } = await import("./export-store");
    const { getMediaDurationMs, runFfmpeg } = await import("./ffmpeg-tools");
    const episodeId = "episode-original-master";
    const episodeFolder = path.join(mockPaths.episodesRoot, episodeId);
    const originalPath = path.join(episodeFolder, "Originals", "camera-1.mp4");
    const programPath = path.join(episodeFolder, "Program", "program.webm");
    const sessionFolder = path.join(episodeFolder, "Session");
    await Promise.all([fs.mkdir(path.dirname(originalPath), { recursive: true }), fs.mkdir(path.dirname(programPath), { recursive: true }), fs.mkdir(sessionFolder, { recursive: true })]);
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=24", "-f", "lavfi", "-i", "sine=frequency=550:sample_rate=48000", "-t", "1.5", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", originalPath]);
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "0.5", "-c:v", "libvpx", "-c:a", "libopus", "-shortest", programPath]);
    await fs.writeFile(path.join(sessionFolder, "program-from-camera-1.json"), JSON.stringify({ source: "camera-1" }));
    await fs.writeFile(path.join(sessionFolder, "imported-media.json"), JSON.stringify({
      version: 1,
      assets: { "camera-1": { relativePath: path.join("Originals", "camera-1.mp4"), importedAt: "2026-08-15T12:00:00.000Z" } }
    }));

    const job = await createExport({
      episodeId,
      type: "full-episode-video",
      qualityPreset: "standard",
      draft: createTimelineDraft({ episodeId, durationMs: 1500, deviceDefaults: { cameras: {}, microphones: {} } })
    });
    const outputPath = path.join(episodeFolder, "Exports", job.outputFileName ?? "");

    expect(job.status).toBe("complete");
    expect(await getMediaDurationMs(outputPath)).toBeGreaterThan(1200);
  }, 30000);

  it("renders Program-only timeline cuts instead of copying the unchanged recording", async () => {
    const { createExport } = await import("./export-store");
    const { getMediaDurationMs, runFfmpeg, validatePlayableMedia } = await import("./ffmpeg-tools");
    const episodeId = "episode-program-cut";
    const programFolder = path.join(mockPaths.episodesRoot, episodeId, "Program");
    const sourcePath = path.join(programFolder, "program.webm");
    await fs.mkdir(programFolder, { recursive: true });
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=550:sample_rate=48000",
      "-t", "2", "-c:v", "libvpx", "-c:a", "libopus", "-shortest", sourcePath
    ]);
    const base = createTimelineDraft({ episodeId, durationMs: 2000, deviceDefaults: { cameras: {}, microphones: {} } });
    const draft = {
      ...base,
      editLog: [{
        id: "program-cut",
        type: "delete-section" as const,
        label: "Cut this section",
        timestampMs: 500,
        endTimestampMs: 1500,
        targetTrackId: "program",
        createdAt: "2026-08-15T12:00:00.000Z"
      }]
    };

    const job = await createExport({ episodeId, type: "full-episode-video", qualityPreset: "standard", draft });
    const outputPath = path.join(mockPaths.episodesRoot, episodeId, "Exports", job.outputFileName ?? "");
    const durationMs = await getMediaDurationMs(outputPath);

    expect(job.status).toBe("complete");
    expect(await validatePlayableMedia(outputPath)).toBe(true);
    expect(durationMs).toBeGreaterThan(800);
    expect(durationMs).toBeLessThan(1300);
  }, 30000);

  it("exports the selected range as a vertical social clip", async () => {
    const { createExport } = await import("./export-store");
    const { getMediaDurationMs, runFfmpeg, runFfprobe, validatePlayableMedia } = await import("./ffmpeg-tools");
    const episodeId = "episode-social-clip";
    const programFolder = path.join(mockPaths.episodesRoot, episodeId, "Program");
    const sourcePath = path.join(programFolder, "program.webm");
    await fs.mkdir(programFolder, { recursive: true });
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=550:sample_rate=48000",
      "-t", "2", "-c:v", "libvpx", "-c:a", "libopus", "-shortest", sourcePath
    ]);
    const draft = createTimelineDraft({ episodeId, durationMs: 2000, deviceDefaults: { cameras: {}, microphones: {} } });
    draft.selection = { timestampMs: 500, endTimestampMs: 1500, trackId: "program", source: "timeline" };

    const job = await createExport({ episodeId, type: "social-clip-placeholder", qualityPreset: "standard", draft });
    const outputPath = path.join(mockPaths.episodesRoot, episodeId, "Exports", job.outputFileName ?? "");
    const probe = await runFfprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", outputPath]);
    const streams = (JSON.parse(probe.stdout) as { streams: Array<{ width: number; height: number }> }).streams;

    expect(job.status).toBe("complete");
    expect(job.outputFileName).toBe("what-about-it-social-clip.mp4");
    expect(streams[0]).toEqual({ width: 1080, height: 1920 });
    expect(await getMediaDurationMs(outputPath)).toBeLessThan(1300);
    expect(await validatePlayableMedia(outputPath, undefined, { video: true, audio: true, decode: true })).toBe(true);
  }, 30000);

  it("explains that a social clip needs a selected timeline range", async () => {
    const { createExport } = await import("./export-store");
    const { runFfmpeg } = await import("./ffmpeg-tools");
    const episodeId = "episode-social-missing-range";
    const programFolder = path.join(mockPaths.episodesRoot, episodeId, "Program");
    await fs.mkdir(programFolder, { recursive: true });
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=550:sample_rate=48000", "-t", "0.5", "-c:v", "libvpx", "-c:a", "libopus", "-shortest", path.join(programFolder, "program.webm")]);
    const draft = createTimelineDraft({ episodeId, durationMs: 500, deviceDefaults: { cameras: {}, microphones: {} } });

    const job = await createExport({ episodeId, type: "social-clip-placeholder", qualityPreset: "standard", draft });

    expect(job.status).toBe("error");
    expect(job.error).toBe("clip-range-missing");
    expect(job.message).toContain("Select a timeline range");
  }, 20000);

  it("reports live progress and creates camera masters with their routed microphone", async () => {
    const { createExport } = await import("./export-store");
    const { runFfmpeg, validatePlayableMedia } = await import("./ffmpeg-tools");
    const episodeFolder = path.join(mockPaths.episodesRoot, "episode-multicam");
    const programPath = path.join(episodeFolder, "Program", "program.webm");
    const cameraPath = path.join(episodeFolder, "Cameras", "camera-1.webm");
    const microphonePath = path.join(episodeFolder, "Audio", "morgan-mic.m4a");
    await Promise.all([
      fs.mkdir(path.dirname(programPath), { recursive: true }),
      fs.mkdir(path.dirname(cameraPath), { recursive: true }),
      fs.mkdir(path.dirname(microphonePath), { recursive: true })
    ]);
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=550:sample_rate=48000",
      "-t", "1", "-c:v", "libvpx", "-c:a", "libopus", "-shortest", programPath
    ]);
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24",
      "-t", "1", "-c:v", "libvpx", "-an", cameraPath
    ]);
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "1", "-c:a", "aac", microphonePath
    ]);
    const progress: number[] = [];

    const job = await createExport({
      episodeId: "episode-multicam",
      type: "full-episode-video",
      qualityPreset: "standard",
      deviceDefaults: {
        cameras: { camera1: "camera-a" },
        cameraMicrophones: { camera1: "morganMic" },
        microphones: { morganMic: "mic-a" }
      },
      draft: createTimelineDraft({
        episodeId: "episode-multicam",
        durationMs: 1000,
        deviceDefaults: {
          cameras: { camera1: "camera-a" },
          microphones: { morganMic: "mic-a" }
        }
      })
    }, (next) => progress.push(next.progress));
    const cameraMaster = path.join(episodeFolder, "Exports", "Camera Masters", "camera-1-with-morgan-mic.mp4");

    expect(job.status).toBe("complete");
    expect(job.outputFileNames).toContain(path.join("Camera Masters", "camera-1-with-morgan-mic.mp4"));
    expect(job.outputFileNames).toContain(path.join("Audio Masters", "morgan-mic-edited.wav"));
    expect(job.outputFileNames).toContain("edit-decision-list.json");
    expect(progress[0]).toBe(0);
    expect(progress.some((value) => value > 0 && value < 100)).toBe(true);
    expect(progress.at(-1)).toBe(100);
    expect(await validatePlayableMedia(cameraMaster, undefined, { video: true, audio: true, decode: true })).toBe(true);
  }, 30000);

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

  it("does not export from stray program-folder media when Program/program.webm is missing", async () => {
    const { createExport } = await import("./export-store");
    const { runFfmpeg } = await import("./ffmpeg-tools");
    const programFolder = path.join(mockPaths.episodesRoot, "episode-stray", "Program");
    await fs.mkdir(programFolder, { recursive: true });
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=550:sample_rate=48000",
      "-t",
      "1",
      path.join(programFolder, "stray-source.m4a")
    ]);

    const job = await createExport({
      episodeId: "episode-stray",
      type: "audio-only",
      qualityPreset: "standard",
      draft: createTimelineDraft({ episodeId: "episode-stray", deviceDefaults: { cameras: {}, microphones: {} } })
    });

    expect(job.status).toBe("error");
    expect(job.error).toBe("recording-missing");
  }, 20000);

  it("renders a playable manual draft from two camera sources and two microphone sources", async () => {
    const { createExport } = await import("./export-store");
    const { runFfmpeg, validatePlayableMedia } = await import("./ffmpeg-tools");
    const episodeFolder = path.join(mockPaths.episodesRoot, "episode-edited");
    const sourcePath = path.join(episodeFolder, "Program", "program.webm");
    const cameraOnePath = path.join(episodeFolder, "Cameras", "camera-1.webm");
    const cameraTwoPath = path.join(episodeFolder, "Cameras", "camera-2.webm");
    const morganPath = path.join(episodeFolder, "Audio", "morgan-mic.m4a");
    const guestPath = path.join(episodeFolder, "Audio", "guest-mic.m4a");
    await Promise.all([
      fs.mkdir(path.dirname(sourcePath), { recursive: true }),
      fs.mkdir(path.dirname(cameraOnePath), { recursive: true }),
      fs.mkdir(path.dirname(morganPath), { recursive: true })
    ]);
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
      "2",
      "-c:v",
      "libvpx",
      "-c:a",
      "libopus",
      "-shortest",
      sourcePath
    ]);
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=red:size=320x180:rate=24", "-t", "2", "-c:v", "libvpx", "-an", cameraOnePath]);
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=blue:size=320x180:rate=24", "-t", "2", "-c:v", "libvpx", "-an", cameraTwoPath]);
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "2", "-c:a", "aac", morganPath]);
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000", "-t", "2", "-c:a", "aac", guestPath]);

    const draft = createTimelineDraft({
      episodeId: "episode-edited",
      durationMs: 2000,
      deviceDefaults: {
        cameras: { camera1: "camera-a", camera2: "camera-b" },
        microphones: { morganMic: "mic-a", guestMic: "mic-b" }
      }
    });
    const job = await createExport({
      episodeId: "episode-edited",
      type: "full-episode-video",
      qualityPreset: "standard",
      draft: {
        ...draft,
        cameraDecisions: [
          { id: "camera-a", cameraTrackId: "camera-camera1", startMs: 0, source: "manual", reason: "Open on Morgan" },
          { id: "camera-b", cameraTrackId: "camera-camera2", startMs: 1000, source: "manual", reason: "Cut to Guest" }
        ],
        cameraTransition: "fade",
        cameraTransitionMs: 180,
        tracks: draft.tracks.map((track) => {
          if (track.id === "mic-morganMic") {
            return {
              ...track,
              audioPreset: "broadcast" as const,
              volume: 92,
              pan: -12,
              fadeInMs: 80,
              fadeOutMs: 100,
              noiseReduction: 18,
              noiseGateDb: -58,
              deEsser: 20,
              compression: 35,
              eqLowDb: -1,
              eqMidDb: 2,
              eqHighDb: 1,
              limiterEnabled: true
            };
          }
          if (track.id === "mic-guestMic") {
            return { ...track, audioPreset: "warm" as const, volume: 68, pan: 12, syncOffsetMs: 20 };
          }
          if (track.id === "camera-camera2") {
            return {
              ...track,
              cropMode: "fill" as const,
              brightness: 4,
              contrast: 108,
              saturation: 105,
              temperature: 8,
              tint: -4,
              denoise: 10,
              sharpness: 12,
              zoom: 112,
              positionX: 14,
              positionY: -8
            };
          }
          return track;
        })
      }
    });
    const summary = JSON.parse(await fs.readFile(path.join(mockPaths.episodesRoot, "episode-edited", "Exports", "export-summary.json"), "utf8")) as { message: string };
    const outputPath = path.join(episodeFolder, "Exports", job.outputFileName ?? "");
    const { logger } = await import("./logger");
    const exportError = vi.mocked(logger.error).mock.calls.at(-1);

    expect(job.status, JSON.stringify(exportError)).toBe("complete");
    expect(job.message).toContain("manual draft");
    expect(summary.message).toContain("manual draft");
    expect(job.outputFileNames).toContain(path.join("Audio Masters", "morgan-mic-edited.wav"));
    expect(job.outputFileNames).toContain(path.join("Audio Masters", "guest-mic-edited.wav"));
    expect(job.outputFileNames).toContain("edit-decision-list.json");
    expect(await validatePlayableMedia(outputPath, undefined, { video: true, audio: true, decode: true })).toBe(true);
    expect(await validatePlayableMedia(path.join(episodeFolder, "Exports", "Audio Masters", "morgan-mic-edited.wav"), undefined, { audio: true, decode: true })).toBe(true);
    expect(await validatePlayableMedia(path.join(episodeFolder, "Exports", "Audio Masters", "guest-mic-edited.wav"), undefined, { audio: true, decode: true })).toBe(true);
  }, 30000);

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
