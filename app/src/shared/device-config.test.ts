import { describe, expect, it } from "vitest";
import {
  defaultDeviceDefaults,
  saveCameraMicrophoneSlot,
  saveCameraSlot,
  saveMicrophoneSlot,
  withDeviceDefaults
} from "./device-config";
import type { StudioSettings } from "./types";

describe("device config", () => {
  it("adds default device settings for older local settings", () => {
    const oldSettings = {
      activeThemeId: "what-about-it",
      defaultEpisodeFolderName: "episodes",
      practiceModeEnabled: false
    } as StudioSettings;

    expect(withDeviceDefaults(oldSettings).deviceDefaults).toEqual(defaultDeviceDefaults);
  });

  it("saves camera and microphone slots without touching other defaults", () => {
    const withCamera = saveCameraSlot(defaultDeviceDefaults, "camera1", "camera-a");
    const withMic = saveMicrophoneSlot(withCamera, "morganMic", "mic-a");

    expect(withMic.cameras.camera1).toBe("camera-a");
    expect(withMic.microphones.morganMic).toBe("mic-a");
  });

  it("keeps a clear default mic route for each camera", () => {
    const routed = saveCameraMicrophoneSlot(defaultDeviceDefaults, "camera2", "morganMic");

    expect(routed.cameraMicrophones?.camera1).toBe("morganMic");
    expect(routed.cameraMicrophones?.camera2).toBe("morganMic");
    expect(routed.cameraMicrophones?.camera3).toBe("extraMic");
  });
});
