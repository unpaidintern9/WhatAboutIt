import { describe, expect, it } from "vitest";
import { summarizePcmSignal } from "./pcm-signal-diagnostics";
describe("recorded PCM diagnostics", () => {
  it("measures every received sample without modifying the recording", () => {
    const values = [0, 0.5, -0.5, 0.999, -0.999], bytes = Buffer.alloc(values.length * 3);
    values.forEach((value, index) => bytes.writeIntLE(Math.round(value * 8388607), index * 3, 3));
    const original = Buffer.from(bytes), result = summarizePcmSignal(bytes, "audio/x-pcm;rate=48000;channels=1")!;
    expect(result.frames).toBe(5); expect(result.nearFullScaleSamples).toBe(2); expect(result.peak).toBeCloseTo(0.999);
    expect(bytes).toEqual(original);
  });
  it("does not decode compressed or malformed media", () => {
    expect(summarizePcmSignal(new Uint8Array([1, 2]), "audio/x-pcm;channels=1")).toBeUndefined();
    expect(summarizePcmSignal(new Uint8Array([1, 2, 3]), "video/webm")).toBeUndefined();
  });
});
