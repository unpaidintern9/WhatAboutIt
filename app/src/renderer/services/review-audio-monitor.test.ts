import { describe, expect, it } from "vitest";
import { clampReviewMonitorGain, createReviewOutputRouter, getReviewMonitorSettings } from "./review-audio-monitor";

describe("review audio monitor", () => {
  it("allows a deliberate live boost while bounding unsafe values", () => {
    expect(clampReviewMonitorGain(1)).toBe(1);
    expect(clampReviewMonitorGain(2.5)).toBe(2.5);
    expect(clampReviewMonitorGain(8)).toBe(6);
    expect(clampReviewMonitorGain(-1)).toBe(0);
    expect(clampReviewMonitorGain(Number.NaN)).toBe(1);
  });

  it("maps every audible timeline control into the live monitor graph", () => {
    const settings = getReviewMonitorSettings({
      volume: 240,
      pan: -35,
      audioPreset: "broadcast",
      noiseReduction: 40,
      noiseGateDb: -42,
      deEsser: 30,
      compression: 70,
      eqLowDb: -2,
      eqMidDb: 3,
      eqHighDb: 4,
      limiterEnabled: true,
      fadeInMs: 450,
      fadeOutMs: 700
    });

    expect(settings.trackGain).toBe(2.4);
    expect(settings.pan).toBe(-0.35);
    expect(settings.highpassHz).toBe(80);
    expect(settings.lowpassHz).toBe(17800);
    expect(settings.lowDb).toBe(-1);
    expect(settings.midDb).toBe(4.2);
    expect(settings.highDb).toBeCloseTo(4.35);
    expect(settings.compressorThresholdDb).toBeCloseTo(-18.344, 2);
    expect(settings.compressorRatio).toBeCloseTo(4.65);
    expect(settings.compressorMakeup).toBe(1.15);
    expect(settings.limiterRatio).toBe(20);
    expect(settings.noiseGateDb).toBe(-42);
    expect(settings.fadeInMs).toBe(450);
    expect(settings.fadeOutMs).toBe(700);
  });

  it("deduplicates concurrent speaker routing requests", async () => {
    let finishRoute: (() => void) | undefined;
    const calls: string[] = [];
    const routeOutput = createReviewOutputRouter((deviceId) => {
      calls.push(deviceId);
      return new Promise<void>((resolve) => {
        finishRoute = resolve;
      });
    });

    const first = routeOutput("speaker-a");
    const second = routeOutput("speaker-a");
    expect(calls).toEqual(["speaker-a"]);
    finishRoute?.();

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    await expect(routeOutput("speaker-a")).resolves.toBe(true);
    expect(calls).toEqual(["speaker-a"]);
  });

  it("does not retry a missing speaker until the selection changes", async () => {
    const calls: string[] = [];
    const routeOutput = createReviewOutputRouter(async (deviceId) => {
      calls.push(deviceId);
      if (deviceId === "missing-speaker") throw new DOMException("Missing", "AbortError");
    });

    await expect(routeOutput("missing-speaker")).resolves.toBe(false);
    await expect(routeOutput("missing-speaker")).resolves.toBe(false);
    await expect(routeOutput("speaker-b")).resolves.toBe(true);
    expect(calls).toEqual(["missing-speaker", "speaker-b"]);
  });
});
