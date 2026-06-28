import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createDefaultPodcastToolsState } from "../../shared/podcast-tools";
import { PodcastToolsPanel } from "./PodcastToolsPanel";

const snapshot = {
  status: "idle" as const,
  elapsedMs: 42000,
  localSaveMessage: "Everything is saving locally",
  trackStatuses: []
};

describe("PodcastToolsPanel", () => {
  it("renders collapsible podcast tools", () => {
    const markup = renderToStaticMarkup(
      <PodcastToolsPanel
        state={createDefaultPodcastToolsState("episode-a")}
        snapshot={snapshot}
        onChange={vi.fn()}
        onPopOutTeleprompter={vi.fn()}
      />
    );

    expect(markup).toContain("Teleprompter");
    expect(markup).toContain("Guest Notes");
    expect(markup).toContain("Sponsor Notes");
    expect(markup).toContain("Soundboard");
    expect(markup).toContain("Live Markers");
    expect(markup).toContain("Camera Layouts");
    expect(markup).toContain("<details");
  });

  it("creates markers with the current recording timestamp", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        <PodcastToolsPanel
          state={createDefaultPodcastToolsState("episode-a")}
          snapshot={snapshot}
          onChange={onChange}
          onPopOutTeleprompter={vi.fn()}
        />
      );
    });

    const funnyButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Funny"));
    expect(funnyButton).toBeTruthy();

    await act(async () => {
      funnyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0].markers[0].timestampMs).toBe(42000);
  });

  it("selects a camera layout", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        <PodcastToolsPanel
          state={createDefaultPodcastToolsState("episode-a")}
          snapshot={snapshot}
          onChange={onChange}
          onPopOutTeleprompter={vi.fn()}
        />
      );
    });

    const splitButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Split");
    expect(splitButton).toBeTruthy();

    await act(async () => {
      splitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChange.mock.calls[0][0].cameraLayout).toBe("split");
  });
});
