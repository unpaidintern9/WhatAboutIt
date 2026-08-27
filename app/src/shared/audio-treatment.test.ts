import { describe, expect, it } from "vitest";
import { getAudioTreatmentParameters } from "./audio-treatment";

describe("shared audio treatment parameters", () => {
  it("keeps voice presets identical for live Review and export", () => {
    const broadcast = getAudioTreatmentParameters({ audioPreset: "broadcast" });
    expect(broadcast).toMatchObject({ highpassHz: 80, lowDb: 1, midDb: 1.2, highDb: 2, compression: 48 });
    expect(broadcast.compressorRatio).toBeCloseTo(3.66, 2);
    expect(broadcast.compressorMakeup).toBe(1.15);
  });

  it("combines cleanup and explicit tone with bounded values", () => {
    const treatment = getAudioTreatmentParameters({ audioPreset: "clean", noiseReduction: 100, deEsser: 20, eqHighDb: 3, compression: 70 });
    expect(treatment.highpassHz).toBe(120);
    expect(treatment.lowpassHz).toBe(14_500);
    expect(treatment.highDb).toBeCloseTo(3.1, 3);
    expect(treatment.compression).toBe(70);
  });
});

