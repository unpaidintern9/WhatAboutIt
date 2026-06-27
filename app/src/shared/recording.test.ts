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
      microphones: { morganMic: "mic-a", guestMic: "mic-b" },
      audioOutputId: "speaker-a"
    };

    expect(createDeviceMap(defaults).program).toEqual({
      cameraDeviceId: "camera-a",
      microphoneDeviceId: "mic-a",
      separateTracksWherePossible: false
    });
    expect(createSyncMetadata(defaults, "2026-06-27T10:00:00.000Z").deviceStartTimestamps["camera-a"]).toBe(
      "2026-06-27T10:00:00.000Z"
    );
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
