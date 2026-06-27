import { describe, expect, it } from "vitest";
import { defaultDeviceDefaults } from "../../shared/device-config";
import { getDeviceReadiness, getEmptyStateMessage } from "./device-service";

describe("device service", () => {
  it("returns friendly empty states", () => {
    expect(getEmptyStateMessage("camera")).toBe("No camera found");
    expect(getEmptyStateMessage("microphone")).toBe("No microphone found");
    expect(getEmptyStateMessage("quiet")).toBe("We can't hear you yet");
    expect(getEmptyStateMessage("ready")).toBe("Everything looks good");
  });

  it("checks readiness from detected devices and saved defaults", () => {
    expect(
      getDeviceReadiness({ cameras: [], microphones: [], speakers: [], permissionNeeded: false }, defaultDeviceDefaults)
    ).toBe("needs-camera");

    expect(
      getDeviceReadiness(
        {
          cameras: [{ id: "camera-a", label: "Studio Camera", kind: "camera" }],
          microphones: [{ id: "mic-a", label: "Morgan Mic", kind: "microphone" }],
          speakers: [],
          permissionNeeded: false
        },
        { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } }
      )
    ).toBe("ready");
  });
});

