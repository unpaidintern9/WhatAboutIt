import { describe, expect, it, vi } from "vitest";
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
    appendRecordingError: vi.fn(),
    listUnfinishedRecordingSessions: vi.fn(),
    loadPodcastTools: vi.fn(),
    savePodcastTools: vi.fn(),
    loadTimelineDraft: vi.fn(),
    saveTimelineDraft: vi.fn(),
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
    stop: vi.fn(async () => ({ bytes: [1, 2, 3], mimeType: "video/webm" }))
  };
}

describe("RecordingService", () => {
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
});
