import type { DeviceDefaults } from "./types";
import type { LiveMarker } from "./podcast-tools";
import type { AutoEditChapter, AutoEditClipSuggestion, AutoEditMode } from "./auto-edit";
import type { ReviewMediaInventory } from "./review-media";

export type TimelineTrackKind = "program" | "camera" | "microphone" | "markers";
export type LockedTimelineTool = "Trim" | "Split" | "Delete" | "Auto Edit" | "Export";
export type TimelineEditType = "trim-before" | "split" | "delete-section" | "camera-switch" | "auto-edit-suggestion";
export type TimelineSelectionSource = "timeline" | "marker";
export type TimelineEditMode = "manual" | "auto";

export interface TimelineTrack {
  id: string;
  label: string;
  kind: TimelineTrackKind;
  placeholder: string;
  sourceAssetId?: string;
  includedInProgram: boolean;
  volume: number;
}

export interface TimelineSelection {
  timestampMs: number;
  source: TimelineSelectionSource;
  markerId?: string;
  trackId?: string;
}

export interface TimelineEditOperation {
  id: string;
  type: TimelineEditType;
  label: string;
  timestampMs: number;
  endTimestampMs?: number;
  targetTrackId?: string;
  createdAt: string;
}

export interface TimelineCameraDecision {
  id: string;
  cameraTrackId: string;
  startMs: number;
  source: "manual" | "auto";
  reason: string;
}

export interface TimelineDraft {
  episodeId?: string;
  recordingSessionId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  durationMs: number;
  tracks: TimelineTrack[];
  editMode: TimelineEditMode;
  selectedTrackId: string;
  cameraDecisions: TimelineCameraDecision[];
  markers: LiveMarker[];
  lockedTools: LockedTimelineTool[];
  selection?: TimelineSelection;
  editLog: TimelineEditOperation[];
  undoneEditLog: TimelineEditOperation[];
  hasUnsavedChanges: boolean;
  lastSavedAt?: string;
  autoEdit?: {
    mode: AutoEditMode;
    reportId: string;
    chapters: AutoEditChapter[];
    clips: AutoEditClipSuggestion[];
    reviewFlags: string[];
  };
  nonDestructive: true;
}

export const lockedTimelineTools: LockedTimelineTool[] = [];

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
      placeholder: "Camera angle track",
      sourceAssetId: `camera-${index + 1}`,
      includedInProgram: true,
      volume: 100
    }));
  const micTracks = Object.entries(input.deviceDefaults.microphones)
    .filter(([, deviceId]) => Boolean(deviceId))
    .map(([slot]) => ({
      id: `mic-${slot}`,
      label: slot === "morganMic" ? "Morgan Mic" : slot === "guestMic" ? "Guest Mic" : "Extra Mic",
      kind: "microphone" as const,
      placeholder: "Voice track",
      sourceAssetId: slot === "morganMic" ? "morgan-mic" : slot === "guestMic" ? "guest-mic" : "extra-mic",
      includedInProgram: true,
      volume: 100
    }));

  return {
    episodeId: input.episodeId,
    recordingSessionId: input.recordingSessionId,
    createdAt: now,
    updatedAt: now,
    version: 1,
    durationMs: input.durationMs ?? 0,
    tracks: [
      { id: "program", label: "Program", kind: "program", placeholder: "Combined episode", sourceAssetId: "program", includedInProgram: true, volume: 100 },
      ...cameraTracks,
      ...micTracks,
      { id: "markers", label: "Markers", kind: "markers", placeholder: "Saved moments", includedInProgram: false, volume: 100 }
    ],
    editMode: "manual",
    selectedTrackId: "program",
    cameraDecisions: [],
    markers: input.markers ?? [],
    lockedTools: lockedTimelineTools,
    editLog: [],
    undoneEditLog: [],
    hasUnsavedChanges: false,
    nonDestructive: true
  };
}

export function withTimelineDraftDefaults(draft: Partial<TimelineDraft> | null | undefined, fallback: TimelineDraft): TimelineDraft {
  const fallbackTracks = new Map(fallback.tracks.map((track) => [track.id, track]));
  const tracks = (draft?.tracks?.length ? draft.tracks : fallback.tracks).map((track) => ({
    ...fallbackTracks.get(track.id),
    ...track,
    includedInProgram: track.includedInProgram ?? fallbackTracks.get(track.id)?.includedInProgram ?? track.kind !== "markers",
    volume: track.volume ?? fallbackTracks.get(track.id)?.volume ?? 100
  }));
  return {
    ...fallback,
    ...draft,
    version: draft?.version ?? fallback.version ?? 1,
    tracks,
    editMode: draft?.editMode ?? fallback.editMode ?? "manual",
    selectedTrackId: tracks.some((track) => track.id === draft?.selectedTrackId) ? draft?.selectedTrackId ?? "program" : "program",
    cameraDecisions: draft?.cameraDecisions ?? fallback.cameraDecisions ?? [],
    markers: draft?.markers ?? fallback.markers,
    lockedTools: draft?.lockedTools?.length ? draft.lockedTools : lockedTimelineTools,
    editLog: draft?.editLog ?? fallback.editLog ?? [],
    undoneEditLog: draft?.undoneEditLog ?? fallback.undoneEditLog ?? [],
    hasUnsavedChanges: draft?.hasUnsavedChanges ?? fallback.hasUnsavedChanges ?? false,
    nonDestructive: true
  };
}

export function syncTimelineTracksWithMedia(draft: TimelineDraft, media: ReviewMediaInventory): TimelineDraft {
  const existingAssetIds = new Set(draft.tracks.map((track) => track.sourceAssetId).filter(Boolean));
  const sourceTracks: TimelineTrack[] = [];
  for (const asset of [...media.cameras, ...media.audio]) {
    if (asset.status !== "ready" || existingAssetIds.has(asset.id)) continue;
    sourceTracks.push({
      id: asset.kind === "camera" ? `camera-${asset.id.replace("camera-", "camera")}` : `mic-${asset.id.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())}`,
      label: asset.label,
      kind: asset.kind === "camera" ? "camera" : "microphone",
      placeholder: asset.kind === "camera" ? "Camera angle track" : "Voice track",
      sourceAssetId: asset.id,
      includedInProgram: true,
      volume: 100
    });
  }
  if (sourceTracks.length === 0) return draft;
  const markerIndex = draft.tracks.findIndex((track) => track.kind === "markers");
  const tracks = markerIndex >= 0
    ? [...draft.tracks.slice(0, markerIndex), ...sourceTracks, ...draft.tracks.slice(markerIndex)]
    : [...draft.tracks, ...sourceTracks];
  return { ...draft, tracks };
}

export function selectTimelinePoint(draft: TimelineDraft, selection: TimelineSelection, now = new Date().toISOString()): TimelineDraft {
  const maxTimestamp = draft.durationMs > 0 ? draft.durationMs : selection.timestampMs;
  return {
    ...draft,
    selection: {
      ...selection,
      timestampMs: Math.max(0, Math.min(selection.timestampMs, maxTimestamp)),
      trackId: selection.trackId ?? draft.selectedTrackId
    },
    updatedAt: now
  };
}

export function selectTimelineTrack(draft: TimelineDraft, trackId: string, now = new Date().toISOString()): TimelineDraft {
  if (!draft.tracks.some((track) => track.id === trackId)) return draft;
  return {
    ...draft,
    selectedTrackId: trackId,
    selection: draft.selection ? { ...draft.selection, trackId } : undefined,
    updatedAt: now
  };
}

export function setTimelineEditMode(draft: TimelineDraft, editMode: TimelineEditMode, now = new Date().toISOString()): TimelineDraft {
  return { ...draft, editMode, updatedAt: now };
}

export function updateTimelineTrackMix(
  draft: TimelineDraft,
  trackId: string,
  patch: Partial<Pick<TimelineTrack, "includedInProgram" | "volume">>,
  now = new Date().toISOString()
): TimelineDraft {
  if (!draft.tracks.some((track) => track.id === trackId)) return draft;
  return {
    ...draft,
    version: draft.version + 1,
    updatedAt: now,
    tracks: draft.tracks.map((track) => track.id === trackId ? {
      ...track,
      ...patch,
      volume: patch.volume === undefined ? track.volume : Math.max(0, Math.min(150, patch.volume))
    } : track),
    hasUnsavedChanges: true
  };
}

export function addCameraDecision(
  draft: TimelineDraft,
  cameraTrackId: string,
  source: TimelineCameraDecision["source"] = "manual",
  reason = "Camera selected for the combined episode",
  now = new Date().toISOString()
): TimelineDraft {
  const track = draft.tracks.find((candidate) => candidate.id === cameraTrackId && candidate.kind === "camera");
  if (!track) return draft;
  const startMs = draft.selection?.timestampMs ?? 0;
  const decision: TimelineCameraDecision = {
    id: `camera-switch-${cameraTrackId}-${startMs}-${now}`,
    cameraTrackId,
    startMs,
    source,
    reason
  };
  const operation = createEditOperation("camera-switch", startMs, now, cameraTrackId);
  return {
    ...draft,
    editMode: source === "auto" ? "auto" : draft.editMode,
    version: draft.version + 1,
    updatedAt: now,
    cameraDecisions: [...draft.cameraDecisions.filter((item) => item.startMs !== startMs), decision].sort((a, b) => a.startMs - b.startMs),
    editLog: [...draft.editLog, operation],
    undoneEditLog: [],
    hasUnsavedChanges: true
  };
}

export function applyTimelineEdit(draft: TimelineDraft, type: TimelineEditType, now = new Date().toISOString(), targetTrackId?: string): TimelineDraft {
  const selection = draft.selection ?? { timestampMs: 0, source: "timeline" as const };
  const maxTimestamp = draft.durationMs > 0 ? draft.durationMs : selection.timestampMs;
  const timestampMs = Math.max(0, Math.min(selection.timestampMs, maxTimestamp));
  const operation = createEditOperation(type, timestampMs, now, targetTrackId ?? selection.trackId ?? draft.selectedTrackId ?? "program");

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
    editMode: "manual",
    selectedTrackId: "program",
    cameraDecisions: [],
    tracks: draft.tracks.map((track) => ({ ...track, includedInProgram: track.kind !== "markers", volume: 100 })),
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

function createEditOperation(type: TimelineEditType, timestampMs: number, now: string, targetTrackId = "program"): TimelineEditOperation {
  const labels: Record<TimelineEditType, string> = {
    "trim-before": "Trim before here",
    split: "Split here",
    "delete-section": "Cut this section",
    "camera-switch": "Use camera from here",
    "auto-edit-suggestion": "Auto Edit suggestion"
  };

  return {
    id: `${type}-${timestampMs}-${now}`,
    type,
    label: labels[type],
    timestampMs,
    endTimestampMs: type === "delete-section" ? timestampMs + 15000 : undefined,
    targetTrackId,
    createdAt: now
  };
}
