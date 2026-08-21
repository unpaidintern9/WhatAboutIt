import { describe, expect, it } from "vitest";
import {
  createHardwareTestResults,
  didDeviceDisconnectDuringRecording,
  getExportTestStatus,
  getFriendlyHardwareFailureMessage,
  getHardwareDeviceReadiness,
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

  it("keeps saved preferences and marks a missing saved device as needs attention", () => {
    const readiness = getHardwareDeviceReadiness(
      {
        cameras: { camera1: "saved-camera", camera2: "missing-camera" },
        microphones: { morganMic: "saved-mic" }
      },
      [
        { id: "saved-camera", label: "Camera", kind: "camera" },
        { id: "saved-mic", label: "Mic", kind: "microphone" }
      ]
    );

    expect(readiness.cameraReady).toEqual([true, false, undefined]);
    expect(readiness.summary).toBe("Needs Attention");
    expect(readiness.message).toContain("saved device is missing");
  });

  it("does not fail optional camera slots that were never configured", () => {
    const readiness = getHardwareDeviceReadiness(
      { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } },
      [
        { id: "camera-a", label: "Camera", kind: "camera" },
        { id: "mic-a", label: "Mic", kind: "microphone" }
      ]
    );

    expect(readiness.cameraReady).toEqual([true, undefined, undefined]);
    expect(readiness.summary).toBe("Everything Ready");
  });

  it("updates readiness when a hot-plugged camera appears", () => {
    const before = getHardwareDeviceReadiness(
      { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } },
      [{ id: "mic-a", label: "Mic", kind: "microphone" }]
    );
    const after = getHardwareDeviceReadiness(
      { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } },
      [
        { id: "camera-a", label: "Camera", kind: "camera" },
        { id: "mic-a", label: "Mic", kind: "microphone" }
      ]
    );

    expect(before.cameraReady[0]).toBe(false);
    expect(after.summary).toBe("Everything Ready");
  });

  it("detects a saved device disconnect during recording", () => {
    expect(
      didDeviceDisconnectDuringRecording({
        status: "recording",
        defaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } },
        devices: [{ id: "camera-a", label: "Camera", kind: "camera" }]
      })
    ).toBe(true);
  });
});
