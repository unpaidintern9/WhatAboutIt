// jsdom ships with Vitest here but its optional declaration package is not needed at runtime.
// @ts-expect-error -- test-only dependency without bundled declarations
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { createCollaborationWindowHtml } from "./collaboration-window";

vi.mock("electron", () => ({ BrowserWindow: class {} }));

describe("collaboration window", () => {
  it("boots, lists local episodes, and selects the episode open in Review", async () => {
    const episodeId = "episode-a";
    const listEpisodes = vi.fn(async () => [{ id: episodeId, title: "Episode A", status: "draft", createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T01:00:00.000Z", folderPath: "C:/episodes/episode-a", phase: "phase-1-shell" }]);
    const getCollaborationWorkspace = vi.fn(async () => ({
      episodeId,
      episodeTitle: "Episode A",
      provider: "cloudflare",
      remoteState: "ready",
      status: "working",
      members: [],
      comments: [],
      assets: [],
      uploadPolicy: "project-only",
      updatedAt: "2026-08-28T01:00:00.000Z"
    }));
    const dom = new JSDOM(createCollaborationWindowHtml(episodeId), {
      runScripts: "dangerously",
      url: `https://collaboration.local/#${episodeId}`,
      beforeParse(window: Window & typeof globalThis) {
        Object.defineProperty(window, "studio", { value: {
          listEpisodes,
          getCollaborationWorkspace,
          getProjectSyncStatus: vi.fn(async () => ({ episodeId, connected: true, remoteExists: true, remoteUpdatedAt: "2026-08-28T01:00:00.000Z", remoteUpdatedBy: "Susan", remoteChangesAvailable: true, localChangesSinceSync: false })),
          getCollaborationRemoteConfig: vi.fn(async () => ({ apiUrl: "https://cloud.example", accessKeyConfigured: true, personId: "morgan-owner" })),
          onCloudTransferProgress: vi.fn()
        }});
      }
    });

    await vi.waitFor(() => expect(getCollaborationWorkspace).toHaveBeenCalledWith(episodeId));
    const select = dom.window.document.querySelector<HTMLSelectElement>("#episode");
    expect(select?.disabled).toBe(false);
    expect(select?.value).toBe(episodeId);
    expect(dom.window.document.querySelector("#title")?.textContent).toBe("Episode A");
    expect(dom.window.document.querySelector("#cloudBadge")?.textContent).toBe("Cloudflare connected");
    expect(dom.window.document.querySelector("#revisionTitle")?.textContent).toBe("New collaborator changes are available");
    expect(dom.window.document.querySelector("#revisionDetail")?.textContent).toContain("Susan");
    expect(dom.window.document.querySelector<HTMLButtonElement>("#pullUpdate")?.hidden).toBe(false);
    dom.window.close();
  });
});
