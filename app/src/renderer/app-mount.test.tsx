import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

describe("app mount", () => {
  it("renders the home screen with studio bridge data", async () => {
    window.studio = {
      listEpisodes: vi.fn(async () => []),
      createEpisode: vi.fn(),
      getSettings: vi.fn(async () => ({
        activeThemeId: "what-about-it",
        defaultEpisodeFolderName: "episodes",
        practiceModeEnabled: false
      })),
      saveSettings: vi.fn()
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

