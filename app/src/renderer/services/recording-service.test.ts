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
    createExport: vi.fn(),
    cancelExport: vi.fn(),
    openExportFolder: vi.fn()
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
});
