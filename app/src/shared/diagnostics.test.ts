import { describe, expect, it } from "vitest";
import { assessRecordingStorage } from "./diagnostics";

describe("recording storage assessment", () => {
  it("reserves space for the program plus every selected camera and microphone", () => {
    const assessment = assessRecordingStorage({
      status: { message: "Storage check ready", availableBytes: 100 * 1024 ** 3 },
      cameraCount: 3,
      microphoneCount: 3,
      estimatedMinutes: 120
    });

    expect(assessment.ready).toBe(true);
    expect(assessment.requiredBytes).toBeGreaterThan(30 * 1024 ** 3);
    expect(assessment.message).toContain("100 GB free");
  });

  it("blocks recording when the selected drive cannot hold the planned episode", () => {
    const assessment = assessRecordingStorage({
      status: { message: "Storage check ready", availableBytes: 4 * 1024 ** 3 },
      cameraCount: 3,
      microphoneCount: 3,
      estimatedMinutes: 180
    });

    expect(assessment.ready).toBe(false);
    expect(assessment.message).toContain("is needed");
  });
});
