import { describe, expect, it } from "vitest";
import {
  applyLayoutProfile,
  createWindowState,
  defaultStudioWorkspaceState,
  popOutPanelIds,
  withStudioWorkspaceDefaults
} from "./studio-workspace";

describe("studio workspace", () => {
  it("tracks the required pop-out panels", () => {
    expect(popOutPanelIds).toEqual([
      "teleprompter",
      "soundboard",
      "guest-notes",
      "episode-notes",
      "marker-list",
      "studio-diagnostics"
    ]);
  });

  it("creates restorable window state", () => {
    expect(createWindowState("teleprompter", { displayId: 2, fullscreen: true })).toEqual({
      panelId: "teleprompter",
      isPoppedOut: false,
      displayId: 2,
      collapsed: false,
      fullscreen: true
    });
  });

  it("hydrates workspace settings and saved layouts", () => {
    const hydrated = withStudioWorkspaceDefaults({ settings: { rememberWindowPositions: false, activeLayoutId: "custom", launchWithSavedLayout: true } });

    expect(hydrated.settings.rememberWindowPositions).toBe(false);
    expect(hydrated.settings.launchWithSavedLayout).toBe(true);
    expect(hydrated.layouts.map((layout) => layout.name)).toContain("Triple Monitor");
  });

  it("applies saved layouts without losing existing panel bounds", () => {
    const state = withStudioWorkspaceDefaults({
      windows: {
        teleprompter: createWindowState("teleprompter", {
          bounds: { x: 20, y: 20, width: 900, height: 700 }
        })
      }
    });
    const next = applyLayoutProfile(state, "dual-monitor");

    expect(next.settings.activeLayoutId).toBe("dual-monitor");
    expect(next.windows.teleprompter).toEqual(
      expect.objectContaining({
        isPoppedOut: true,
        fullscreen: true,
        bounds: { x: 20, y: 20, width: 900, height: 700 }
      })
    );
    expect(defaultStudioWorkspaceState.layouts).toHaveLength(6);
  });
});
