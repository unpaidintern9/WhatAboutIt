import { describe, expect, it } from "vitest";
import {
  mediaWorkStatus,
  scheduleMediaWork,
  setCapturePriority,
} from "./media-work-scheduler";

describe("shared media work budget", () => {
  it("defers background work during capture and cancels a queued job", async () => {
    setCapturePriority("test", true);
    const controller = new AbortController();
    let ran = false;
    const work = scheduleMediaWork(async () => {
      ran = true;
    }, controller.signal);
    await Promise.resolve();
    expect(ran).toBe(false);
    controller.abort(new Error("cancelled"));
    await expect(work).rejects.toThrow("cancelled");
    setCapturePriority("test", false);
    expect(mediaWorkStatus().waiting).toBe(0);
  });
  it("shares two slots across simultaneous operations", async () => {
    let running = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        scheduleMediaWork(async () => {
          peak = Math.max(peak, ++running);
          await new Promise((resolve) => setTimeout(resolve, 2));
          running--;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(mediaWorkStatus().running).toBe(0);
  });
});
