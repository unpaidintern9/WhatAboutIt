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
      expect.objectContaining({
        version: second.version,
        hasUnsavedChanges: false
      })
    );
  });
});
