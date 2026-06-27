import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { createDefaultPodcastToolsState } from "../shared/podcast-tools";
import { createTimelineDraft } from "../shared/timeline";
import { defaultExportSettings } from "../shared/export";

describe("app mount", () => {
  it("renders the home screen with studio bridge data", async () => {
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
      appendRecordingError: vi.fn(),
      listUnfinishedRecordingSessions: vi.fn(async () => []),
      loadPodcastTools: vi.fn(async () => createDefaultPodcastToolsState("episode-a", "2026-06-27T10:00:00.000Z")),
      savePodcastTools: vi.fn(async (_episodeId, state) => state),
      loadTimelineDraft: vi.fn(async () =>
        createTimelineDraft({ deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } } })
      ),
      saveTimelineDraft: vi.fn(async (_episodeId, draft) => draft),
      runAutoEdit: vi.fn(),
      createExport: vi.fn(),
      getMediaToolsStatus: vi.fn(async () => ({ ready: true, message: "Media tools are ready" as const })),
      cancelExport: vi.fn(),
      openExportFolder: vi.fn()
    };

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<App />);
    });

    expect(host.textContent).toContain("Ready when you are.");
    expect(host.textContent).toContain("New Episode");
    expect(host.textContent).toContain("Camera 1");
  });
});
