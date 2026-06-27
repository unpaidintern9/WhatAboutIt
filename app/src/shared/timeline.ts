import type { DeviceDefaults } from "./types";
import type { LiveMarker } from "./podcast-tools";

export type TimelineTrackKind = "program" | "camera" | "microphone" | "markers";
export type LockedTimelineTool = "Trim" | "Split" | "Delete" | "Auto Edit" | "Export";

export interface TimelineTrack {
  id: string;
  label: string;
  kind: TimelineTrackKind;
  placeholder: string;
}

export interface TimelineDraft {
  episodeId?: string;
  recordingSessionId?: string;
  createdAt: string;
  updatedAt: string;
  durationMs: number;
  tracks: TimelineTrack[];
  markers: LiveMarker[];
  lockedTools: LockedTimelineTool[];
  nonDestructive: true;
}

export const lockedTimelineTools: LockedTimelineTool[] = ["Trim", "Split", "Delete", "Auto Edit", "Export"];

export function createTimelineDraft(input: {
  episodeId?: string;
  recordingSessionId?: string;
  deviceDefaults: DeviceDefaults;
  markers?: LiveMarker[];
  durationMs?: number;
  now?: string;
}): TimelineDraft {
  const now = input.now ?? new Date().toISOString();
  const cameraTracks = Object.entries(input.deviceDefaults.cameras)
    .filter(([, deviceId]) => Boolean(deviceId))
    .map(([slot], index) => ({
      id: `camera-${slot}`,
      label: `Camera ${index + 1}`,
      kind: "camera" as const,
      placeholder: "Camera track placeholder"
    }));
  const micTracks = Object.entries(input.deviceDefaults.microphones)
    .filter(([, deviceId]) => Boolean(deviceId))
    .map(([slot]) => ({
      id: `mic-${slot}`,
      label: slot === "morganMic" ? "Morgan Mic" : slot === "guestMic" ? "Guest Mic" : "Extra Mic",
      kind: "microphone" as const,
      placeholder: "Mic track placeholder"
    }));

  return {
    episodeId: input.episodeId,
    recordingSessionId: input.recordingSessionId,
    createdAt: now,
    updatedAt: now,
    durationMs: input.durationMs ?? 0,
    tracks: [
      { id: "program", label: "Program", kind: "program", placeholder: "Program track placeholder" },
      ...cameraTracks,
      ...micTracks,
      { id: "markers", label: "Markers", kind: "markers", placeholder: "Marker row" }
    ],
    markers: input.markers ?? [],
    lockedTools: lockedTimelineTools,
    nonDestructive: true
  };
}

export function withTimelineDraftDefaults(draft: Partial<TimelineDraft> | null | undefined, fallback: TimelineDraft): TimelineDraft {
  return {
    ...fallback,
    ...draft,
    tracks: draft?.tracks?.length ? draft.tracks : fallback.tracks,
    markers: draft?.markers ?? fallback.markers,
    lockedTools: draft?.lockedTools?.length ? draft.lockedTools : lockedTimelineTools,
    nonDestructive: true
  };
}

