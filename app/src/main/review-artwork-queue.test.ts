import { describe, expect, it, vi } from "vitest";
import { runReviewArtworkQueue } from "./review-artwork-queue";

describe("review artwork queue", () => {
  it("starts both microphone waveforms before a camera and limits concurrent work to two", async () => {
    const started: string[] = [];
    let running = 0, peak = 0;
    const releases: Array<() => void> = [];
    const work = runReviewArtworkQueue([
      { kind: "camera", id: "camera" }, { kind: "audio", id: "one" }, { kind: "audio", id: "two" }
    ], async (asset) => {
      started.push(asset.id); running++; peak = Math.max(peak, running);
      await new Promise<void>((resolve) => releases.push(resolve)); running--;
    }, new AbortController().signal, vi.fn());
    expect(started).toEqual(["one", "two"]);
    releases.shift()!();
    await vi.waitFor(() => expect(started).toEqual(["one", "two", "camera"]));
    releases.splice(0).forEach((release) => release());
    await work;
    expect(peak).toBe(2);
  });
  it("does not abandon other tracks when one source fails", async () => {
    const error = vi.fn(), completed: number[] = [];
    await runReviewArtworkQueue([0, 1, 2].map((id) => ({ id, kind: "audio" })), async ({ id }) => {
      if (id === 0) throw Error("damaged source"); completed.push(id);
    }, new AbortController().signal, error);
    expect(completed).toEqual([1, 2]); expect(error).toHaveBeenCalledOnce();
  });
  it("starts no work after cancellation", async () => {
    const controller = new AbortController(); controller.abort(); const prepare = vi.fn();
    await runReviewArtworkQueue([{ kind: "audio" }], prepare, controller.signal, vi.fn());
    expect(prepare).not.toHaveBeenCalled();
  });
});
