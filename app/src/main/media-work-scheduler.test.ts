import { describe, expect, it } from "vitest";
import {
  mediaWorkStatus,
  scheduleMediaWork,
  setCapturePriority,
  runCaptureYieldingWork,
  withRecordingFinalization,
} from "./media-work-scheduler";

describe("shared media work budget", () => {
  it("gives finalization priority over waiting background jobs", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const order: string[] = [];
    const save = withRecordingFinalization(async () => {
      entered();
      await gate;
      await scheduleMediaWork(async () => { order.push("save"); });
    });
    await started;
    const background = scheduleMediaWork(async () => { order.push("background"); });
    await Promise.resolve();
    expect(order).toEqual([]);
    finish();
    await Promise.all([save, background]);
    expect(order).toEqual(["save", "background"]);
  });
  it("interrupts a running job and retries only after every capture owner releases", async () => {
    let attempts = 0;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const result = runCaptureYieldingWork(async (signal) => {
      attempts++;
      if (attempts > 1) return "complete";
      started();
      return new Promise<string>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    await ready;
    setCapturePriority("first", true);
    setCapturePriority("second", true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(attempts).toBe(1);
    setCapturePriority("first", false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(attempts).toBe(1);
    setCapturePriority("second", false);
    await expect(result).resolves.toBe("complete");
    expect(attempts).toBe(2);
  });
  it("honors cancellation while a yielded job waits for capture", async () => {
    const controller = new AbortController();
    setCapturePriority("cancel", true);
    const work = runCaptureYieldingWork(async () => "unexpected", controller.signal);
    controller.abort(new Error("user cancelled"));
    await expect(work).rejects.toThrow("user cancelled");
    setCapturePriority("cancel", false);
    expect(mediaWorkStatus().waiting).toBe(0);
  });
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
