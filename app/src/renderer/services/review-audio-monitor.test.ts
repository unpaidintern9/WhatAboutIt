import { describe, expect, it } from "vitest";
import { clampReviewMonitorGain } from "./review-audio-monitor";

describe("review audio monitor", () => {
  it("allows a deliberate live boost while bounding unsafe values", () => {
    expect(clampReviewMonitorGain(1)).toBe(1);
    expect(clampReviewMonitorGain(2.5)).toBe(2.5);
    expect(clampReviewMonitorGain(8)).toBe(3);
    expect(clampReviewMonitorGain(-1)).toBe(0);
    expect(clampReviewMonitorGain(Number.NaN)).toBe(1);
  });
});
