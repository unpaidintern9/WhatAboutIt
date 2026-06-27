import { describe, expect, it } from "vitest";
import { defaultDeviceDefaults, saveCameraSlot, saveMicrophoneSlot, withDeviceDefaults } from "./device-config";
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
});

