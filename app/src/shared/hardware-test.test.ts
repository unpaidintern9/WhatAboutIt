import { describe, expect, it } from "vitest";
import {
  createHardwareTestResults,
  getExportTestStatus,
  getFriendlyHardwareFailureMessage,
  getNextHardwareTestStep,
  getPreviousHardwareTestStep,
  getRecordingTestStatus
} from "./hardware-test";

describe("hardware test flow", () => {
  it("moves through the simple test steps", () => {
    expect(getNextHardwareTestStep("cameras")).toBe("microphones");
    expect(getNextHardwareTestStep("microphones")).toBe("recording");
    expect(getNextHardwareTestStep("recording")).toBe("export");
    expect(getNextHardwareTestStep("export")).toBe("results");
    expect(getNextHardwareTestStep("results")).toBe("results");
    expect(getPreviousHardwareTestStep("recording")).toBe("microphones");
  });

  it("reports camera and mic result states without guessing missing devices", () => {
    const results = createHardwareTestResults({
      cameraReady: [true, false, undefined],
      morganMicReady: true,
      exportStatus: "complete"
    });

    expect(results.camera1.status).toBe("ready");
    expect(results.camera2.status).toBe("needs-attention");
    expect(results.camera3.status).toBe("not-run");
    expect(results.morganMic.message).toBe("Morgan Mic Ready");
    expect(results.exportReady.status).toBe("ready");
  });

  it("tracks recording and export status honestly", () => {
    expect(getRecordingTestStatus("idle")).toBe("not-run");
    expect(getRecordingTestStatus("recording")).toBe("ready");
    expect(getRecordingTestStatus("error")).toBe("needs-attention");
    expect(getExportTestStatus("running")).toBe("needs-attention");
    expect(getExportTestStatus("complete")).toBe("ready");
  });

  it("uses friendly failure messages", () => {
    expect(getFriendlyHardwareFailureMessage("recording")).toContain("local files are still safe");
    expect(getFriendlyHardwareFailureMessage("export")).not.toContain("FFmpeg");
  });
});
