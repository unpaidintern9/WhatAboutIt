import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import type { EpisodeMetadata, StudioSettings } from "../shared/types";
import { createDefaultPodcastToolsState } from "../shared/podcast-tools";
import { createTimelineDraft } from "../shared/timeline";
import { defaultExportSettings } from "../shared/export";
import { runOfflineAutoEdit } from "../shared/auto-edit";

describe("Phase 5C flow", () => {
  it("smoke tests the full MVP flow surfaces from launch to export", async () => {
    const routes = [
      ["home", "Ready when you are."],
      ["new-episode", "New Episode"],
      ["device-setup", "Let's check your studio"],
      ["recording", "Everything is saving locally"],
      ["timeline-review", "Edit Studio"],
      ["auto-edit-review", "Auto Edit"],
      ["export", "Export your episode"]
    ];

    for (const [view, expectedCopy] of routes) {
      window.history.replaceState(null, "", `/?view=${view}&tour=off`);
      Reflect.deleteProperty(window, "studio");
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);

      await act(async () => {
        root.render(<App />);
      });

      expect(host.textContent).toContain(expectedCopy);
      expect(host.textContent).not.toContain("FFmpeg");
      expect(host.textContent).not.toContain("codec");
      root.unmount();
      host.remove();
    }
  });

  it("renders the Review Episode route with safe draft editing controls", async () => {
    window.history.replaceState(null, "", "/?view=timeline-review&tour=off");
    const episode: EpisodeMetadata = {
      id: "episode-a",
      title: "Review Episode",
      status: "draft",
      createdAt: "2026-06-27T10:00:00.000Z",
      updatedAt: "2026-06-27T10:00:00.000Z",
      folderPath: "episode-a",
      phase: "phase-1-shell"
    };
    const settings: StudioSettings = {
      activeThemeId: "what-about-it",
      defaultEpisodeFolderName: "episodes",
      practiceModeEnabled: false,
      exportSettings: defaultExportSettings,
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } },
      onboarding: { guidedTour: "never" }
    };
    window.studio = {
      listEpisodes: vi.fn(async () => [episode]),
      createEpisode: vi.fn(),
      getSettings: vi.fn(async () => settings),
      saveSettings: vi.fn(),
      createRecordingSession: vi.fn(),
      writeRecordingState: vi.fn(),
      saveProgramRecording: vi.fn(),
      saveRecordedTracks: vi.fn(async () => []),
      appendRecordingError: vi.fn(),
      listUnfinishedRecordingSessions: vi.fn(async () => []),
      loadPodcastTools: vi.fn(async () => createDefaultPodcastToolsState("episode-a")),
      savePodcastTools: vi.fn(async (_episodeId, state) => state),
      loadTimelineDraft: vi.fn(async () =>
        createTimelineDraft({
          episodeId: "episode-a",
          deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } },
          markers: [{ id: "marker-a", label: "Funny", timestampMs: 12000, createdAt: "2026-06-27T10:00:00.000Z" }]
        })
      ),
      saveTimelineDraft: vi.fn(async (_episodeId, draft) => draft),
      loadReviewMedia: vi.fn(async (episodeId) => ({
        episodeId,
        episodeFolder: `C:/episodes/${episodeId}`,
        loadedAt: "2026-06-28T12:00:00.000Z",
        hasPlayableProgram: false,
        message: "No program video found yet",
        program: {
          id: "program",
          label: "Program video",
          kind: "program" as const,
          relativePath: "Program/program.webm",
          status: "missing" as const,
          message: "No program video found yet"
        },
        cameras: [],
        audio: []
      })),
      runAutoEdit: vi.fn(async (episodeId, draft, mode) => runOfflineAutoEdit({ episodeId, draft, mode, now: "2026-06-27T10:00:00.000Z" })),
      createExport: vi.fn(async (request) => ({
        id: "job-a",
        episodeId: request.episodeId,
        type: request.type,
        qualityPreset: request.qualityPreset,
        status: "complete" as const,
        progress: 100,
        createdAt: "2026-06-27T10:00:00.000Z",
        updatedAt: "2026-06-27T10:05:00.000Z",
        outputFolder: "Episode/Exports",
        message: "Export complete"
      })),
      getMediaToolsStatus: vi.fn(async () => ({ ready: true, message: "Media tools are ready" as const })),
      cancelExport: vi.fn(async (_episodeId, job) => job),
      openExportFolder: vi.fn(async () => "Episode/Exports"),
      createDiagnosticsBundle: vi.fn(async () => ({ folderPath: "diagnostics", files: [] })),
      getStorageStatus: vi.fn(async () => ({ message: "Storage check ready" as const, availableBytes: 1024 }))
    };

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<App />);
    });

    expect(host.textContent).toContain("Edit Studio");
    expect(host.textContent).toContain("Originals always stay untouched");
    expect(host.textContent).toContain("Auto Edit");
    expect(host.textContent).toContain("Source monitor");
    expect(host.textContent).toContain("Delete range");
    expect(host.querySelector('input[aria-label="Timeline zoom"]')).toBeTruthy();
    expect(host.textContent).toContain("Trim start");
    expect(host.textContent).toContain("Split");
    expect(host.textContent).toContain("Restore");
    expect(host.textContent).toContain("Edit history");
    expect(host.textContent).toContain("Export");
    expect(host.textContent).toContain("Funny");
    expect(host.textContent).not.toContain("Auto Edit is still locked");
  });

  it("renders Auto Edit review with report results", async () => {
    window.history.replaceState(null, "", "/?view=auto-edit-review&tour=off");
    Reflect.deleteProperty(window, "studio");

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<App />);
    });

    expect(host.textContent).toContain("Auto Edit");
    expect(host.textContent).toContain("Gentle");
    expect(host.textContent).toContain("Balanced");
    expect(host.textContent).toContain("Originals stay untouched");
  });

  it("renders the Export route with clear local options", async () => {
    window.history.replaceState(null, "", "/?view=export&tour=off");
    Reflect.deleteProperty(window, "studio");

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<App />);
    });

    expect(host.textContent).toContain("Export your episode");
    expect(host.textContent).toContain("Full Episode Video");
    expect(host.textContent).toContain("Ready for YouTube");
    expect(host.textContent).toContain("Audio Only");
    expect(host.textContent).toContain("Your original recording stays safe");
  });

  it("renders safe editing practice guidance", async () => {
    window.history.replaceState(null, "", "/?view=practice&tour=off");
    Reflect.deleteProperty(window, "studio");

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<App />);
    });

    expect(host.textContent).toContain("Practice Mode");
    expect(host.textContent).toContain("Practice safe trim, split, undo, redo, and restore original");
    expect(host.textContent).toContain("Practice exporting a finished copy without real media");
    expect(host.textContent).toContain("Practice Auto Edit with sample timeline data");
  });
});
