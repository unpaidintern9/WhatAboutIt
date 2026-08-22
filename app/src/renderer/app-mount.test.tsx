import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { createDefaultPodcastToolsState } from "../shared/podcast-tools";
import { createTimelineDraft } from "../shared/timeline";
import { defaultExportSettings } from "../shared/export";

describe("app mount", () => {
  it("renders the home screen with studio bridge data", async () => {
    const saveSettings = vi.fn(async (settings) => settings);
    window.studio = {
      listEpisodes: vi.fn(async () => []),
      createEpisode: vi.fn(),
      getSettings: vi.fn(async () => ({
        activeThemeId: "what-about-it",
        defaultEpisodeFolderName: "episodes",
        practiceModeEnabled: false,
        exportSettings: defaultExportSettings,
        deviceDefaults: {
          cameras: {},
          microphones: {}
        }
      })),
      saveSettings,
      createRecordingSession: vi.fn(),
      writeRecordingState: vi.fn(),
      saveProgramRecording: vi.fn(),
      saveRecordedTracks: vi.fn(async () => []),
      appendRecordingError: vi.fn(),
      listUnfinishedRecordingSessions: vi.fn(async () => []),
      loadPodcastTools: vi.fn(async () => createDefaultPodcastToolsState("episode-a", "2026-06-27T10:00:00.000Z")),
      savePodcastTools: vi.fn(async (_episodeId, state) => state),
      loadTimelineDraft: vi.fn(async () =>
        createTimelineDraft({ deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } } })
      ),
      saveTimelineDraft: vi.fn(async (_episodeId, draft) => draft),
      loadReviewMedia: vi.fn(async (episodeId) => createReviewMediaFixture(episodeId)),
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

    const startWithHome = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Not Now"));
    expect(startWithHome).toBeTruthy();

    await act(async () => {
      startWithHome?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.textContent).toContain("Ready when you are.");
    expect(host.textContent).toContain("New Episode");
    expect(host.textContent).toContain("Camera 1");
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ onboarding: { guidedTour: "never" } }));
  });

  it("shows the simple workflow in the branded sidebar", async () => {
    const openLiveLogs = vi.fn(async () => ({ folderPath: "C:/logs", filePath: "C:/logs/2026-08-21.log" }));
    window.studio = {
      listEpisodes: vi.fn(async () => []),
      createEpisode: vi.fn(),
      getSettings: vi.fn(async () => ({
        activeThemeId: "what-about-it",
        defaultEpisodeFolderName: "episodes",
        practiceModeEnabled: false,
        exportSettings: defaultExportSettings,
        deviceDefaults: {
          cameras: {},
          microphones: {}
        }
      })),
      saveSettings: vi.fn(),
      createRecordingSession: vi.fn(),
      writeRecordingState: vi.fn(),
      saveProgramRecording: vi.fn(),
      saveRecordedTracks: vi.fn(async () => []),
      appendRecordingError: vi.fn(),
      listUnfinishedRecordingSessions: vi.fn(async () => []),
      loadPodcastTools: vi.fn(async () => createDefaultPodcastToolsState("episode-a", "2026-06-27T10:00:00.000Z")),
      savePodcastTools: vi.fn(async (_episodeId, state) => state),
      loadTimelineDraft: vi.fn(async () =>
        createTimelineDraft({ deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } } })
      ),
      saveTimelineDraft: vi.fn(async (_episodeId, draft) => draft),
      loadReviewMedia: vi.fn(async (episodeId) => createReviewMediaFixture(episodeId)),
      runAutoEdit: vi.fn(),
      createExport: vi.fn(),
      getMediaToolsStatus: vi.fn(async () => ({ ready: true, message: "Media tools are ready" as const })),
      cancelExport: vi.fn(),
      openExportFolder: vi.fn(),
      createDiagnosticsBundle: vi.fn(async () => ({ folderPath: "diagnostics", files: [] })),
      getLiveLogInfo: vi.fn(async () => ({ folderPath: "C:/logs", filePath: "C:/logs/2026-08-21.log" })),
      openLiveLogs,
      getStorageStatus: vi.fn(async () => ({ message: "Storage check ready" as const, availableBytes: 1024 }))
    };

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<App />);
    });

    expect(host.querySelector(".studio-shell")?.className).toContain("sidebar-collapsed");
    expect(host.textContent).toContain("Morgan McGaughey");
    const workflow = host.querySelector('nav[aria-label="Studio workflow"]');
    expect(workflow?.textContent).toContain("Studio Setup");
    expect(workflow?.textContent).toContain("Record");
    expect(workflow?.textContent).toContain("Review");
    expect(workflow?.textContent).toContain("Export");
    expect(workflow?.textContent).not.toContain("Hardware Test");

    const secondary = host.querySelector('nav[aria-label="More studio tools"]');
    expect(secondary?.textContent).toContain("Settings");
    expect(secondary?.textContent).toContain("Learn");
    expect(secondary?.textContent).toContain("More");
    expect(secondary?.querySelectorAll("button")).toHaveLength(3);
    expect(host.textContent).not.toContain("Advanced diagnostics");

    const workspace = host.querySelector<HTMLElement>(".workspace");
    expect(workspace).toBeTruthy();
    if (workspace) workspace.scrollTop = 640;
    const settingsButton = Array.from(secondary?.querySelectorAll("button") ?? []).find((button) => button.textContent?.includes("Settings"));
    await act(async () => settingsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(workspace?.scrollTop).toBe(0);
    expect(host.textContent).toContain("Advanced diagnostics");
    expect(host.textContent).toContain("C:/logs/2026-08-21.log");

    const openLogsButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Open Live Logs"));
    await act(async () => openLogsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(openLiveLogs).toHaveBeenCalledTimes(1);
  });

  it("collapses the sidebar and saves the preference", async () => {
    const saveSettings = vi.fn(async (settings) => settings);
    window.studio = {
      listEpisodes: vi.fn(async () => []),
      createEpisode: vi.fn(),
      getSettings: vi.fn(async () => ({
        activeThemeId: "what-about-it",
        defaultEpisodeFolderName: "episodes",
        practiceModeEnabled: false,
        exportSettings: defaultExportSettings,
        deviceDefaults: {
          cameras: {},
          microphones: {}
        },
        ui: { sidebarCollapsed: false }
      })),
      saveSettings,
      createRecordingSession: vi.fn(),
      writeRecordingState: vi.fn(),
      saveProgramRecording: vi.fn(),
      saveRecordedTracks: vi.fn(async () => []),
      appendRecordingError: vi.fn(),
      listUnfinishedRecordingSessions: vi.fn(async () => []),
      loadPodcastTools: vi.fn(async () => createDefaultPodcastToolsState("episode-a", "2026-06-27T10:00:00.000Z")),
      savePodcastTools: vi.fn(async (_episodeId, state) => state),
      loadTimelineDraft: vi.fn(async () =>
        createTimelineDraft({ deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } } })
      ),
      saveTimelineDraft: vi.fn(async (_episodeId, draft) => draft),
      loadReviewMedia: vi.fn(async (episodeId) => createReviewMediaFixture(episodeId)),
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

    const collapse = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Collapse"));
    expect(collapse).toBeTruthy();

    await act(async () => {
      collapse?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.querySelector(".studio-shell")?.className).toContain("sidebar-collapsed");
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ ui: { sidebarCollapsed: true } }));
  });
});

function createReviewMediaFixture(episodeId: string) {
  return {
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
  };
}
