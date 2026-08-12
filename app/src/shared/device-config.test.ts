import { describe, expect, it } from "vitest";
import {
  defaultDeviceDefaults,
  getDeviceAssignmentConflicts,
  saveCameraMicrophoneSlot,
  saveCameraSlot,
  saveMicrophoneDeviceRoute,
  saveMicrophoneInputChannel,
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

  it("moves a physical camera instead of assigning it to two slots", () => {
    const first = saveCameraSlot(defaultDeviceDefaults, "camera1", "sony-a");
    const moved = saveCameraSlot(first, "camera2", "sony-a");

    expect(moved.cameras.camera1).toBeUndefined();
    expect(moved.cameras.camera2).toBe("sony-a");
    expect(getDeviceAssignmentConflicts(moved)).toEqual([]);
  });

  it("finds stale camera and exact microphone route conflicts", () => {
    const conflicts = getDeviceAssignmentConflicts({
      cameras: { camera1: "sony-a", camera2: "sony-a" },
      microphones: { morganMic: "audiobox", guestMic: "audiobox", extraMic: "audiobox" },
      microphoneChannels: { morganMic: "input-1", guestMic: "input-1", extraMic: "input-2" }
    });

    expect(conflicts).toEqual([
      { kind: "camera", deviceId: "sony-a", slots: ["camera1", "camera2"] },
      { kind: "microphone-route", deviceId: "audiobox", channel: "input-1", slots: ["morganMic", "guestMic"] }
    ]);
  });

  it("saves a physical interface channel independently for each mic slot", () => {
    const withMorgan = saveMicrophoneInputChannel(defaultDeviceDefaults, "morganMic", "input-1");
    const withGuest = saveMicrophoneInputChannel(withMorgan, "guestMic", "input-2");

    expect(withGuest.microphoneChannels).toMatchObject({ morganMic: "input-1", guestMic: "input-2" });
  });

  it("keeps a laptop microphone on automatic mono mix", () => {
    const routed = saveMicrophoneDeviceRoute(defaultDeviceDefaults, "morganMic", "built-in-mic");

    expect(routed.microphones.morganMic).toBe("built-in-mic");
    expect(routed.microphoneChannels?.morganMic).toBe("mix");
  });

  it("allocates distinct inputs when three tracks share one multichannel interface", () => {
    const morgan = saveMicrophoneDeviceRoute(defaultDeviceDefaults, "morganMic", "interface-a");
    const guest = saveMicrophoneDeviceRoute(morgan, "guestMic", "interface-a");
    const extra = saveMicrophoneDeviceRoute(guest, "extraMic", "interface-a");

    expect(extra.microphoneChannels).toMatchObject({
      morganMic: "input-1",
      guestMic: "input-2",
      extraMic: "input-3"
    });
    expect(getDeviceAssignmentConflicts(extra)).toEqual([]);
  });

  it("keeps a clear default mic route for each camera", () => {
    const routed = saveCameraMicrophoneSlot(defaultDeviceDefaults, "camera2", "morganMic");

    expect(routed.cameraMicrophones?.camera1).toBe("morganMic");
    expect(routed.cameraMicrophones?.camera2).toBe("morganMic");
    expect(routed.cameraMicrophones?.camera3).toBe("extraMic");
  });
});
