// jsdom ships with Vitest here but its optional declaration package is not needed at runtime.
// @ts-expect-error -- test-only dependency without bundled declarations
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { createCollaborationWindowHtml } from "./collaboration-window";

vi.mock("electron", () => ({ BrowserWindow: class {} }));

describe("collaboration window", () => {
  it("boots, lists local episodes, and selects the episode open in Review", async () => {
    const episodeId = "episode-a";
    let progressListener: ((progress: Record<string, unknown>) => void) | undefined;
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
          onCloudTransferProgress: vi.fn((listener) => { progressListener = listener; })
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

    progressListener?.({ operationId: "sync-a", direction: "upload", phase: "preparing", completedAssets: 0, totalAssets: 0, transferredBytes: 0, totalBytes: 0, message: "Indexing changed project files." });
    expect(dom.window.document.querySelector("#syncPercent")?.textContent).toBe("Preparing");
    expect(dom.window.document.querySelector("#syncBar")?.hasAttribute("value")).toBe(false);
    progressListener?.({ operationId: "sync-a", direction: "upload", phase: "transferring", completedAssets: 9, totalAssets: 10, transferredBytes: 100, totalBytes: 1000, message: "Uploading a large recording." });
    expect(dom.window.document.querySelector("#syncPercent")?.textContent).toBe("10% complete · 90% remaining");
    progressListener?.({ operationId: "sync-a", direction: "upload", phase: "committing", completedAssets: 10, totalAssets: 10, transferredBytes: 1000, totalBytes: 1000, message: "Publishing backup." });
    expect(dom.window.document.querySelector("#syncPercent")?.textContent).toBe("All files sent · publishing");
    progressListener?.({ operationId: "sync-a", direction: "upload", phase: "complete", completedAssets: 2, totalAssets: 2, transferredBytes: 2048, totalBytes: 2048, message: "Cloudflare upload is complete and verified." });
    expect(dom.window.document.querySelector("#syncPercent")?.textContent).toBe("100% complete · 0% remaining");
    expect(dom.window.document.querySelector("#syncProgress")?.classList.contains("complete")).toBe(true);
    dom.window.close();
  });
});

describe("clear backup controls", () => {
  it("separates a 32-minute review copy, actual local inventory and the active upload", async () => {
    let listener: ((p: Record<string, unknown>) => void) | undefined;
    const assets = [
      ...["metadata.json", "Collaboration/workspace.json", "Session/draft-timeline.json", "Session/proxy-catalog.json"].map(relativePath => ({ relativePath, kind: "metadata", bytes: 100, localOriginal: false })),
      ...["program", "camera-1", "camera-2", "camera-3", "guest-mic", "morgan-mic"].map(name => ({ relativePath: `Session/Proxies/${name}-review.mp4`, kind: "proxy-video", bytes: 63000000, localOriginal: false }))
    ];
    const cloudFiles = { episodeId: "emma", assetCount: 10, totalBytes: 380700000, originalCount: 0, reviewCount: 6, fullBackupVerified: false, durationMs: 32 * 60 * 1000, currentFilesReady: true, files: [{ relativePath: "Session/Proxies/program-review.mp4", label: "program-review.mp4", path: "Review/program-review.mp4", type: "review", bytes: 63000000 }] };
    const workspace = { episodeId: "emma", episodeTitle: "Emma Ep 1.2", assets, members: [], comments: [], status: "working", remoteState: "ready", durationMs: 32 * 60 * 1000, updatedAt: new Date().toISOString() };
    const dom = new JSDOM(createCollaborationWindowHtml("emma"), { runScripts: "dangerously", url: "https://collaboration.local/#emma", beforeParse(window: Window & typeof globalThis) {
      Object.defineProperty(window, "studio", { value: {
        listEpisodes: async () => [{ id: "emma", title: "Emma Ep 1.2" }],
        getCollaborationWorkspace: async () => workspace,
        getCollaborationRemoteConfig: async () => ({ apiUrl: "https://cloud.example" }),
        getProjectSyncStatus: async () => ({ connected: true, remoteExists: true, remoteChangesAvailable: false, cloudFiles }),
        onCloudTransferProgress: (callback: typeof listener) => { listener = callback; }
      } });
    } });
    await vi.waitFor(() => expect(dom.window.document.querySelector("#cloudFilesTitle")?.textContent).toContain("Review copy only"));
    const document = dom.window.document;
    expect(document.querySelector("#assetCount")?.textContent).toBe("10");
    expect(document.querySelector("#originalCount")?.textContent).toBe("0");
    expect(document.querySelector("#episodeDuration")?.textContent).toBe("32:00");
    expect(document.querySelector("#revisionTitle")?.textContent).toBe("Project edits are in sync");
    expect(document.querySelector<HTMLSelectElement>("#uploadMode")?.value).toBe("full-backup");
    expect(document.querySelector<HTMLButtonElement>("#syncNow")?.disabled).toBe(true);
    expect(document.querySelector("#syncMessage")?.textContent).toContain("Open the original recorded episode folder");
    const mode = document.querySelector<HTMLSelectElement>("#uploadMode")!;
    mode.value = "project-and-proxies"; mode.dispatchEvent(new dom.window.Event("change"));
    expect(document.querySelector<HTMLButtonElement>("#syncNow")?.disabled).toBe(false);
    expect(document.querySelector("#syncMessage")?.textContent).toContain("originals are excluded");
    listener?.({ episodeId: "emma", operationId: "review", phase: "transferring", completedAssets: 4, totalAssets: 10, totalBytes: 1000000, transferredBytes: 7800, message: "Uploading review video" });
    expect(document.querySelector("#syncPercent")?.textContent).toContain("0.7%");
    expect(document.querySelector("#syncDetail")?.textContent).toContain("4 of 10 files in this upload");
    expect(document.querySelector("#assetCount")?.textContent).toBe("10");
    listener?.({ episodeId: "another-episode", operationId: "wrong", phase: "transferring", completedAssets: 1, totalAssets: 1, totalBytes: 100, transferredBytes: 50, message: "Other episode" });
    expect(document.querySelector("#syncDetail")?.textContent).not.toContain("Other episode");
    dom.window.close();
  });
});
