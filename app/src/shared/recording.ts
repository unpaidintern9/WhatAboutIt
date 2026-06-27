import type { DeviceDefaults } from "./types";

export type RecordingStatus = "idle" | "recording" | "paused" | "stopped" | "interrupted" | "error";

export interface RecordingSession {
  id: string;
  episodeId: string;
  episodeTitle: string;
  folderPath: string;
  startedAt: string;
  stoppedAt?: string;
  status: RecordingStatus;
  practice: boolean;
}

export interface RecordingState {
  sessionId: string;
  status: RecordingStatus;
  updatedAt: string;
  elapsedMs: number;
  lastSavedAt: string;
  errorMessage?: string;
}

export interface DeviceMap {
  cameras: DeviceDefaults["cameras"];
  microphones: DeviceDefaults["microphones"];
  audioOutputId?: string;
  program: {
    cameraDeviceId?: string;
    microphoneDeviceId?: string;
    separateTracksWherePossible: boolean;
  };
}

export interface SyncMetadata {
  sessionStartTime: string;
  deviceStartTimestamps: Record<string, string>;
  savedMediaFiles?: {
    program?: string;
    camera1?: string;
    morganMic?: string;
  };
  validation?: {
    programPlayable: boolean;
    validatedAt: string;
  };
  droppedFrameWarnings: string[];
  audioDriftWarning: string;
}

export interface RecordingSessionCreateInput {
  episodeId?: string;
  episodeTitle?: string;
  deviceDefaults: DeviceDefaults;
  practice?: boolean;
}

export const requiredRecordingSessionFolders = ["Program", "Cameras", "Audio", "Backup", "Session", "Logs"] as const;

export const requiredRecordingSessionFiles = [
  "Session/recording-session.json",
  "Session/device-map.json",
  "Session/recording-state.json",
  "Session/sync-metadata.json",
  "Logs/errors.log"
] as const;

export function createInitialRecordingState(sessionId: string, now = new Date().toISOString()): RecordingState {
  return {
    sessionId,
    status: "recording",
    updatedAt: now,
    elapsedMs: 0,
    lastSavedAt: now
  };
}

export function createDeviceMap(defaults: DeviceDefaults): DeviceMap {
  return {
    cameras: defaults.cameras,
    microphones: defaults.microphones,
    audioOutputId: defaults.audioOutputId,
    program: {
      cameraDeviceId: defaults.cameras.camera1,
      microphoneDeviceId: defaults.microphones.morganMic,
      separateTracksWherePossible: false
    }
  };
}

export function createSyncMetadata(defaults: DeviceDefaults, now = new Date().toISOString()): SyncMetadata {
  const deviceStartTimestamps: Record<string, string> = {};

  Object.values(defaults.cameras).forEach((deviceId) => {
    if (deviceId) deviceStartTimestamps[deviceId] = now;
  });

  Object.values(defaults.microphones).forEach((deviceId) => {
    if (deviceId) deviceStartTimestamps[deviceId] = now;
  });

  return {
    sessionStartTime: now,
    deviceStartTimestamps,
    droppedFrameWarnings: [],
    audioDriftWarning: "Audio drift watch is prepared for Phase 3 recording review."
  };
}

export function isUnfinishedRecordingState(state: RecordingState) {
  return state.status === "recording" || state.status === "paused" || state.status === "interrupted";
}

export function friendlyRecordingError(reason: "permission" | "camera" | "mic" | "device" | "storage" | "unknown") {
  const messages = {
    permission: "Permission needed before we can record.",
    camera: "Camera needs attention",
    mic: "Mic needs attention",
    device: "We could not start that device yet.",
    storage: "We need more room before recording.",
    unknown: "Something got in the way, but your local files are still safe."
  };

  return messages[reason];
}
