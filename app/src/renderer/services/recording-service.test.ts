import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordingTrackSaveInput } from "../../shared/recording";
import type { RecordingEnginePlugin, RecordingEngineResult } from "../plugins/recording/types";
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
    expect(service.selectEpisode("next-episode")).toMatchObject({ status: "idle", elapsedMs: 0, session: undefined });
  });

  it("explains when an existing episode is protected from another recording", async () => {
    installStudioMock();
    window.studio.createRecordingSession = vi.fn(async () => {
      throw new Error("This episode already contains recording media. Create a new episode before recording so the existing episode stays protected.");
    });
    const plugin = createPlugin();
    const service = new RecordingService(plugin);

    const snapshot = await service.start(
      { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } },
      { episodeId: "episode-protected", episodeTitle: "Protected Recording" }
    );

    expect(snapshot).toMatchObject({
      status: "error",
      friendlyError: "This episode already has a recording. Create a new episode before recording so the existing episode stays protected."
    });
    expect(plugin.start).not.toHaveBeenCalled();
  });

  it("coalesces repeated Stop actions into one recorder finalization", async () => {
    installStudioMock();
    let finishStop: ((result: RecordingEngineResult) => void) | undefined;
    const plugin = createPlugin();
    plugin.stop = vi.fn(() => new Promise<RecordingEngineResult>((resolve) => {
      finishStop = resolve;
    }));
    const service = new RecordingService(plugin);
    await service.start({ cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } });

    const firstStop = service.stop();
    const secondStop = service.stop();
    await vi.waitFor(() => expect(plugin.stop).toHaveBeenCalledTimes(1));

    finishStop?.({ bytes: new Uint8Array([1]), mimeType: "video/webm" });
    const [firstSnapshot, secondSnapshot] = await Promise.all([firstStop, secondStop]);
    expect(firstSnapshot.status).toBe("stopped");
    expect(secondSnapshot.status).toBe("stopped");
    expect(window.studio.saveProgramRecording).toHaveBeenCalledTimes(1);
  });

  it("saves a durable pause, allows shutdown, and resumes the same episode after recreation", async () => {
    installStudioMock();
    const session = { id: "saved-session", episodeId: "saved-episode", episodeTitle: "Interview", folderPath: "C:/episodes/saved-episode", captureFolderPath: "C:/episodes/saved-episode/Recordings/part-1", startedAt: "2026-06-27T10:00:00.000Z", status: "recording" as const, practice: false, elapsedMs: 0 };
    window.studio.createRecordingSession = vi.fn(async (input) => ({ ...session, elapsedMs: input.resume ? 9300 : 0 }));
    window.studio.checkpointRecordingSession = vi.fn(async () => ({ session: { ...session, status: "paused" as const, durablePaused: true, elapsedMs: 9300 } }));
    const defaults = { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } };
    const plugin = createPlugin();
    const first = new RecordingService(plugin);
    await first.start(defaults, { episodeId: session.episodeId });
    const saved = await first.pause();
    expect(plugin.stop).toHaveBeenCalledTimes(1);
    expect(saved).toMatchObject({ status: "paused", elapsedMs: 9300, session: { durablePaused: true } });
    expect(saved.localSaveMessage).toContain("close the app");
    await first.shutdown();
    expect(vi.mocked(window.studio.writeRecordingState).mock.calls.some((call) => call[1].status === "interrupted")).toBe(false);
    const reopenedPlugin = createPlugin();
    const reopened = new RecordingService(reopenedPlugin);
    expect(reopened.restorePaused(saved.session!).elapsedMs).toBe(9300);
    const continued = await reopened.resumeSaved(saved.session!, defaults);
    expect(window.studio.createRecordingSession).toHaveBeenLastCalledWith(expect.objectContaining({ episodeId: session.episodeId, resume: true }));
    expect(continued).toMatchObject({ status: "recording", session: { id: session.id, folderPath: session.folderPath } });
    expect(continued.elapsedMs).toBeGreaterThanOrEqual(9300);
    expect(reopenedPlugin.start).toHaveBeenCalledTimes(1);
    await reopened.shutdown();
  });

  it("passes recorder warnings and unavailable tracks into durable checkpointing", async () => {
    installStudioMock(); const session = { id: "warning-session", episodeId: "warning-episode", folderPath: "/episode", captureFolderPath: "/episode/Recordings/part-1" };
    window.studio.createRecordingSession = vi.fn(async () => session as never);
    window.studio.checkpointRecordingSession = vi.fn(async () => ({ session: { ...session, status: "stopped", elapsedMs: 1000 } } as never));
    const plugin = createPlugin(); vi.mocked(plugin.stop).mockResolvedValue({ persisted: true, warning: "Recorder stop event timed out", tracks: [{ slot: "guestMic", kind: "audio", status: "needs-attention", message: "Guest mic never opened" }] });
    const service = new RecordingService(plugin); await service.start({ cameras: {}, microphones: {} }); await service.stop();
    expect(window.studio.checkpointRecordingSession).toHaveBeenLastCalledWith("/episode", false, ["Recorder stop event timed out", "guestMic: Guest mic never opened"]);
  });

  it("prevents episode switches during capture and save transitions", async () => {
    installStudioMock();
    const plugin = createPlugin();
    const service = new RecordingService(plugin);
    await service.start({ cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } });
    expect(() => service.selectEpisode("different-episode")).toThrow("Pause and save");
    const finishing = service.stop();
    expect(() => service.selectEpisode("different-episode")).toThrow("Pause and save");
    await finishing;
    expect(service.selectEpisode("different-episode").session).toBeUndefined();
  });

  it("marks a stopped capture recoverable when the recorder throws during Stop", async () => {
    installStudioMock();
    const plugin = createPlugin();
    plugin.stop = vi.fn(async () => {
      throw new Error("Chromium recorder failed during stop");
    });
    const service = new RecordingService(plugin);
    await service.start({ cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } });

    const snapshot = await service.stop();

    expect(snapshot).toMatchObject({
      status: "error",
      friendlyError: "The recording stopped, but some files still need recovery."
    });
    expect(window.studio.appendRecordingError).toHaveBeenCalledWith(
      "C:/recording/episode-a",
      expect.stringContaining("Chromium recorder failed during stop")
    );
  });

  it("still stops media after a prior state-file write failed", async () => {
    vi.useFakeTimers(); installStudioMock(); const plugin = createPlugin(); const service = new RecordingService(plugin);
    await service.start({ cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } });
    vi.mocked(window.studio.writeRecordingState).mockRejectedValueOnce(new Error("EPERM state file"));
    await vi.advanceTimersByTimeAsync(3000);
    const result = await service.stop();
    expect(plugin.stop).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("stopped");
    await service.shutdown();
  });
  it("returns a recoverable error even when both error and state logs cannot write, then permits retry", async () => {
    installStudioMock(); const plugin = createPlugin(); const service = new RecordingService(plugin);
    window.studio.setRecordingCloseProtection = vi.fn();
    await service.start({ cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } });
    vi.mocked(plugin.stop).mockRejectedValueOnce(new Error("disk stalled"));
    vi.mocked(window.studio.appendRecordingError).mockRejectedValue(new Error("disk full"));
    vi.mocked(window.studio.writeRecordingState).mockRejectedValueOnce(new Error("disk full"));
    await expect(service.stop()).resolves.toMatchObject({ status: "error" });
    expect(window.studio.setRecordingCloseProtection).toHaveBeenLastCalledWith(false);
    await expect(service.stop()).resolves.toMatchObject({ status: "stopped" });
  });
  it("waits for an in-progress Start before honoring Stop", async () => {
    installStudioMock(); let ready!: () => void; const plugin = createPlugin();
    vi.mocked(plugin.start).mockImplementation(() => new Promise<void>((resolve) => { ready = resolve; }));
    const service = new RecordingService(plugin); const starting = service.start({ cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } });
    await Promise.resolve(); const stopping = service.stop(); ready();
    await starting; await stopping;
    expect(plugin.stop).toHaveBeenCalledTimes(1); expect(service.getSnapshot().status).toBe("stopped");
  });
  it("does not write a failed new Start into the previous episode", async () => {
    installStudioMock(); const plugin = createPlugin(); const service = new RecordingService(plugin);
    await service.start({ cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } }); await service.stop();
    vi.mocked(window.studio.writeRecordingState).mockClear();
    vi.mocked(window.studio.createRecordingSession).mockRejectedValueOnce(new Error("new episode unavailable"));
    const result = await service.start({ cameras: {}, microphones: {} }, { episodeId: "new-episode" });
    expect(result.session).toBeUndefined(); expect(window.studio.writeRecordingState).not.toHaveBeenCalled();
    expect(window.studio.appendRecordingError).not.toHaveBeenCalled();
  });

  it("keeps elapsed recording time monotonic when the Windows clock changes", async () => {
    vi.useFakeTimers(); installStudioMock(); const service = new RecordingService(createPlugin());
    await service.start({ cameras: { camera1: "camera" }, microphones: { morganMic: "mic" } });
    vi.setSystemTime(Date.now() - 300000); await vi.advanceTimersByTimeAsync(1000);
    expect(service.getSnapshot().elapsedMs).toBe(1000); await service.stop();
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

  it("keeps the Program recording active when only optional isolated sources fail", async () => {
    vi.useFakeTimers();
    installStudioMock();
    const plugin: RecordingEnginePlugin = {
      ...createPlugin(),
      getHealth: () => ({
        programActive: true,
        activeCameraTracks: 1,
        activeAudioTracks: 0,
        expectedCameraTracks: 2,
        expectedAudioTracks: 1,
        warnings: ["camera2: Source stopped", "morganMic: Source stopped"],
        sources: [
          {
            target: "program",
            kind: "program",
            active: true,
            firstChunkReceived: true,
            bytesWritten: 2048,
            lastChunkAt: "2026-08-21T10:00:00.000Z",
            message: "Writing to disk"
          },
          {
            target: "camera2",
            kind: "camera",
            active: false,
            firstChunkReceived: false,
            bytesWritten: 0,
            message: "Source stopped"
          }
        ]
      })
    };
    const service = new RecordingService(plugin);

    await service.start({ cameras: { camera1: "camera-a", camera2: "camera-b" }, microphones: { morganMic: "mic-a" } });
    await vi.advanceTimersByTimeAsync(8001);

    expect(plugin.stop).not.toHaveBeenCalled();
    expect(service.getSnapshot().status).toBe("recording");
    await service.shutdown();
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

  it("keeps a verified Program playable when an optional recorder track is unavailable", async () => {
    installStudioMock();
    window.studio.finalizeRecordingMedia = vi.fn(async () => ({
      programPath: "C:/recording/episode-a/Program/program.webm",
      tracks: [],
      integrity: {
        checkedAt: "2026-08-22T12:00:00.000Z",
        playable: true,
        programPlayable: true,
        savedSourceCount: 0,
        expectedSourceCount: 0,
        warnings: []
      }
    }));
    const plugin: RecordingEnginePlugin = {
      ...createPlugin(),
      stop: vi.fn(async () => ({
        persisted: true,
        tracks: [{ slot: "guestMic", kind: "audio", status: "needs-attention", message: "No audible signal" }] satisfies RecordingTrackSaveInput[]
      }))
    };
    const service = new RecordingService(plugin);

    await service.start({ cameras: { camera1: "camera-a" }, microphones: { guestMic: "mic-b" } });
    const snapshot = await service.stop();

    expect(snapshot.integrity).toMatchObject({
      playable: true,
      programPlayable: true,
      savedSourceCount: 0,
      expectedSourceCount: 1,
      warnings: ["guestMic: No audible signal"]
    });
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
    expect(window.studio.appendRecordingError).toHaveBeenCalledWith(
      "C:/recording/episode-a",
      expect.stringContaining("Camera needs attention Startup detail: Error: Camera needs attention")
    );
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
    expect(window.studio.appendRecordingError).toHaveBeenCalledWith(
      "C:/recording/episode-a",
      expect.stringContaining("Mic needs attention Startup detail: Error: Mic needs attention")
    );
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
