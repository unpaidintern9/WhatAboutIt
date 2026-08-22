import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { defaultExportSettings } from "../shared/export";
import { createDefaultPodcastToolsState } from "../shared/podcast-tools";
import { createTimelineDraft } from "../shared/timeline";
import type { EpisodeMetadata } from "../shared/types";

function episode(id: string): EpisodeMetadata {
  return {
    id,
    title: `Episode ${id}`,
    status: "draft",
    createdAt: "2026-06-27T10:00:00.000Z",
    updatedAt: "2026-06-27T10:00:00.000Z",
    folderPath: id,
    phase: "phase-1-shell"
  };
}

function reviewMedia(episodeId: string) {
  return {
    episodeId,
    episodeFolder: episodeId,
    loadedAt: "2026-06-27T10:00:00.000Z",
    hasPlayableProgram: true,
    message: "Review your recording",
    program: {
      id: "program",
      label: "Program video",
      kind: "program" as const,
      relativePath: "Program/program.webm",
      playbackUrl: `wai-media://episode/${episodeId}/program`,
      posterUrl: `wai-media://episode/${episodeId}/poster`,
      filmstripUrl: `wai-media://episode/${episodeId}/filmstrip`,
      status: "ready" as const,
      durationMs: 30000,
      message: "Ready to review"
    },
    cameras: [],
    audio: []
  };
}

describe("episode workspace loading", () => {
  it("ignores a slow response from the previously active episode", async () => {
    window.history.replaceState(null, "", "/?view=home&tour=off");
    const episodes = [episode("episode-a"), episode("episode-b")];
    let resolveEpisodeA!: (draft: ReturnType<typeof createTimelineDraft>) => void;
    const episodeADraft = new Promise<ReturnType<typeof createTimelineDraft>>((resolve) => {
      resolveEpisodeA = resolve;
    });
    window.studio = {
      listEpisodes: vi.fn(async () => episodes),
      createEpisode: vi.fn(),
      getSettings: vi.fn(async () => ({
        activeThemeId: "what-about-it",
        defaultEpisodeFolderName: "episodes",
        practiceModeEnabled: false,
        exportSettings: defaultExportSettings,
        deviceDefaults: { cameras: {}, microphones: {} },
        onboarding: { guidedTour: "never" as const }
      })),
      saveSettings: vi.fn(async (settings) => settings),
      createRecordingSession: vi.fn(),
      writeRecordingState: vi.fn(),
      saveProgramRecording: vi.fn(),
      saveRecordedTracks: vi.fn(async () => []),
      appendRecordingError: vi.fn(),
      listUnfinishedRecordingSessions: vi.fn(async () => []),
      loadPodcastTools: vi.fn(async (episodeId) => createDefaultPodcastToolsState(episodeId)),
      savePodcastTools: vi.fn(async (_episodeId, state) => state),
      loadTimelineDraft: vi.fn(async (episodeId) => {
        if (episodeId === "episode-a") return episodeADraft;
        return createTimelineDraft({
          episodeId,
          deviceDefaults: { cameras: {}, microphones: {} },
          markers: [{ id: "marker-b", label: "Episode B marker", timestampMs: 1000, createdAt: "2026-06-27T10:00:00.000Z" }]
        });
      }),
      saveTimelineDraft: vi.fn(async (_episodeId, draft) => draft),
      loadReviewMedia: vi.fn(async (episodeId) => reviewMedia(episodeId)),
      runAutoEdit: vi.fn(),
      createExport: vi.fn(),
      getMediaToolsStatus: vi.fn(async () => ({ ready: true, message: "Media tools are ready" as const })),
      cancelExport: vi.fn(),
      openExportFolder: vi.fn(),
      createDiagnosticsBundle: vi.fn(async () => ({ folderPath: "diagnostics", files: [] })),
      getStorageStatus: vi.fn(async () => ({ message: "Storage check ready" as const, availableBytes: 1024 }))
    };

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<App />);
    });

    const openEpisodeB = host.querySelector('button[title="Open Episode episode-b"]');
    await act(async () => {
      openEpisodeB?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).toContain("Episode B marker");

    await act(async () => {
      resolveEpisodeA(
        createTimelineDraft({
          episodeId: "episode-a",
          deviceDefaults: { cameras: {}, microphones: {} },
          markers: [{ id: "marker-a", label: "Stale Episode A marker", timestampMs: 1000, createdAt: "2026-06-27T10:00:00.000Z" }]
        })
      );
    });
    expect(host.textContent).toContain("Episode B marker");
    expect(host.textContent).not.toContain("Stale Episode A marker");

    act(() => root.unmount());
    host.remove();
  });
});
