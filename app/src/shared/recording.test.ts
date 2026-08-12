import { describe, expect, it } from "vitest";
import {
  createDeviceMap,
  createInitialRecordingState,
  createSyncMetadata,
  friendlyRecordingError,
  isUnfinishedRecordingState,
  requiredRecordingSessionFiles,
  requiredRecordingSessionFolders
} from "./recording";

describe("recording session metadata", () => {
  it("creates recording state and detects unfinished sessions", () => {
    const state = createInitialRecordingState("session-a", "2026-06-27T10:00:00.000Z");

    expect(state.status).toBe("recording");
    expect(isUnfinishedRecordingState(state)).toBe(true);
    expect(isUnfinishedRecordingState({ ...state, status: "stopped" })).toBe(false);
  });

  it("persists the selected device map and sync metadata", () => {
    const defaults = {
      cameras: { camera1: "camera-a", camera2: "camera-b" },
      microphones: { morganMic: "m-track", guestMic: "m-track" },
      microphoneChannels: { morganMic: "input-1" as const, guestMic: "input-2" as const },
      microphoneNames: { morganMic: "Morgan", guestMic: "Susan" },
      microphoneDeviceLabels: { morganMic: "Line (2- USB AUDIO CODEC)", guestMic: "Line (2- USB AUDIO CODEC)" },
      audioOutputId: "speaker-a"
    };

    expect(createDeviceMap(defaults).program).toEqual({
      cameraDeviceId: "camera-a",
      microphoneDeviceId: "m-track",
      separateTracksWherePossible: true
    });
    expect(createDeviceMap(defaults).microphoneChannels).toEqual({ morganMic: "input-1", guestMic: "input-2" });
    expect(createDeviceMap(defaults).microphoneRoutes).toMatchObject({
      morganMic: { deviceId: "m-track", channel: "input-1", displayName: "Morgan", role: "host" },
      guestMic: { deviceId: "m-track", channel: "input-2", displayName: "Susan", role: "guest" }
    });
    expect(createSyncMetadata(defaults, "2026-06-27T10:00:00.000Z").deviceStartTimestamps["camera-a"]).toBe(
      "2026-06-27T10:00:00.000Z"
    );
    expect(createSyncMetadata(defaults, "2026-06-27T10:00:00.000Z").deviceStartTimestamps).toMatchObject({
      "microphone:morganMic:input-1": "2026-06-27T10:00:00.000Z",
      "microphone:guestMic:input-2": "2026-06-27T10:00:00.000Z"
    });
  });

  it("uses friendly error language", () => {
    expect(friendlyRecordingError("unknown")).toBe("Something got in the way, but your local files are still safe.");
  });

  it("defines the required local recording session folder layout", () => {
    expect(requiredRecordingSessionFolders).toEqual(["Program", "Cameras", "Audio", "Backup", "Session", "Logs"]);
    expect(requiredRecordingSessionFiles).toContain("Session/recording-session.json");
    expect(requiredRecordingSessionFiles).toContain("Session/device-map.json");
    expect(requiredRecordingSessionFiles).toContain("Session/recording-state.json");
    expect(requiredRecordingSessionFiles).toContain("Logs/errors.log");
  });
});
