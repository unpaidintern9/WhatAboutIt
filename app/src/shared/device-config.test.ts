import { describe, expect, it } from "vitest";
import {
  defaultDeviceDefaults,
  getMicrophoneInputOptions,
  assignTwoInputInterface,
  getMicrophoneRoutingIssue,
  getDeviceAssignmentConflicts,
  saveCameraMicrophoneSlot,
  saveCameraSlot,
  saveMicrophoneDeviceRoute,
  saveMicrophoneInputChannel,
  saveMicrophoneSlot,
  resolveAvailableAudioOutputId,
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

  it("falls back to the system speaker when a saved Windows device disappeared", () => {
    expect(resolveAvailableAudioOutputId("speaker-a", ["default", "speaker-a"])).toBe("speaker-a");
    expect(resolveAvailableAudioOutputId("old-speaker", ["default", "speaker-a"])).toBeUndefined();
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

  it("migrates older combined routes on one interface into isolated physical inputs", () => {
    const migrated = withDeviceDefaults({
      activeThemeId: "what-about-it",
      defaultEpisodeFolderName: "episodes",
      practiceModeEnabled: false,
      deviceDefaults: {
        cameras: {},
        microphones: { morganMic: "interface-a", guestMic: "interface-a" },
        microphoneChannels: { morganMic: "mix", guestMic: "mix" }
      }
    } as StudioSettings);

    expect(migrated.deviceDefaults.microphoneChannels).toMatchObject({
      morganMic: "input-1",
      guestMic: "input-2"
    });
    expect(getDeviceAssignmentConflicts(migrated.deviceDefaults)).toEqual([]);
  });

  it("preserves automatic combined mode for one laptop microphone", () => {
    const migrated = withDeviceDefaults({
      activeThemeId: "what-about-it",
      defaultEpisodeFolderName: "episodes",
      practiceModeEnabled: false,
      deviceDefaults: {
        cameras: {},
        microphones: { morganMic: "laptop-mic" },
        microphoneChannels: { morganMic: "mix" }
      }
    } as StudioSettings);

    expect(migrated.deviceDefaults.microphoneChannels?.morganMic).toBe("mix");
  });

  it("keeps a clear default mic route for each camera", () => {
    const routed = saveCameraMicrophoneSlot(defaultDeviceDefaults, "camera2", "morganMic");

    expect(routed.cameraMicrophones?.camera1).toBe("morganMic");
    expect(routed.cameraMicrophones?.camera2).toBe("morganMic");
    expect(routed.cameraMicrophones?.camera3).toBe("extraMic");
  });
  it("shows only the two mono ports on an M-Track Duo, bounded by the active Windows channels", () => {
    expect(getMicrophoneInputOptions("M-Audio M-Track Duo").map((item) => item.value)).toEqual(["input-1", "input-2"]);
    expect(getMicrophoneInputOptions("M-Track Solo and Duo", 1).map((item) => item.value)).toEqual(["input-1"]);
    expect(getMicrophoneInputOptions("USB Audio Interface", 8, true)).toHaveLength(8);
    expect(getMicrophoneInputOptions("USB Audio Interface", 8, true).at(-1)?.value).toBe("input-8");
  });
  it("assigns two voices atomically without changing cameras, names or another interface", () => {
    const defaults = { ...defaultDeviceDefaults, cameras: { camera1: "sony" }, microphones: { extraMic: "other-interface" } };
    const next = assignTwoInputInterface(defaults, "duo", "M-Track Duo");
    expect(next.microphones).toEqual({ morganMic: "duo", guestMic: "duo", extraMic: "other-interface" });
    expect(next.microphoneChannels).toMatchObject({ morganMic: "input-1", guestMic: "input-2" });
    expect(next.cameras).toBe(defaults.cameras);
    expect(getMicrophoneRoutingIssue(next)).toBeUndefined();
  });
  it("starts the first known Duo microphone on Input 1 rather than a combined mix", () => {
    expect(saveMicrophoneDeviceRoute(defaultDeviceDefaults, "morganMic", "duo", "M-Track Duo").microphoneChannels?.morganMic).toBe("input-1");
  });
  it("rejects impossible Duo ports and combined-plus-isolated overlap", () => {
    const next = assignTwoInputInterface(defaultDeviceDefaults, "duo", "M-Track Duo");
    expect(getMicrophoneRoutingIssue({ ...next, microphoneChannels: { morganMic: "input-3", guestMic: "input-2" } })).toContain("has two inputs");
    const conflicts = getDeviceAssignmentConflicts({ ...next, microphoneChannels: { morganMic: "mix", guestMic: "input-2" } });
    expect(conflicts).toContainEqual({ kind: "microphone-route", deviceId: "duo", channel: "mix", slots: ["morganMic", "guestMic"] });
  });

});
