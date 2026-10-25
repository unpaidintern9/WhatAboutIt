import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runFfmpegWithProgress, getMediaDurationMs } from "./ffmpeg-tools";
import { setCapturePriority, mediaWorkStatus } from "./media-work-scheduler";

describe("cross-platform encode yielding", () => {
  it("stops a running encoder during recording, then rebuilds its complete derived output", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "wai-encode-yield-"));
    const output = path.join(folder, "derived.flac");
    let notify!: () => void;
    const started = new Promise<void>((resolve) => { notify = resolve; });
    let completed = false;
    const progress: number[] = [];
    const work = runFfmpegWithProgress(["-y", "-re", "-f", "lavfi", "-i", "sine=frequency=440:duration=2:sample_rate=48000", "-c:a", "flac", output], { durationMs: 2000, onProgress: (value) => { progress.push(value); if (value > 0) notify(); } }).then(() => { completed = true; });
    try {
      await Promise.race([started, work]);
      setCapturePriority("encode-test", true);
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(completed).toBe(false);
      expect(mediaWorkStatus().running).toBe(0);
      setCapturePriority("encode-test", false);
      await work;
      expect(await getMediaDurationMs(output)).toBeCloseTo(2000, -1);
      expect(progress.at(-1)).toBe(100);
      expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
    } finally { setCapturePriority("encode-test", false); await work; await fs.rm(folder, { recursive: true, force: true }); }
  }, 15000);
});
