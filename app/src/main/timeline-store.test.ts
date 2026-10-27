import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCollaborationRemoteConfig, acquireCollaborationEditorLease } from "./collaboration-remote-service";
import { pullLatestProjectChanges, assertProjectRevisionCurrent, pushProjectChanges } from "./collaboration-project-sync";
import { readPendingProjectSave } from "./local-project-save";
import { setCapturePriority } from "./media-work-scheduler";
import { applyTimelineEdit, createTimelineDraft, selectTimelinePoint } from "../shared/timeline";

const mockPaths = vi.hoisted(() => ({
  episodesRoot: ""
}));

vi.mock("./config-service", () => ({
  getEpisodesRoot: () => mockPaths.episodesRoot
}));

// These are local filesystem persistence tests. Keep cloud/desktop startup
// out of the import graph so a cold Electron download cannot outlive a test.
vi.mock("./collaboration-remote-service", () => ({
  getCollaborationRemoteConfig: vi.fn(async () => ({ apiUrl: undefined, personId: "morgan-owner", accessKeyConfigured: false })),
  sendCollaborationPresence: vi.fn(async () => undefined),
  acquireCollaborationEditorLease: vi.fn()
}));

vi.mock("./collaboration-project-sync", () => ({
  pullLatestProjectChanges: vi.fn(async () => ({ changed: 0 })),
  assertProjectRevisionCurrent: vi.fn(async () => undefined),
  pushProjectChanges: vi.fn(async () => undefined)
}));

vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

describe("timeline store", () => {
  beforeEach(async () => {
    vi.mocked(getCollaborationRemoteConfig).mockResolvedValue({ apiUrl: undefined, personId: "morgan-owner", accessKeyConfigured: false });
    vi.mocked(pullLatestProjectChanges).mockClear();
    vi.mocked(assertProjectRevisionCurrent).mockReset();
    vi.mocked(pushProjectChanges).mockReset();
    vi.mocked(acquireCollaborationEditorLease).mockReset();
    mockPaths.episodesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wai-timeline-"));
  });

  afterEach(async () => {
    vi.mocked(getCollaborationRemoteConfig).mockResolvedValue({ apiUrl: undefined, personId: "morgan-owner", accessKeyConfigured: false });
    const { syncSavedTimelineInBackground } = await import("./timeline-store");
    for (const entry of await fs.readdir(mockPaths.episodesRoot)) await syncSavedTimelineInBackground(entry);
    await fs.rm(mockPaths.episodesRoot, { recursive: true, force: true });
  });

  it("saves draft edits locally without changing originals", async () => {
    const { saveTimelineDraft, loadTimelineDraft } = await import("./timeline-store");
    const draft = applyTimelineEdit(
      selectTimelinePoint(
        createTimelineDraft({
          episodeId: "episode-a",
          deviceDefaults: { cameras: {}, microphones: {} }
        }),
        { timestampMs: 12000, source: "timeline" }
      ),
      "split"
    );

    const saved = await saveTimelineDraft("episode-a", draft);
    const loaded = await loadTimelineDraft("episode-a");

    expect(saved.nonDestructive).toBe(true);
    expect(saved.hasUnsavedChanges).toBe(false);
    expect(loaded?.editLog[0].label).toBe("Split here");
    await expect(fs.stat(path.join(mockPaths.episodesRoot, "episode-a", "Session", "draft-timeline.json"))).resolves.toBeTruthy();
  });

  it("recovers the previous good draft when the primary save is damaged", async () => {
    const { saveTimelineDraft, loadTimelineDraft } = await import("./timeline-store");
    const first = createTimelineDraft({
      episodeId: "episode-a",
      deviceDefaults: { cameras: {}, microphones: {} },
      durationMs: 10000
    });
    const second = { ...first, durationMs: 20000, version: first.version + 1 };
    const filePath = path.join(mockPaths.episodesRoot, "episode-a", "Session", "draft-timeline.json");

    await saveTimelineDraft("episode-a", first);
    await saveTimelineDraft("episode-a", second);
    await fs.writeFile(filePath, "{damaged", "utf8");

    await expect(loadTimelineDraft("episode-a")).resolves.toMatchObject({
      episodeId: "episode-a",
      durationMs: 10000
    });
  });

  it("refuses to cross-save a draft into another episode", async () => {
    const { saveTimelineDraft } = await import("./timeline-store");
    const draft = createTimelineDraft({
      episodeId: "episode-a",
      deviceDefaults: { cameras: {}, microphones: {} }
    });

    await expect(saveTimelineDraft("episode-b", draft)).rejects.toThrow("Refusing to save draft for episode-a into episode episode-b");
  });

  it("keeps undo history in memory without persisting large snapshots", async () => {
    const { saveTimelineDraft, loadTimelineDraft } = await import("./timeline-store");
    const draft = applyTimelineEdit(
      selectTimelinePoint(createTimelineDraft({
        episodeId: "episode-history",
        deviceDefaults: { cameras: {}, microphones: {} },
        durationMs: 30000
      }), { timestampMs: 5000, source: "timeline" }),
      "split"
    );

    const saved = await saveTimelineDraft("episode-history", draft);
    const loaded = await loadTimelineDraft("episode-history");

    expect(saved.history).toHaveLength(1);
    expect(loaded?.history).toEqual([]);
    expect(loaded?.redoHistory).toEqual([]);
    expect(loaded?.editLog).toHaveLength(1);
  });
  function cloudOnline() {
    vi.mocked(getCollaborationRemoteConfig).mockResolvedValue({ apiUrl: "https://cloud.example", personId: "morgan-owner", accessKeyConfigured: true });
  }
  function draftFor(id: string, durationMs = 10000) {
    return createTimelineDraft({ episodeId: id, deviceDefaults: { cameras: {}, microphones: {} }, durationMs });
  }

  it("acknowledges the durable local save while cloud ownership is still hanging", async () => {
    const { saveTimelineDraft, syncSavedTimelineInBackground } = await import("./timeline-store");
    cloudOnline();
    let rejectLease!: (reason: Error) => void;
    vi.mocked(acquireCollaborationEditorLease).mockImplementation(() => new Promise((_resolve, reject) => { rejectLease = reject; }));
    const saved = await saveTimelineDraft("offline", draftFor("offline"));
    expect(saved.hasUnsavedChanges).toBe(false);
    expect(JSON.parse(await fs.readFile(path.join(mockPaths.episodesRoot, "offline/Session/draft-timeline.json"), "utf8")).durationMs).toBe(10000);
    await vi.waitFor(() => expect(rejectLease).toBeTypeOf("function"));
    rejectLease(new Error("Network unavailable"));
    await syncSavedTimelineInBackground("offline");
    expect(await readPendingProjectSave("offline")).toBeTruthy();
    expect(pushProjectChanges).not.toHaveBeenCalled();
  });

  it("keeps the local draft and reopens it when cloud sync fails", async () => {
    const { saveTimelineDraft, loadTimelineDraft, syncSavedTimelineInBackground } = await import("./timeline-store");
    cloudOnline();
    vi.mocked(acquireCollaborationEditorLease).mockRejectedValue(new Error("Cloud offline"));
    await saveTimelineDraft("pending", draftFor("pending", 23000));
    await syncSavedTimelineInBackground("pending");
    expect((await loadTimelineDraft("pending"))?.durationMs).toBe(23000);
    expect(pullLatestProjectChanges).not.toHaveBeenCalled();
    expect(await readPendingProjectSave("pending")).toBeTruthy();
  });

  it("protects the shared revision while still saving locally", async () => {
    const { saveTimelineDraft, syncSavedTimelineInBackground } = await import("./timeline-store");
    cloudOnline();
    vi.mocked(acquireCollaborationEditorLease).mockResolvedValue({ connected: true, self: { memberId: "self" }, activeEditor: { memberId: "other", displayName: "Other editor" } } as unknown as Awaited<ReturnType<typeof acquireCollaborationEditorLease>>);
    await expect(saveTimelineDraft("conflict", draftFor("conflict"))).resolves.toMatchObject({ hasUnsavedChanges: false });
    await syncSavedTimelineInBackground("conflict");
    expect(pushProjectChanges).not.toHaveBeenCalled();
    expect(await readPendingProjectSave("conflict")).toBeTruthy();
  });

  it("leaves an upload failure pending instead of reporting a failed local Save", async () => {
    const { saveTimelineDraft, syncSavedTimelineInBackground } = await import("./timeline-store");
    cloudOnline();
    vi.mocked(acquireCollaborationEditorLease).mockResolvedValue({ connected: true, self: { memberId: "self" } } as unknown as Awaited<ReturnType<typeof acquireCollaborationEditorLease>>);
    vi.mocked(pushProjectChanges).mockRejectedValue(new Error("Upload failed"));
    await expect(saveTimelineDraft("upload", draftFor("upload"))).resolves.toMatchObject({ hasUnsavedChanges: false });
    await syncSavedTimelineInBackground("upload");
    expect(await readPendingProjectSave("upload")).toBeTruthy();
    expect(assertProjectRevisionCurrent).toHaveBeenCalledWith("upload");
  });

  it("saves locally during capture and defers cloud checks until capture ends", async () => {
    const { saveTimelineDraft, syncSavedTimelineInBackground } = await import("./timeline-store");
    cloudOnline();
    vi.mocked(acquireCollaborationEditorLease).mockRejectedValue(new Error("Offline"));
    setCapturePriority("local-save-test", true);
    try {
      await saveTimelineDraft("capture", draftFor("capture"));
      expect(acquireCollaborationEditorLease).not.toHaveBeenCalled();
      expect(await readPendingProjectSave("capture")).toBeTruthy();
    } finally { setCapturePriority("local-save-test", false); }
    await syncSavedTimelineInBackground("capture");
  });

  it("still rejects a real local disk failure", async () => {
    const { saveTimelineDraft } = await import("./timeline-store");
    await fs.writeFile(path.join(mockPaths.episodesRoot, "blocked"), "not a directory");
    await expect(saveTimelineDraft("blocked", draftFor("blocked"))).rejects.toThrow();
  });

});
