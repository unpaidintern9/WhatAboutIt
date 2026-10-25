import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashEpisodeChunks } from "./collaboration-asset-index";
import { scheduleMediaWork, setCapturePriority, withRecordingFinalization, mediaWorkStatus } from "./media-work-scheduler";

describe("hashing and recording finalization", () => {
  it("allows Stop to finalize even when two whole-file hashes are paused", async () => {
    let release!: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    let notify!: () => void;
    const started = new Promise<void>((resolve) => { notify = resolve; });
    let readers = 0;
    const createSource = () => Readable.from((async function* () {
      yield Buffer.from("first");
      if (++readers === 2) notify();
      await next;
      yield Buffer.from("second");
    })());
    const hashes = Promise.all([hashEpisodeChunks(createSource()), hashEpisodeChunks(createSource())]);
    try {
      await started;
      setCapturePriority("hash-test", true);
      release();
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(mediaWorkStatus().running).toBe(0);
      setCapturePriority("hash-test", false);
      let saved = false;
      await withRecordingFinalization(() => scheduleMediaWork(async () => { saved = true; }));
      expect(saved).toBe(true);
      const expected = createHash("sha256").update("firstsecond").digest("hex");
      await expect(hashes).resolves.toEqual([expected, expected]);
    } finally { setCapturePriority("hash-test", false); release(); await hashes; }
  });
});
