import type { DeviceDefaults } from "./types";
import type { LiveMarker } from "./podcast-tools";
import type { AutoEditChapter, AutoEditClipSuggestion, AutoEditMode } from "./auto-edit";
import type { ReviewMediaInventory } from "./review-media";

export type TimelineTrackKind = "program" | "camera" | "microphone" | "markers";
export type LockedTimelineTool = "Trim" | "Split" | "Delete" | "Auto Edit" | "Export";
export type TimelineEditType = "trim-before" | "trim-after" | "split" | "delete-section" | "camera-switch" | "auto-edit-suggestion";
export type TimelineSelectionSource = "timeline" | "marker";
export type TimelineEditMode = "manual" | "auto";
export type TimelineAudioPreset = "natural" | "clean" | "warm" | "broadcast";
export type TimelineCropMode = "fit" | "fill";
export type TimelineCameraTransition = "cut" | "fade";

export interface TimelineTrack {
  id: string;
  label: string;
  kind: TimelineTrackKind;
  placeholder: string;
  sourceAssetId?: string;
  includedInProgram: boolean;
  volume: number;
  muted: boolean;
  solo: boolean;
  pan: number;
  fadeInMs: number;
  fadeOutMs: number;
  syncOffsetMs: number;
  audioPreset: TimelineAudioPreset;
  noiseReduction: number;
  noiseGateDb: number;
  deEsser: number;
  compression: number;
  eqLowDb: number;
  eqMidDb: number;
  eqHighDb: number;
  limiterEnabled: boolean;
  cropMode: TimelineCropMode;
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  sharpness: number;
  denoise: number;
  zoom: number;
  positionX: number;
  positionY: number;
}

export interface TimelineSelection {
  timestampMs: number;
  endTimestampMs?: number;
  source: TimelineSelectionSource;
  markerId?: string;
  trackId?: string;
}

export interface TimelineSegment {
  id: string;
  trackId: string;
  startMs: number;
  endMs: number;
  removed: boolean;
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

export interface TimelineHistorySnapshot {
  durationMs: number;
  tracks: TimelineTrack[];
  editMode: TimelineEditMode;
  cameraDecisions: TimelineCameraDecision[];
  cameraTransition: TimelineCameraTransition;
  cameraTransitionMs: number;
  loudnessTargetLufs: number;
  truePeakDb: number;
  editLog: TimelineEditOperation[];
  autoEdit?: TimelineDraft["autoEdit"];
}

export interface TimelineHistoryEntry {
  id: string;
  label: string;
  mergeKey?: string;
  createdAt: string;
  before: TimelineHistorySnapshot;
  after: TimelineHistorySnapshot;
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
  cameraTransition: TimelineCameraTransition;
  cameraTransitionMs: number;
  loudnessTargetLufs: number;
  truePeakDb: number;
  markers: LiveMarker[];
  lockedTools: LockedTimelineTool[];
  selection?: TimelineSelection;
  editLog: TimelineEditOperation[];
  undoneEditLog: TimelineEditOperation[];
  history: TimelineHistoryEntry[];
  redoHistory: TimelineHistoryEntry[];
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

const defaultTrackControls = {
  includedInProgram: true,
  volume: 100,
  muted: false,
  solo: false,
  pan: 0,
  fadeInMs: 0,
  fadeOutMs: 0,
  syncOffsetMs: 0,
  audioPreset: "natural" as TimelineAudioPreset,
  noiseReduction: 0,
  noiseGateDb: -80,
  deEsser: 0,
  compression: 0,
  eqLowDb: 0,
  eqMidDb: 0,
  eqHighDb: 0,
  limiterEnabled: true,
  cropMode: "fit" as TimelineCropMode,
  brightness: 0,
  contrast: 100,
  saturation: 100,
  temperature: 0,
  tint: 0,
  sharpness: 0,
  denoise: 0,
  zoom: 100,
  positionX: 0,
  positionY: 0
};

export function createTimelineDraft(input: { episodeId?: string; recordingSessionId?: string; deviceDefaults: DeviceDefaults; markers?: LiveMarker[]; durationMs?: number; now?: string }): TimelineDraft {
  const now = input.now ?? new Date().toISOString();
  const cameraTracks = Object.entries(input.deviceDefaults.cameras)
    .filter(([, deviceId]) => Boolean(deviceId))
    .map(([slot], index) => ({
      id: `camera-${slot}`,
      label: `Camera ${index + 1}`,
      kind: "camera" as const,
      placeholder: "Camera angle track",
      sourceAssetId: `camera-${index + 1}`,
      ...defaultTrackControls
    }));
  const micTracks = Object.entries(input.deviceDefaults.microphones)
    .filter(([, deviceId]) => Boolean(deviceId))
    .map(([slot]) => ({
      id: `mic-${slot}`,
      label: slot === "morganMic" ? "Morgan Mic" : slot === "guestMic" ? "Guest Mic" : "Extra Mic",
      kind: "microphone" as const,
      placeholder: "Voice track",
      sourceAssetId: slot === "morganMic" ? "morgan-mic" : slot === "guestMic" ? "guest-mic" : "extra-mic",
      ...defaultTrackControls
    }));

  return {
    episodeId: input.episodeId,
    recordingSessionId: input.recordingSessionId,
    createdAt: now,
    updatedAt: now,
    version: 1,
    durationMs: input.durationMs ?? 0,
    tracks: [
      {
        id: "program",
        label: "Program",
        kind: "program",
        placeholder: "Combined episode",
        sourceAssetId: "program",
        ...defaultTrackControls
      },
      ...cameraTracks,
      ...micTracks,
      {
        id: "markers",
        label: "Markers",
        kind: "markers",
        placeholder: "Saved moments",
        ...defaultTrackControls,
        includedInProgram: false
      }
    ],
    editMode: "manual",
    selectedTrackId: "program",
    cameraDecisions: [],
    cameraTransition: "cut",
    cameraTransitionMs: 250,
    loudnessTargetLufs: -16,
    truePeakDb: -1.5,
    markers: input.markers ?? [],
    lockedTools: lockedTimelineTools,
    editLog: [],
    undoneEditLog: [],
    history: [],
    redoHistory: [],
    hasUnsavedChanges: false,
    nonDestructive: true
  };
}

export function withTimelineDraftDefaults(draft: Partial<TimelineDraft> | null | undefined, fallback: TimelineDraft): TimelineDraft {
  const fallbackTracks = new Map(fallback.tracks.map((track) => [track.id, track]));
  const tracks = (draft?.tracks?.length ? draft.tracks : fallback.tracks).map((track) => ({
    ...fallbackTracks.get(track.id),
    ...defaultTrackControls,
    ...track,
    includedInProgram: track.includedInProgram ?? fallbackTracks.get(track.id)?.includedInProgram ?? track.kind !== "markers",
    volume: track.volume ?? fallbackTracks.get(track.id)?.volume ?? 100,
    muted: track.muted ?? fallbackTracks.get(track.id)?.muted ?? false,
    solo: track.solo ?? fallbackTracks.get(track.id)?.solo ?? false,
    pan: track.pan ?? fallbackTracks.get(track.id)?.pan ?? 0,
    fadeInMs: track.fadeInMs ?? fallbackTracks.get(track.id)?.fadeInMs ?? 0,
    fadeOutMs: track.fadeOutMs ?? fallbackTracks.get(track.id)?.fadeOutMs ?? 0,
    syncOffsetMs: track.syncOffsetMs ?? fallbackTracks.get(track.id)?.syncOffsetMs ?? 0,
    audioPreset: track.audioPreset ?? fallbackTracks.get(track.id)?.audioPreset ?? "natural",
    noiseReduction: track.noiseReduction ?? fallbackTracks.get(track.id)?.noiseReduction ?? 0,
    noiseGateDb: track.noiseGateDb ?? fallbackTracks.get(track.id)?.noiseGateDb ?? -80,
    deEsser: track.deEsser ?? fallbackTracks.get(track.id)?.deEsser ?? 0,
    compression: track.compression ?? fallbackTracks.get(track.id)?.compression ?? 0,
    eqLowDb: track.eqLowDb ?? fallbackTracks.get(track.id)?.eqLowDb ?? 0,
    eqMidDb: track.eqMidDb ?? fallbackTracks.get(track.id)?.eqMidDb ?? 0,
    eqHighDb: track.eqHighDb ?? fallbackTracks.get(track.id)?.eqHighDb ?? 0,
    limiterEnabled: track.limiterEnabled ?? fallbackTracks.get(track.id)?.limiterEnabled ?? true,
    cropMode: track.cropMode ?? fallbackTracks.get(track.id)?.cropMode ?? "fit",
    brightness: track.brightness ?? fallbackTracks.get(track.id)?.brightness ?? 0,
    contrast: track.contrast ?? fallbackTracks.get(track.id)?.contrast ?? 100,
    saturation: track.saturation ?? fallbackTracks.get(track.id)?.saturation ?? 100,
    temperature: track.temperature ?? fallbackTracks.get(track.id)?.temperature ?? 0,
    tint: track.tint ?? fallbackTracks.get(track.id)?.tint ?? 0,
    sharpness: track.sharpness ?? fallbackTracks.get(track.id)?.sharpness ?? 0,
    denoise: track.denoise ?? fallbackTracks.get(track.id)?.denoise ?? 0,
    zoom: track.zoom ?? fallbackTracks.get(track.id)?.zoom ?? 100,
    positionX: track.positionX ?? fallbackTracks.get(track.id)?.positionX ?? 0,
    positionY: track.positionY ?? fallbackTracks.get(track.id)?.positionY ?? 0
  }));
  return {
    ...fallback,
    ...draft,
    version: draft?.version ?? fallback.version ?? 1,
    tracks,
    editMode: draft?.editMode ?? fallback.editMode ?? "manual",
    selectedTrackId: tracks.some((track) => track.id === draft?.selectedTrackId) ? (draft?.selectedTrackId ?? "program") : "program",
    cameraDecisions: draft?.cameraDecisions ?? fallback.cameraDecisions ?? [],
    cameraTransition: draft?.cameraTransition ?? fallback.cameraTransition ?? "cut",
    cameraTransitionMs: draft?.cameraTransitionMs ?? fallback.cameraTransitionMs ?? 250,
    loudnessTargetLufs: draft?.loudnessTargetLufs ?? fallback.loudnessTargetLufs ?? -16,
    truePeakDb: draft?.truePeakDb ?? fallback.truePeakDb ?? -1.5,
    markers: draft?.markers ?? fallback.markers,
    lockedTools: draft?.lockedTools?.length ? draft.lockedTools : lockedTimelineTools,
    editLog: draft?.editLog ?? fallback.editLog ?? [],
    undoneEditLog: draft?.undoneEditLog ?? fallback.undoneEditLog ?? [],
    history: draft?.history ?? fallback.history ?? [],
    redoHistory: draft?.redoHistory ?? fallback.redoHistory ?? [],
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
      ...defaultTrackControls
    });
  }
  if (sourceTracks.length === 0) return draft;
  const markerIndex = draft.tracks.findIndex((track) => track.kind === "markers");
  const tracks = markerIndex >= 0 ? [...draft.tracks.slice(0, markerIndex), ...sourceTracks, ...draft.tracks.slice(markerIndex)] : [...draft.tracks, ...sourceTracks];
  return { ...draft, tracks };
}

export function selectTimelinePoint(draft: TimelineDraft, selection: TimelineSelection, now = new Date().toISOString()): TimelineDraft {
  const maxTimestamp = draft.durationMs > 0 ? draft.durationMs : selection.timestampMs;
  return {
    ...draft,
    selection: {
      ...selection,
      timestampMs: Math.max(0, Math.min(selection.timestampMs, maxTimestamp)),
      endTimestampMs: selection.endTimestampMs === undefined ? undefined : Math.max(0, Math.min(selection.endTimestampMs, maxTimestamp)),
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
  patch: Partial<
    Pick<
      TimelineTrack,
      | "includedInProgram"
      | "volume"
      | "muted"
      | "solo"
      | "pan"
      | "fadeInMs"
      | "fadeOutMs"
      | "syncOffsetMs"
      | "audioPreset"
      | "noiseReduction"
      | "noiseGateDb"
      | "deEsser"
      | "compression"
      | "eqLowDb"
      | "eqMidDb"
      | "eqHighDb"
      | "limiterEnabled"
      | "cropMode"
      | "brightness"
      | "contrast"
      | "saturation"
      | "temperature"
      | "tint"
      | "sharpness"
      | "denoise"
      | "zoom"
      | "positionX"
      | "positionY"
    >
  >,
  now = new Date().toISOString()
): TimelineDraft {
  const track = draft.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return draft;
  const next = {
    ...draft,
    tracks: draft.tracks.map((track) =>
      track.id === trackId
        ? {
            ...track,
            ...patch,
            volume: patch.volume === undefined ? track.volume : Math.max(0, Math.min(150, patch.volume)),
            pan: patch.pan === undefined ? track.pan : Math.max(-100, Math.min(100, patch.pan)),
            fadeInMs: patch.fadeInMs === undefined ? track.fadeInMs : Math.max(0, Math.min(10000, patch.fadeInMs)),
            fadeOutMs: patch.fadeOutMs === undefined ? track.fadeOutMs : Math.max(0, Math.min(10000, patch.fadeOutMs)),
            syncOffsetMs: patch.syncOffsetMs === undefined ? track.syncOffsetMs : Math.max(-30000, Math.min(30000, patch.syncOffsetMs)),
            noiseReduction: patch.noiseReduction === undefined ? track.noiseReduction : Math.max(0, Math.min(100, patch.noiseReduction)),
            noiseGateDb: patch.noiseGateDb === undefined ? track.noiseGateDb : Math.max(-80, Math.min(-20, patch.noiseGateDb)),
            deEsser: patch.deEsser === undefined ? track.deEsser : Math.max(0, Math.min(100, patch.deEsser)),
            compression: patch.compression === undefined ? track.compression : Math.max(0, Math.min(100, patch.compression)),
            eqLowDb: patch.eqLowDb === undefined ? track.eqLowDb : Math.max(-12, Math.min(12, patch.eqLowDb)),
            eqMidDb: patch.eqMidDb === undefined ? track.eqMidDb : Math.max(-12, Math.min(12, patch.eqMidDb)),
            eqHighDb: patch.eqHighDb === undefined ? track.eqHighDb : Math.max(-12, Math.min(12, patch.eqHighDb)),
            brightness: patch.brightness === undefined ? track.brightness : Math.max(-100, Math.min(100, patch.brightness)),
            contrast: patch.contrast === undefined ? track.contrast : Math.max(50, Math.min(200, patch.contrast)),
            saturation: patch.saturation === undefined ? track.saturation : Math.max(0, Math.min(200, patch.saturation)),
            temperature: patch.temperature === undefined ? track.temperature : Math.max(-100, Math.min(100, patch.temperature)),
            tint: patch.tint === undefined ? track.tint : Math.max(-100, Math.min(100, patch.tint)),
            sharpness: patch.sharpness === undefined ? track.sharpness : Math.max(0, Math.min(100, patch.sharpness)),
            denoise: patch.denoise === undefined ? track.denoise : Math.max(0, Math.min(100, patch.denoise)),
            zoom: patch.zoom === undefined ? track.zoom : Math.max(100, Math.min(160, patch.zoom)),
            positionX: patch.positionX === undefined ? track.positionX : Math.max(-100, Math.min(100, patch.positionX)),
            positionY: patch.positionY === undefined ? track.positionY : Math.max(-100, Math.min(100, patch.positionY))
          }
        : track
    )
  };
  const fields = Object.keys(patch).sort().join("+") || "controls";
  return commitTimelineMutation(draft, next, `Adjust ${track.label}`, `track:${trackId}:${fields}`, now);
}

export function updateTimelineSyncOffsets(draft: TimelineDraft, offsetsMs: Record<string, number>, now = new Date().toISOString()): TimelineDraft {
  return commitTimelineMutation(
    draft,
    {
      ...draft,
      tracks: draft.tracks.map((track) =>
        offsetsMs[track.id] === undefined
          ? track
          : {
              ...track,
              syncOffsetMs: Math.max(-30000, Math.min(30000, Math.round(offsetsMs[track.id])))
            }
      )
    },
    "Synchronize cameras and audio",
    undefined,
    now
  );
}

export function updateTimelineCameraTransition(draft: TimelineDraft, cameraTransition: TimelineCameraTransition, cameraTransitionMs = draft.cameraTransitionMs, now = new Date().toISOString()): TimelineDraft {
  return commitTimelineMutation(
    draft,
    {
      ...draft,
      cameraTransition,
      cameraTransitionMs: Math.max(100, Math.min(1000, cameraTransitionMs))
    },
    "Change camera transition",
    "camera-transition",
    now
  );
}

export function updateTimelineMastering(draft: TimelineDraft, loudnessTargetLufs: number, truePeakDb = draft.truePeakDb, now = new Date().toISOString()): TimelineDraft {
  return commitTimelineMutation(
    draft,
    {
      ...draft,
      loudnessTargetLufs: Math.max(-24, Math.min(-12, loudnessTargetLufs)),
      truePeakDb: Math.max(-3, Math.min(-0.5, truePeakDb))
    },
    "Change finished loudness",
    "mastering",
    now
  );
}

export function resetTimelineTrackControls(draft: TimelineDraft, trackId: string, now = new Date().toISOString()): TimelineDraft {
  const track = draft.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return draft;
  return commitTimelineMutation(
    draft,
    {
      ...draft,
      tracks: draft.tracks.map((track) =>
        track.id === trackId
          ? {
              ...track,
              ...defaultTrackControls,
              includedInProgram: track.includedInProgram
            }
          : track
      )
    },
    `Reset ${track.label}`,
    undefined,
    now
  );
}

export function applyTimelineTrackTreatmentToKind(draft: TimelineDraft, sourceTrackId: string, now = new Date().toISOString()): TimelineDraft {
  const source = draft.tracks.find((track) => track.id === sourceTrackId);
  if (!source || (source.kind !== "microphone" && source.kind !== "camera")) return draft;
  const treatment =
    source.kind === "microphone"
      ? pickTrackControls(source, ["audioPreset", "noiseReduction", "noiseGateDb", "deEsser", "compression", "eqLowDb", "eqMidDb", "eqHighDb", "limiterEnabled"])
      : pickTrackControls(source, ["cropMode", "brightness", "contrast", "saturation", "temperature", "tint", "sharpness", "denoise", "zoom", "positionX", "positionY"]);
  return commitTimelineMutation(
    draft,
    {
      ...draft,
      tracks: draft.tracks.map((track) => (track.kind === source.kind ? { ...track, ...treatment } : track))
    },
    `Apply ${source.kind === "microphone" ? "voice treatment" : "camera look"} to all`,
    undefined,
    now
  );
}

export function setTimelineRange(draft: TimelineDraft, startMs: number, endMs: number, trackId = draft.selectedTrackId, now = new Date().toISOString()): TimelineDraft {
  const durationMs = Math.max(0, draft.durationMs);
  const safeStart = Math.max(0, Math.min(startMs, durationMs || startMs));
  const safeEnd = Math.max(safeStart, Math.min(endMs, durationMs || endMs));
  return selectTimelinePoint(
    draft,
    {
      timestampMs: safeStart,
      endTimestampMs: safeEnd,
      trackId,
      source: "timeline"
    },
    now
  );
}

export function getTimelineSegments(draft: TimelineDraft, trackId: string): TimelineSegment[] {
  const durationMs = Math.max(1, draft.durationMs);
  const edits = draft.editLog.filter((edit) => (edit.targetTrackId ?? "program") === trackId);
  const trimStart = Math.max(0, ...edits.filter((edit) => edit.type === "trim-before").map((edit) => edit.timestampMs));
  const trimEnd = Math.min(durationMs, ...edits.filter((edit) => edit.type === "trim-after").map((edit) => edit.timestampMs), durationMs);
  const cuts = edits
    .filter((edit) => edit.type === "delete-section")
    .map((edit) => ({
      startMs: edit.timestampMs,
      endMs: Math.min(durationMs, edit.endTimestampMs ?? edit.timestampMs + 15000)
    }));
  const boundaries = new Set<number>([
    0,
    durationMs,
    trimStart,
    trimEnd,
    ...(trackId === "program" ? draft.cameraDecisions.map((decision) => decision.startMs) : []),
    ...edits.filter((edit) => edit.type === "split").map((edit) => edit.timestampMs),
    ...cuts.flatMap((cut) => [cut.startMs, cut.endMs])
  ]);
  const ordered = [...boundaries].filter((value) => value >= 0 && value <= durationMs).sort((a, b) => a - b);
  return ordered
    .slice(0, -1)
    .map((startMs, index) => {
      const endMs = ordered[index + 1];
      const midpoint = startMs + (endMs - startMs) / 2;
      const removed = midpoint < trimStart || midpoint >= trimEnd || cuts.some((cut) => midpoint >= cut.startMs && midpoint < cut.endMs);
      return {
        id: `${trackId}-${startMs}-${endMs}`,
        trackId,
        startMs,
        endMs,
        removed
      };
    })
    .filter((segment) => segment.endMs > segment.startMs);
}

export function getTimelineKeepRanges(draft: TimelineDraft): Array<{ startMs: number; endMs: number }> {
  const durationMs = Math.max(0, draft.durationMs);
  if (durationMs === 0) return [];
  return getTimelineSegments(draft, "program")
    .filter((segment) => !segment.removed)
    .map(({ startMs, endMs }) => ({ startMs, endMs }));
}

export function getNextPlayableTimelineTime(draft: TimelineDraft, timestampMs: number): number | undefined {
  const ranges = getTimelineKeepRanges(draft);
  const current = ranges.find((range) => timestampMs >= range.startMs && timestampMs < range.endMs);
  if (current) return timestampMs;
  return ranges.find((range) => range.startMs >= timestampMs)?.startMs;
}

export function getActiveCameraTrackId(draft: TimelineDraft, timestampMs: number): string | undefined {
  return [...draft.cameraDecisions].filter((decision) => decision.startMs <= timestampMs).sort((left, right) => right.startMs - left.startMs)[0]?.cameraTrackId;
}

export function isTimelineTrackAvailableAt(draft: TimelineDraft, trackId: string, timestampMs: number): boolean {
  const track = draft.tracks.find((candidate) => candidate.id === trackId);
  if (!track?.includedInProgram) return false;
  return !draft.editLog.some((edit) => {
    if ((edit.targetTrackId ?? "program") !== trackId) return false;
    return (edit.type === "trim-before" && timestampMs < edit.timestampMs)
      || (edit.type === "trim-after" && timestampMs >= edit.timestampMs)
      || (edit.type === "delete-section" && timestampMs >= edit.timestampMs && timestampMs < (edit.endTimestampMs ?? edit.timestampMs + 15000));
  });
}

export function addCameraDecision(draft: TimelineDraft, cameraTrackId: string, source: TimelineCameraDecision["source"] = "manual", reason = "Camera selected for the combined episode", now = new Date().toISOString()): TimelineDraft {
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
  return commitTimelineMutation(
    draft,
    {
      ...draft,
      editMode: source === "auto" ? "auto" : draft.editMode,
      cameraDecisions: [...draft.cameraDecisions.filter((item) => item.startMs !== startMs), decision].sort((a, b) => a.startMs - b.startMs),
      editLog: [...draft.editLog, operation],
      undoneEditLog: []
    },
    `Use ${track.label} from ${formatTimelineTime(startMs)}`,
    undefined,
    now
  );
}

export function applyTimelineEdit(draft: TimelineDraft, type: TimelineEditType, now = new Date().toISOString(), targetTrackId?: string): TimelineDraft {
  const selection = draft.selection ?? {
    timestampMs: 0,
    source: "timeline" as const
  };
  const maxTimestamp = draft.durationMs > 0 ? draft.durationMs : selection.timestampMs;
  const timestampMs = Math.max(0, Math.min(selection.timestampMs, maxTimestamp));
  const operation = createEditOperation(type, timestampMs, now, targetTrackId ?? selection.trackId ?? draft.selectedTrackId ?? "program", selection.endTimestampMs);

  return commitTimelineMutation(
    draft,
    {
      ...draft,
      selection: { ...selection, timestampMs },
      editLog: [...draft.editLog, operation],
      undoneEditLog: [],
      nonDestructive: true
    },
    operation.label,
    undefined,
    now
  );
}

export function setTimelineEditOperationEnabled(draft: TimelineDraft, operation: TimelineEditOperation, enabled: boolean, now = new Date().toISOString()): TimelineDraft {
  const exists = draft.editLog.some((item) => item.id === operation.id);
  if (exists === enabled) return draft;
  return commitTimelineMutation(
    draft,
    {
      ...draft,
      editLog: enabled ? [...draft.editLog, operation].sort((left, right) => left.timestampMs - right.timestampMs) : draft.editLog.filter((item) => item.id !== operation.id)
    },
    `${enabled ? "Accept" : "Reject"} ${operation.label.toLowerCase()}`,
    undefined,
    now
  );
}

export function undoTimelineEdit(draft: TimelineDraft, now = new Date().toISOString()): TimelineDraft {
  if (draft.history.length > 0) {
    const entry = draft.history[draft.history.length - 1];
    const removedOperation = draft.editLog.find((operation) => !entry.before.editLog.some((before) => before.id === operation.id));
    return {
      ...draft,
      ...entry.before,
      version: draft.version + 1,
      updatedAt: now,
      history: draft.history.slice(0, -1),
      redoHistory: [entry, ...draft.redoHistory],
      undoneEditLog: removedOperation ? [removedOperation, ...draft.undoneEditLog] : draft.undoneEditLog,
      hasUnsavedChanges: true,
      nonDestructive: true
    };
  }
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
  if (draft.redoHistory.length > 0) {
    const [entry, ...remaining] = draft.redoHistory;
    return {
      ...draft,
      ...entry.after,
      version: draft.version + 1,
      updatedAt: now,
      history: [...draft.history, entry],
      redoHistory: remaining,
      undoneEditLog: [],
      hasUnsavedChanges: true,
      nonDestructive: true
    };
  }
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
  return commitTimelineMutation(
    draft,
    {
      ...draft,
      selection: undefined,
      editMode: "manual",
      selectedTrackId: "program",
      cameraDecisions: [],
      cameraTransition: "cut",
      cameraTransitionMs: 250,
      loudnessTargetLufs: -16,
      truePeakDb: -1.5,
      tracks: draft.tracks.map((track) => ({
        ...track,
        ...defaultTrackControls,
        includedInProgram: track.kind !== "markers"
      })),
      editLog: [],
      undoneEditLog: [],
      nonDestructive: true
    },
    "Restore original episode",
    undefined,
    now
  );
}

function pickTrackControls<K extends keyof TimelineTrack>(track: TimelineTrack, keys: K[]): Pick<TimelineTrack, K> {
  return Object.fromEntries(keys.map((key) => [key, track[key]])) as Pick<TimelineTrack, K>;
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

function createEditOperation(type: TimelineEditType, timestampMs: number, now: string, targetTrackId = "program", rangeEndMs?: number): TimelineEditOperation {
  const labels: Record<TimelineEditType, string> = {
    "trim-before": "Trim before here",
    "trim-after": "Trim after here",
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
    endTimestampMs: type === "delete-section" ? Math.max(timestampMs, rangeEndMs ?? timestampMs + 15000) : undefined,
    targetTrackId,
    createdAt: now
  };
}

function timelineHistorySnapshot(draft: TimelineDraft): TimelineHistorySnapshot {
  return {
    durationMs: draft.durationMs,
    tracks: draft.tracks,
    editMode: draft.editMode,
    cameraDecisions: draft.cameraDecisions,
    cameraTransition: draft.cameraTransition,
    cameraTransitionMs: draft.cameraTransitionMs,
    loudnessTargetLufs: draft.loudnessTargetLufs,
    truePeakDb: draft.truePeakDb,
    editLog: draft.editLog,
    autoEdit: draft.autoEdit
  };
}

function commitTimelineMutation(draft: TimelineDraft, next: TimelineDraft, label: string, mergeKey: string | undefined, now: string): TimelineDraft {
  const before = timelineHistorySnapshot(draft);
  const after = timelineHistorySnapshot(next);
  if (JSON.stringify(before) === JSON.stringify(after)) return draft;
  const previous = draft.history[draft.history.length - 1];
  const mergeWithPrevious = Boolean(mergeKey && previous?.mergeKey === mergeKey && Math.abs(Date.parse(now) - Date.parse(previous.createdAt)) <= 1200);
  const entry: TimelineHistoryEntry = mergeWithPrevious
    ? { ...previous, after, createdAt: now }
    : {
        id: `history-${draft.version + 1}-${now}`,
        label,
        mergeKey,
        createdAt: now,
        before,
        after
      };
  const history = mergeWithPrevious ? [...draft.history.slice(0, -1), entry] : [...draft.history, entry];
  return {
    ...next,
    version: draft.version + 1,
    updatedAt: now,
    history: history.slice(-100),
    redoHistory: [],
    undoneEditLog: [],
    hasUnsavedChanges: true,
    nonDestructive: true
  };
}

export function commitTimelineDraftChange(draft: TimelineDraft, next: TimelineDraft, label: string, now = new Date().toISOString()) {
  return commitTimelineMutation(draft, next, label, undefined, now);
}

function formatTimelineTime(timestampMs: number) {
  const seconds = Math.max(0, Math.floor(timestampMs / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
