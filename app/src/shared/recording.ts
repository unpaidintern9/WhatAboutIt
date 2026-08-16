import type { DeviceDefaults } from "./types";

export type RecordingStatus = "idle" | "recording" | "paused" | "stopped" | "interrupted" | "error";
export type RecordingTrackKind = "camera" | "audio";
export type RecordingTrackSlot = "camera1" | "camera2" | "camera3" | "morganMic" | "guestMic" | "extraMic";
export type RecordingMediaTarget = "program" | RecordingTrackSlot;
export type RecordingTrackSaveStatus = "saved" | "preview-only" | "needs-attention";

export interface RecordingTrackSaveInput {
  slot: RecordingTrackSlot;
  kind: RecordingTrackKind;
  bytes?: Uint8Array;
  mimeType?: string;
  status?: RecordingTrackSaveStatus;
  message?: string;
}

export interface RecordingTrackSaveResult {
  slot: RecordingTrackSlot;
  kind: RecordingTrackKind;
  status: RecordingTrackSaveStatus;
  filePath?: string;
  message: string;
}

export interface RecordingSession {
  id: string;
  episodeId: string;
  episodeTitle: string;
  folderPath: string;
  startedAt: string;
  stoppedAt?: string;
  status: RecordingStatus;
  practice: boolean;
  backupFolderPath?: string;
  recoverableBytes?: number;
}

export interface RecordingChunkInput {
  target: RecordingMediaTarget;
  kind: "program" | RecordingTrackKind;
  mimeType: string;
  sequence: number;
  bytes: Uint8Array;
}

export interface RecordingSourceHealth {
  target: RecordingMediaTarget;
  kind: "program" | RecordingTrackKind;
  active: boolean;
  bytesWritten: number;
  lastChunkAt?: string;
  message: string;
}

export interface RecordingIntegrityReport {
  checkedAt: string;
  playable: boolean;
  programPlayable: boolean;
  savedSourceCount: number;
  expectedSourceCount: number;
  warnings: string[];
  backupPath?: string;
}

export interface RecordingFinalizeResult {
  programPath?: string;
  tracks: RecordingTrackSaveResult[];
  integrity: RecordingIntegrityReport;
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
  cameraMicrophones?: DeviceDefaults["cameraMicrophones"];
  microphones: DeviceDefaults["microphones"];
  microphoneChannels?: DeviceDefaults["microphoneChannels"];
  microphoneNames?: DeviceDefaults["microphoneNames"];
  microphoneDeviceLabels?: DeviceDefaults["microphoneDeviceLabels"];
  microphoneRoutes?: Partial<Record<"morganMic" | "guestMic" | "extraMic", {
    deviceId?: string;
    deviceLabel?: string;
    channel: import("./types").MicrophoneInputChannel;
    displayName: string;
    role: "host" | "guest" | "extra";
  }>>;
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
    camera2?: string;
    camera3?: string;
    morganMic?: string;
    guestMic?: string;
    extraMic?: string;
  };
  trackStates?: {
    camera1?: RecordingTrackSaveResult;
    camera2?: RecordingTrackSaveResult;
    camera3?: RecordingTrackSaveResult;
    morganMic?: RecordingTrackSaveResult;
    guestMic?: RecordingTrackSaveResult;
    extraMic?: RecordingTrackSaveResult;
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
  backupFolderPath?: string;
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
  const microphoneRoutes = Object.fromEntries((["morganMic", "guestMic", "extraMic"] as const).map((slot) => [slot, {
    deviceId: defaults.microphones[slot],
    deviceLabel: defaults.microphoneDeviceLabels?.[slot],
    channel: defaults.microphoneChannels?.[slot] ?? "mix",
    displayName: defaults.microphoneNames?.[slot] ?? (slot === "morganMic" ? "Morgan" : slot === "guestMic" ? "Guest" : "Extra"),
    role: slot === "morganMic" ? "host" : slot === "guestMic" ? "guest" : "extra"
  }])) as DeviceMap["microphoneRoutes"];
  return {
    cameras: defaults.cameras,
    cameraMicrophones: defaults.cameraMicrophones,
    microphones: defaults.microphones,
    microphoneChannels: defaults.microphoneChannels,
    microphoneNames: defaults.microphoneNames,
    microphoneDeviceLabels: defaults.microphoneDeviceLabels,
    microphoneRoutes,
    audioOutputId: defaults.audioOutputId,
    program: {
      cameraDeviceId: defaults.cameras.camera1,
      microphoneDeviceId: defaults.microphones[defaults.cameraMicrophones?.camera1 ?? "morganMic"] ?? defaults.microphones.morganMic,
      separateTracksWherePossible: true
    }
  };
}

export function createSyncMetadata(defaults: DeviceDefaults, now = new Date().toISOString()): SyncMetadata {
  const deviceStartTimestamps: Record<string, string> = {};

  Object.values(defaults.cameras).forEach((deviceId) => {
    if (deviceId) deviceStartTimestamps[deviceId] = now;
  });

  Object.entries(defaults.microphones).forEach(([slot, deviceId]) => {
    if (deviceId) deviceStartTimestamps[`microphone:${slot}:${defaults.microphoneChannels?.[slot as keyof DeviceDefaults["microphones"]] ?? "mix"}`] = now;
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
