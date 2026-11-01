import { describe, expect, it } from "vitest";
import { assessRecordingStorage } from "./diagnostics";

describe("recording storage assessment", () => {
  it("allows recording below the recommendation with a caution", () => {
    const assessment = assessRecordingStorage({
      status: { message: "Storage check ready", availableBytes: 100 * 1024 ** 3 },
      cameraCount: 3,
      microphoneCount: 3,
      estimatedMinutes: 120
    });

    expect(assessment.ready).toBe(true);
    expect(assessment.requiredBytes).toBeGreaterThan(30 * 1024 ** 3);
    expect(assessment.message).toContain("100 GB free");
    expect(assessment.caution).toContain("Caution:");
    expect(assessment.recommendedBytes).toBe(120 * 1024 ** 3);
  });

  it("blocks recording below the 50 GB minimum", () => {
    const assessment = assessRecordingStorage({
      status: { message: "Storage check ready", availableBytes: 4 * 1024 ** 3 },
      cameraCount: 3,
      microphoneCount: 3,
      estimatedMinutes: 180
    });

    expect(assessment.ready).toBe(false);
    expect(assessment.message).toContain("is needed");
  });

  it.each([
    [50 * 1024 ** 3 - 1, false, false],
    [50 * 1024 ** 3, true, true],
    [119 * 1024 ** 3, true, true],
    [120 * 1024 ** 3, true, false]
  ])("assesses %s available bytes at the exact minimum and caution boundaries", (availableBytes, ready, caution) => {
    const assessment = assessRecordingStorage({ status: { message: "Storage check ready", availableBytes }, cameraCount: 3, microphoneCount: 2, estimatedMinutes: 120 });
    expect(assessment.ready).toBe(ready);
    expect(Boolean(assessment.caution)).toBe(caution);
    expect(assessment.requiredBytes).toBe(50 * 1024 ** 3);
  });

  it("keeps a long high-quality episode estimate advisory above 50 GB", () => {
    const assessment = assessRecordingStorage({ status: { message: "Storage check ready", availableBytes: 50 * 1024 ** 3 }, cameraCount: 3, microphoneCount: 3, estimatedMinutes: 180, captureQuality: "high" });
    expect(assessment.ready).toBe(true);
    expect(assessment.recommendedBytes).toBeGreaterThan(120 * 1024 ** 3);
    expect(assessment.caution).toContain("180-minute episode");
  });

  it("blocks when free space cannot be verified", () => {
    const assessment = assessRecordingStorage({ cameraCount: 3, microphoneCount: 2, estimatedMinutes: 120 });
    expect(assessment.ready).toBe(false);
    expect(assessment.message).toContain("could not be verified");
  });
});
