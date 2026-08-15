import { describe, expect, it, vi } from "vitest";
import { createTimelineDraft, updateTimelineTrackMix } from "../../shared/timeline";
import { TimelineSaveQueue } from "./timeline-save-queue";

describe("TimelineSaveQueue", () => {
  it("serializes disk writes and only applies the newest saved response", async () => {
    const base = createTimelineDraft({
      deviceDefaults: { cameras: {}, microphones: { morganMic: "mic-a" } }
    });
    const first = updateTimelineTrackMix(base, "mic-morganMic", { volume: 90 });
    const second = updateTimelineTrackMix(first, "mic-morganMic", {
      volume: 70
    });
    const order: number[] = [];
    const applyLatest = vi.fn();
    const queue = new TimelineSaveQueue(async (_episodeId, draft) => {
      order.push(draft.version);
      return { ...draft, hasUnsavedChanges: false };
    }, applyLatest);

    const firstSave = queue.enqueue("episode-a", first);
    const secondSave = queue.enqueue("episode-a", second);
    await Promise.all([firstSave, secondSave]);

    expect(order).toEqual([first.version, second.version]);
    expect(applyLatest).toHaveBeenCalledTimes(1);
    expect(applyLatest).toHaveBeenCalledWith(
      "episode-a",
      expect.objectContaining({
        version: second.version,
        hasUnsavedChanges: false
      })
    );
  });

  it("keeps latest-save tracking isolated by episode", async () => {
    const draftA = createTimelineDraft({
      episodeId: "episode-a",
      deviceDefaults: { cameras: {}, microphones: {} }
    });
    const draftB = createTimelineDraft({
      episodeId: "episode-b",
      deviceDefaults: { cameras: {}, microphones: {} }
    });
    const applyLatest = vi.fn();
    const queue = new TimelineSaveQueue(
      async (episodeId, draft) => ({
        ...draft,
        episodeId,
        hasUnsavedChanges: false
      }),
      applyLatest
    );

    await Promise.all([queue.enqueue("episode-a", draftA), queue.enqueue("episode-b", draftB)]);

    expect(applyLatest).toHaveBeenCalledWith("episode-a", expect.objectContaining({ episodeId: "episode-a" }));
    expect(applyLatest).toHaveBeenCalledWith("episode-b", expect.objectContaining({ episodeId: "episode-b" }));
  });

  it("refuses to save a stale draft into a different episode", async () => {
    const draftA = createTimelineDraft({
      episodeId: "episode-a",
      deviceDefaults: { cameras: {}, microphones: {} }
    });
    const save = vi.fn();
    const queue = new TimelineSaveQueue(save, vi.fn());

    await expect(queue.enqueue("episode-b", draftA)).rejects.toThrow("Refusing to save draft for episode-a into episode episode-b");
    expect(save).not.toHaveBeenCalled();
  });
});
