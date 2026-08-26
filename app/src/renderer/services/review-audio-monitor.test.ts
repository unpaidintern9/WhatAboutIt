import { describe, expect, it } from "vitest";
import { clampReviewMonitorGain, getReviewMonitorSettings } from "./review-audio-monitor";

describe("review audio monitor", () => {
  it("allows a deliberate live boost while bounding unsafe values", () => {
    expect(clampReviewMonitorGain(1)).toBe(1);
    expect(clampReviewMonitorGain(2.5)).toBe(2.5);
    expect(clampReviewMonitorGain(8)).toBe(3);
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
    expect(settings.highpassHz).toBe(69);
    expect(settings.lowpassHz).toBe(17800);
    expect(settings.lowDb).toBe(-1);
    expect(settings.midDb).toBe(4.2);
    expect(settings.highDb).toBeCloseTo(4.35);
    expect(settings.compressorThresholdDb).toBe(-24.6);
    expect(settings.compressorRatio).toBeCloseTo(6.05);
    expect(settings.limiterRatio).toBe(20);
    expect(settings.noiseGateDb).toBe(-42);
    expect(settings.fadeInMs).toBe(450);
    expect(settings.fadeOutMs).toBe(700);
  });
});
