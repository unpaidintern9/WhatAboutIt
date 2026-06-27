import type { DeviceDefaults } from "./types";
import type { LiveMarker } from "./podcast-tools";

export type TimelineTrackKind = "program" | "camera" | "microphone" | "markers";
export type LockedTimelineTool = "Trim" | "Split" | "Delete" | "Auto Edit" | "Export";
export type TimelineEditType = "trim-before" | "split" | "delete-section";
export type TimelineSelectionSource = "timeline" | "marker";

export interface TimelineTrack {
  id: string;
  label: string;
  kind: TimelineTrackKind;
  placeholder: string;
}

export interface TimelineSelection {
  timestampMs: number;
  source: TimelineSelectionSource;
  markerId?: string;
}

export interface TimelineEditOperation {
  id: string;
  type: TimelineEditType;
  label: string;
  timestampMs: number;
  endTimestampMs?: number;
  createdAt: string;
}

export interface TimelineDraft {
  episodeId?: string;
  recordingSessionId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  durationMs: number;
  tracks: TimelineTrack[];
  markers: LiveMarker[];
  lockedTools: LockedTimelineTool[];
  selection?: TimelineSelection;
  editLog: TimelineEditOperation[];
  undoneEditLog: TimelineEditOperation[];
  hasUnsavedChanges: boolean;
  lastSavedAt?: string;
  nonDestructive: true;
}

export const lockedTimelineTools: LockedTimelineTool[] = ["Auto Edit", "Export"];

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
    version: 1,
    durationMs: input.durationMs ?? 0,
    tracks: [
      { id: "program", label: "Program", kind: "program", placeholder: "Program track placeholder" },
      ...cameraTracks,
      ...micTracks,
      { id: "markers", label: "Markers", kind: "markers", placeholder: "Marker row" }
    ],
    markers: input.markers ?? [],
    lockedTools: lockedTimelineTools,
    editLog: [],
    undoneEditLog: [],
    hasUnsavedChanges: false,
    nonDestructive: true
  };
}

export function withTimelineDraftDefaults(draft: Partial<TimelineDraft> | null | undefined, fallback: TimelineDraft): TimelineDraft {
  return {
    ...fallback,
    ...draft,
    version: draft?.version ?? fallback.version ?? 1,
    tracks: draft?.tracks?.length ? draft.tracks : fallback.tracks,
    markers: draft?.markers ?? fallback.markers,
    lockedTools: draft?.lockedTools?.length ? draft.lockedTools : lockedTimelineTools,
    editLog: draft?.editLog ?? fallback.editLog ?? [],
    undoneEditLog: draft?.undoneEditLog ?? fallback.undoneEditLog ?? [],
    hasUnsavedChanges: draft?.hasUnsavedChanges ?? fallback.hasUnsavedChanges ?? false,
    nonDestructive: true
  };
}

export function selectTimelinePoint(draft: TimelineDraft, selection: TimelineSelection, now = new Date().toISOString()): TimelineDraft {
  return {
    ...draft,
    selection: {
      ...selection,
      timestampMs: Math.max(0, Math.min(selection.timestampMs, Math.max(selection.timestampMs, draft.durationMs)))
    },
    updatedAt: now
  };
}

export function applyTimelineEdit(draft: TimelineDraft, type: TimelineEditType, now = new Date().toISOString()): TimelineDraft {
  const selection = draft.selection ?? { timestampMs: 0, source: "timeline" as const };
  const timestampMs = Math.max(0, Math.min(selection.timestampMs, Math.max(selection.timestampMs, draft.durationMs)));
  const operation = createEditOperation(type, timestampMs, now);

  return {
    ...draft,
    version: draft.version + 1,
    updatedAt: now,
    selection: { ...selection, timestampMs },
    editLog: [...draft.editLog, operation],
    undoneEditLog: [],
    hasUnsavedChanges: true,
    nonDestructive: true
  };
}

export function undoTimelineEdit(draft: TimelineDraft, now = new Date().toISOString()): TimelineDraft {
  if (draft.editLog.length === 0) return draft;
  const editLog = draft.editLog.slice(0, -1);
  const undone = draft.editLog[draft.editLog.length - 1];

  return {
    ...draft,
    version: draft.version + 1,
    updatedAt: now,
    editLog,
    undoneEditLog: [undone, ...draft.undoneEditLog],
    hasUnsavedChanges: true,
    nonDestructive: true
  };
}

export function redoTimelineEdit(draft: TimelineDraft, now = new Date().toISOString()): TimelineDraft {
  if (draft.undoneEditLog.length === 0) return draft;
  const [redone, ...remaining] = draft.undoneEditLog;

  return {
    ...draft,
    version: draft.version + 1,
    updatedAt: now,
    editLog: [...draft.editLog, redone],
    undoneEditLog: remaining,
    hasUnsavedChanges: true,
    nonDestructive: true
  };
}

export function restoreOriginalTimeline(draft: TimelineDraft, now = new Date().toISOString()): TimelineDraft {
  return {
    ...draft,
    version: draft.version + 1,
    updatedAt: now,
    selection: undefined,
    editLog: [],
    undoneEditLog: [],
    hasUnsavedChanges: true,
    nonDestructive: true
  };
}

export function markTimelineSaved(draft: TimelineDraft, now = new Date().toISOString()): TimelineDraft {
  return {
    ...draft,
    updatedAt: now,
    lastSavedAt: now,
    hasUnsavedChanges: false,
    nonDestructive: true
  };
}

function createEditOperation(type: TimelineEditType, timestampMs: number, now: string): TimelineEditOperation {
  const labels: Record<TimelineEditType, string> = {
    "trim-before": "Trim before here",
    split: "Split here",
    "delete-section": "Cut this section"
  };

  return {
    id: `${type}-${timestampMs}-${now}`,
    type,
    label: labels[type],
    timestampMs,
    endTimestampMs: type === "delete-section" ? timestampMs + 15000 : undefined,
    createdAt: now
  };
}
