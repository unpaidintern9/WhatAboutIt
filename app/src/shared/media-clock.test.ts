import { describe, expect, it } from "vitest";
import { MediaClock } from "./media-clock";

describe("media clock calibration", () => {
  it("measures a stable independent clock and ignores a constant attachment delay", () => {
    const clock = new MediaClock();
    for (let second = 0; second <= 300; second++)
      clock.observe(second * 1000 * 1.0004, second * 1000 + 580);
    expect(clock.rateRatio).toBeCloseTo(1.0004, 6);
  });
  it("does not correct a short clip or treat delivery stalls as device drift", () => {
    const short = new MediaClock();
    for (let second = 0; second < 60; second++)
      short.observe(second * 1000 * 1.0005, second * 1000);
    expect(short.rateRatio).toBe(1);
    const stalled = new MediaClock();
    for (let second = 0; second <= 300; second++)
      stalled.observe(second * 1000, second * 1000 + (second % 3) * 250);
    expect(stalled.rateRatio).toBe(1);
  });
});
