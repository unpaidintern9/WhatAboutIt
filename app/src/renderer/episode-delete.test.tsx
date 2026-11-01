import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { defaultExportSettings } from "../shared/export";
import { createDefaultPodcastToolsState } from "../shared/podcast-tools";
import { createTimelineDraft } from "../shared/timeline";
import type { EpisodeMetadata } from "../shared/types";

describe("episode deletion from the library", () => {
  it.each([true, false, "error"] as const)("handles deletion result %s without opening the episode", async (result) => {
    window.history.replaceState(null, "", "/?view=home&tour=off");
    const episodes: EpisodeMetadata[] = ["a", "b"].map((id) => ({ id, title: `Interview ${id}`, status: "draft", createdAt: "2026-06-27T10:00:00Z", updatedAt: "2026-06-27T10:00:00Z", folderPath: id, phase: "phase-1-shell" }));
    const deleteEpisode = vi.fn(async () => { if (result === "error") throw new Error("Finish recording before deleting"); return result; });
    window.studio = {
      listEpisodes: vi.fn(async () => episodes), deleteEpisode, createEpisode: vi.fn(),
      getSettings: vi.fn(async () => ({ activeThemeId: "what-about-it", defaultEpisodeFolderName: "episodes", practiceModeEnabled: false, exportSettings: defaultExportSettings, deviceDefaults: { cameras: {}, microphones: {} }, onboarding: { guidedTour: "never" as const } })),
      saveSettings: vi.fn(async (settings) => settings), createRecordingSession: vi.fn(), writeRecordingState: vi.fn(), saveProgramRecording: vi.fn(), saveRecordedTracks: vi.fn(async () => []), appendRecordingError: vi.fn(), listUnfinishedRecordingSessions: vi.fn(async () => []),
      loadPodcastTools: vi.fn(async (id) => createDefaultPodcastToolsState(id)), savePodcastTools: vi.fn(async (_id, state) => state),
      loadTimelineDraft: vi.fn(async (id) => createTimelineDraft({ episodeId: id, deviceDefaults: { cameras: {}, microphones: {} } })), saveTimelineDraft: vi.fn(async (_id, draft) => draft),
      loadReviewMedia: vi.fn(async (id) => ({ episodeId: id, episodeFolder: id, loadedAt: "2026-06-27T10:00:00Z", hasPlayableProgram: false, message: "No recording", program: { id: "program", label: "Program", kind: "program" as const, relativePath: "Program/program.webm", status: "missing" as const, message: "No recording" }, cameras: [], audio: [] })),
      runAutoEdit: vi.fn(), createExport: vi.fn(), getMediaToolsStatus: vi.fn(async () => ({ ready: true, message: "Media tools are ready" as const })), cancelExport: vi.fn(), openExportFolder: vi.fn(), createDiagnosticsBundle: vi.fn(async () => ({ folderPath: "diagnostics", files: [] })), getStorageStatus: vi.fn(async () => ({ message: "Storage check ready" as const, availableBytes: 100 * 1024 ** 3 }))
    };
    const host = document.createElement("div"); document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => { root.render(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
      const button = host.querySelector<HTMLButtonElement>('[aria-label="Delete episode Interview a"]')!;
      expect(button).toBeTruthy();
      await act(async () => { button.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(deleteEpisode).toHaveBeenCalledWith("a");
      expect(Boolean(host.querySelector('button[title="Open Interview a"]'))).toBe(result !== true);
      expect(host.querySelector('button[title="Open Interview b"]')).toBeTruthy();
      expect(host.querySelector('[aria-label="Synchronized episode timeline"]')).toBeNull();
      if (result === "error") expect(host.querySelector('[role="alert"]')?.textContent).toContain("Finish recording");
    } finally { act(() => root.unmount()); host.remove(); }
  });
});
