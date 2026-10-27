import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createDefaultPodcastToolsState } from "../shared/podcast-tools";
import { defaultExportSettings } from "../shared/export";
import type { TimelineDraft } from "../shared/timeline";
import type { RecordingServiceSnapshot } from "./services/recording-service";
import { RecordingService } from "./services/recording-service";
import App from "./App";

const capture = vi.hoisted(() => ({ stopped: false, stopReturned: false }));
vi.mock("./components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./components")>();
  return { ...actual, RecordingStudio: ({ onStop, onNext }: { onStop: () => Promise<void>; onNext: () => void }) => <section>
    <button onClick={() => void onStop().then(() => { capture.stopReturned = true; })}>Stop capture</button>
    <button onClick={onNext}>Review recording</button>
  </section> };
});
afterEach(() => { vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });

it("finishes Stop and loads playable Review while cloud save is pending, then preserves Review when it fails", async () => {
  capture.stopped = false; capture.stopReturned = false;
  window.history.replaceState(null, "", "/?view=recording&tour=off");
  const episode = { id: "episode-a", title: "Recording", status: "draft" as const, createdAt: "2026-10-27T12:00:00Z", updatedAt: "2026-10-27T12:00:00Z", folderPath: "C:/episodes/episode-a", phase: "phase-1-shell" as const };
  let rejectSave!: (reason: Error) => void;
  const cloudSave = new Promise<TimelineDraft>((_resolve, reject) => { rejectSave = reject; });
  const loadReviewMedia = vi.fn(async () => ({
    episodeId: episode.id, episodeFolder: episode.folderPath, loadedAt: episode.updatedAt,
    hasPlayableProgram: capture.stopped, message: capture.stopped ? "Saved recording" : "No recording yet",
    program: { id: "program", label: "Program video", kind: "program" as const, relativePath: "Program/program.webm", status: capture.stopped ? "ready" as const : "missing" as const, playbackUrl: capture.stopped ? "http://127.0.0.1/program.webm" : undefined, durationMs: 5000, message: "Recording" }, cameras: [], audio: []
  }));
  window.studio = {
    listEpisodes: vi.fn(async () => [episode]), createEpisode: vi.fn(),
    getSettings: vi.fn(async () => ({ activeThemeId: "what-about-it", defaultEpisodeFolderName: "episodes", practiceModeEnabled: false, deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } }, exportSettings: defaultExportSettings, onboarding: { guidedTour: "never" as const } })),
    saveSettings: vi.fn(), createRecordingSession: vi.fn(), writeRecordingState: vi.fn(), saveProgramRecording: vi.fn(), saveRecordedTracks: vi.fn(), appendRecordingError: vi.fn(),
    listUnfinishedRecordingSessions: vi.fn(async () => []),
    loadPodcastTools: vi.fn(async () => createDefaultPodcastToolsState(episode.id)), savePodcastTools: vi.fn(async (_id, tools) => tools), loadTimelineDraft: vi.fn(async () => null), saveTimelineDraft: vi.fn(() => cloudSave),
    loadReviewMedia, runAutoEdit: vi.fn(), createExport: vi.fn(), getMediaToolsStatus: vi.fn(async () => ({ ready: true, message: "Media tools are ready" as const })), cancelExport: vi.fn(), openExportFolder: vi.fn(), createDiagnosticsBundle: vi.fn(), getStorageStatus: vi.fn(async () => ({ availableBytes: 100 * 1024 ** 3, message: "Storage check ready" as const }))
  };
  const stopped: RecordingServiceSnapshot = { status: "stopped", elapsedMs: 5000, localSaveMessage: "Recording saved and verified", trackStatuses: [], session: { id: "session-a", episodeId: episode.id, episodeTitle: episode.title, folderPath: episode.folderPath, startedAt: episode.createdAt, status: "stopped", practice: false }, integrity: { checkedAt: episode.updatedAt, playable: true, programPlayable: true, savedSourceCount: 2, expectedSourceCount: 2, warnings: [] } };
  vi.spyOn(RecordingService.prototype, "stop").mockImplementation(async () => { capture.stopped = true; return stopped; });
  const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<App />));
    const loadsBeforeStop = loadReviewMedia.mock.calls.length;
    await act(async () => { [...host.querySelectorAll("button")].find(e => e.textContent === "Stop capture")!.click(); });
    expect(capture.stopReturned).toBe(true);
    expect(loadReviewMedia.mock.calls.length).toBeGreaterThan(loadsBeforeStop);
    await act(async () => { [...host.querySelectorAll("button")].find(e => e.textContent === "Review recording")!.click(); });
    expect(host.querySelector('[aria-label="Synchronized episode timeline"]')).not.toBeNull();
    expect(host.querySelector('video[src="http://127.0.0.1/program.webm"]')).not.toBeNull();
    await act(async () => { rejectSave(new Error("Cloud edit ownership unavailable")); });
    expect(host.textContent).toContain("Save failed — retry");
    expect(host.querySelector('[aria-label="Synchronized episode timeline"]')).not.toBeNull();
  } finally { act(() => root.unmount()); host.remove(); }
});
