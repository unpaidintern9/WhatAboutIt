import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordingTrackSaveInput } from "../../shared/recording";
import type { RecordingEnginePlugin } from "../plugins/recording/types";
import { RecordingService } from "./recording-service";

function installStudioMock() {
  window.studio = {
    listEpisodes: vi.fn(),
    createEpisode: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    createRecordingSession: vi.fn(async () => ({
      id: "session-a",
      episodeId: "episode-a",
      episodeTitle: "Studio Recording",
      folderPath: "C:/recording/episode-a",
      startedAt: "2026-06-27T10:00:00.000Z",
      status: "recording" as const,
      practice: false
    })),
    writeRecordingState: vi.fn(async (_folderPath, state) => state),
    saveProgramRecording: vi.fn(async () => "C:/recording/episode-a/Program/program.webm"),
    saveRecordedTracks: vi.fn(async (_folderPath, tracks: RecordingTrackSaveInput[]) =>
      tracks.map((track) => ({ slot: track.slot, kind: track.kind, status: "saved" as const, filePath: `C:/recording/episode-a/${track.slot}`, message: "Saved" }))
    ),
    appendRecordingError: vi.fn(),
    listUnfinishedRecordingSessions: vi.fn(),
    loadPodcastTools: vi.fn(),
    savePodcastTools: vi.fn(),
    loadTimelineDraft: vi.fn(),
    saveTimelineDraft: vi.fn(),
    loadReviewMedia: vi.fn(),
    runAutoEdit: vi.fn(),
    createExport: vi.fn(),
    getMediaToolsStatus: vi.fn(async () => ({ ready: true, message: "Media tools are ready" as const })),
    cancelExport: vi.fn(),
    openExportFolder: vi.fn(),
    createDiagnosticsBundle: vi.fn(async () => ({ folderPath: "diagnostics", files: [] })),
    getStorageStatus: vi.fn(async () => ({ message: "Storage check ready" as const, availableBytes: 1024 }))
  };
}

function createPlugin(): RecordingEnginePlugin {
  return {
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "video/webm" }))
  };
}

describe("RecordingService", () => {
  afterEach(() => vi.useRealTimers());

  it("moves through start, pause, resume, and stop", async () => {
    installStudioMock();
    const plugin = createPlugin();
    const service = new RecordingService(plugin);
    const defaults = { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } };

    expect((await service.start(defaults, { episodeId: "episode-a", episodeTitle: "Studio Recording" })).status).toBe("recording");
    expect((await service.pause()).status).toBe("paused");
    expect((await service.resume()).status).toBe("recording");
    expect((await service.stop()).status).toBe("stopped");
    expect(window.studio.saveProgramRecording).toHaveBeenCalled();
  });

  it("reports the active program and source recorder health", async () => {
    installStudioMock();
    const plugin: RecordingEnginePlugin = {
      ...createPlugin(),
      getHealth: () => ({
        programActive: true,
        activeCameraTracks: 2,
        activeAudioTracks: 2,
        expectedCameraTracks: 2,
        expectedAudioTracks: 2,
        warnings: [],
        sources: []
      })
    };
    const service = new RecordingService(plugin);

    const snapshot = await service.start({ cameras: { camera1: "camera-a", camera2: "camera-b" }, microphones: { morganMic: "mic-a", guestMic: "mic-b" } });

    expect(snapshot.health?.programActive).toBe(true);
    expect(snapshot.localSaveMessage).toBe("Program plus 4 source tracks are starting their disk writers");
  });

  it("stops safely when selected sources never write their first media chunk", async () => {
    vi.useFakeTimers();
    installStudioMock();
    const plugin: RecordingEnginePlugin = {
      ...createPlugin(),
      getHealth: () => ({
        programActive: true,
        activeCameraTracks: 0,
        activeAudioTracks: 0,
        expectedCameraTracks: 1,
        expectedAudioTracks: 1,
        warnings: [],
        sources: [{
          target: "program",
          kind: "program",
          active: true,
          firstChunkReceived: false,
          bytesWritten: 0,
          message: "Starting disk writer"
        }]
      })
    };
    const service = new RecordingService(plugin);

    await service.start({ cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } });
    await vi.advanceTimersByTimeAsync(8001);

    expect(plugin.stop).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot()).toMatchObject({
      status: "stopped",
      friendlyError: expect.stringContaining("program did not write media")
    });
    expect(window.studio.appendRecordingError).toHaveBeenCalledWith(
      "C:/recording/episode-a",
      expect.stringContaining("run Quick Test again")
    );
  });

  it("saves separate recorder tracks after the Program recording", async () => {
    installStudioMock();
    const plugin: RecordingEnginePlugin = {
      start: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "video/webm",
        tracks: [
          { slot: "camera2", kind: "camera", bytes: new Uint8Array([4, 5]), mimeType: "video/webm" },
          { slot: "guestMic", kind: "audio", bytes: new Uint8Array([6, 7]), mimeType: "audio/webm" }
        ] satisfies RecordingTrackSaveInput[]
      }))
    };
    const service = new RecordingService(plugin);

    await service.start({ cameras: { camera1: "camera-a", camera2: "camera-b" }, microphones: { morganMic: "mic-a", guestMic: "mic-b" } });
    const snapshot = await service.stop();

    expect(window.studio.saveProgramRecording).toHaveBeenCalledTimes(1);
    expect(window.studio.saveRecordedTracks).toHaveBeenCalledWith("C:/recording/episode-a", [
      { slot: "camera2", kind: "camera", bytes: new Uint8Array([4, 5]), mimeType: "video/webm" },
      { slot: "guestMic", kind: "audio", bytes: new Uint8Array([6, 7]), mimeType: "audio/webm" }
    ]);
    expect(snapshot.trackStatuses).toEqual([
      { slot: "camera2", kind: "camera", status: "saved", filePath: "C:/recording/episode-a/camera2", message: "Saved" },
      { slot: "guestMic", kind: "audio", status: "saved", filePath: "C:/recording/episode-a/guestMic", message: "Saved" }
    ]);
  });

  it("simulates practice mode without media bytes", async () => {
    installStudioMock();
    const plugin: RecordingEnginePlugin = {
      start: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(async () => ({ warning: "Practice only" }))
    };
    const service = new RecordingService(plugin);

    expect((await service.start({ cameras: {}, microphones: {} }, { practice: true })).status).toBe("recording");
    expect((await service.stop()).status).toBe("stopped");
    expect(window.studio.saveProgramRecording).not.toHaveBeenCalled();
  });

  it("shows a friendly camera status when capture cannot start", async () => {
    installStudioMock();
    const plugin: RecordingEnginePlugin = {
      start: vi.fn(async () => {
        throw new Error("Camera needs attention");
      }),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn()
    };
    const service = new RecordingService(plugin);
    const snapshot = await service.start({ cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } });

    expect(snapshot.status).toBe("error");
    expect(snapshot.friendlyError).toBe("Camera needs attention");
    expect(window.studio.appendRecordingError).toHaveBeenCalledWith("C:/recording/episode-a", "Camera needs attention");
  });

  it("shows a friendly mic status when capture cannot start", async () => {
    installStudioMock();
    const plugin: RecordingEnginePlugin = {
      start: vi.fn(async () => {
        throw new Error("Mic needs attention");
      }),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn()
    };
    const service = new RecordingService(plugin);
    const snapshot = await service.start({ cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } });

    expect(snapshot.status).toBe("error");
    expect(snapshot.friendlyError).toBe("Mic needs attention");
    expect(window.studio.appendRecordingError).toHaveBeenCalledWith("C:/recording/episode-a", "Mic needs attention");
  });

  it("shuts down the active recording plugin on app cleanup", async () => {
    installStudioMock();
    const plugin = { ...createPlugin(), shutdown: vi.fn() };
    const service = new RecordingService(plugin);

    await service.start({ cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } });
    await service.shutdown();

    expect(plugin.shutdown).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().status).toBe("interrupted");
  });
});
