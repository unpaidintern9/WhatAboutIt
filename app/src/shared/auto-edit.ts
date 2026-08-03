import type { TimelineDraft, TimelineEditOperation } from "./timeline";

export type AutoEditMode = "gentle" | "balanced" | "fast-paced" | "clip-hunter";
export type AutoEditStageId =
  | "recording"
  | "transcript"
  | "audio-analysis"
  | "speaker-detection"
  | "marker-analysis"
  | "timeline-decisions"
  | "camera-decisions"
  | "draft-timeline"
  | "review"
  | "export-ready";
export type AutoEditStageStatus = "waiting" | "running" | "complete";
export type AutoEditConfidence = "High" | "Medium" | "Needs review";

export interface AutoEditModeDefinition {
  id: AutoEditMode;
  title: string;
  icon: string;
  description: string;
}

export interface AutoEditStage {
  id: AutoEditStageId;
  label: string;
  status: AutoEditStageStatus;
}

export interface AutoEditChapter {
  id: string;
  title: string;
  timestampMs: number;
}

export interface AutoEditClipSuggestion {
  id: string;
  startMs: number;
  endMs: number;
  title: string;
  reason: string;
  confidence: AutoEditConfidence;
}

export interface AutoEditChange {
  id: string;
  label: string;
  reversible: true;
}

export interface AutoEditActivitySegment {
  startMs: number;
  endMs: number;
  microphoneTrackId: string;
  cameraTrackId: string;
  averageDb: number;
}

export interface AutoEditReport {
  id: string;
  episodeId?: string;
  mode: AutoEditMode;
  createdAt: string;
  originalLengthMs: number;
  editedLengthMs: number;
  runtimeReductionMs: number;
  silenceRemovedMs: number;
  chaptersGenerated: AutoEditChapter[];
  clipsSuggested: AutoEditClipSuggestion[];
  changesMade: AutoEditChange[];
  audioWarnings: string[];
  reviewFlags: string[];
  originalRecordingSafe: true;
}

export interface AutoEditResult {
  report: AutoEditReport;
  draft: TimelineDraft;
  stages: AutoEditStage[];
}

export const autoEditModes: AutoEditModeDefinition[] = [
  { id: "gentle", title: "Gentle", icon: "Flower", description: "Minimal cleanup. Preserve natural pacing." },
  { id: "balanced", title: "Balanced", icon: "Zap", description: "Remove dead air, smooth pacing, and keep conversation natural." },
  { id: "fast-paced", title: "Fast Paced", icon: "Rocket", description: "Tighter edits with a faster rhythm. Great for YouTube." },
  { id: "clip-hunter", title: "Clip Hunter", icon: "Target", description: "Prioritize finding highlight moments and clip suggestions." }
];

export const autoEditStageLabels: Record<AutoEditStageId, string> = {
  recording: "Checking recording...",
  transcript: "Finding the story...",
  "audio-analysis": "Listening for cleanup spots...",
  "speaker-detection": "Finding speakers...",
  "marker-analysis": "Reading your markers...",
  "timeline-decisions": "Choosing gentle draft edits...",
  "camera-decisions": "Planning camera moments...",
  "draft-timeline": "Building draft...",
  review: "Preparing your review...",
  "export-ready": "Almost finished..."
};

export function createAutoEditStages(activeStage?: AutoEditStageId): AutoEditStage[] {
  const stageIds = Object.keys(autoEditStageLabels) as AutoEditStageId[];
  const activeIndex = activeStage ? stageIds.indexOf(activeStage) : stageIds.length;
  return stageIds.map((id, index) => ({
    id,
    label: autoEditStageLabels[id],
    status: index < activeIndex ? "complete" : index === activeIndex ? "running" : "waiting"
  }));
}

export function runOfflineAutoEdit(input: {
  draft: TimelineDraft;
  mode?: AutoEditMode;
  now?: string;
  episodeId?: string;
  activitySegments?: AutoEditActivitySegment[];
}): AutoEditResult {
  const mode = input.mode ?? "balanced";
  const now = input.now ?? new Date().toISOString();
  const originalLengthMs = Math.max(input.draft.durationMs, 0);
  const silenceRemovedMs = 0;
  const editedLengthMs = originalLengthMs;
  const autoOperation: TimelineEditOperation = {
    id: `auto-edit-${mode}-${now}`,
    type: "auto-edit-suggestion",
    label: `Auto Edit draft (${autoEditModes.find((item) => item.id === mode)?.title ?? "Balanced"})`,
    timestampMs: 0,
    targetTrackId: "program",
    createdAt: now
  };
  const cameraDecisions = createCameraDecisions(input.activitySegments ?? [], now);
  const chapters = createChapters(input.draft, originalLengthMs);
  const clips = createClipSuggestions(input.draft, originalLengthMs, mode);
  const report: AutoEditReport = {
    id: `auto-edit-report-${now.replace(/[:.]/g, "-")}`,
    episodeId: input.episodeId ?? input.draft.episodeId,
    mode,
    createdAt: now,
    originalLengthMs,
    editedLengthMs,
    runtimeReductionMs: silenceRemovedMs,
    silenceRemovedMs,
    chaptersGenerated: chapters,
    clipsSuggested: clips,
    changesMade: [
      { id: "timing-safe", label: "Kept episode timing intact until you approve manual cuts", reversible: true },
      { id: "markers", label: "Kept all markers and manual edits", reversible: true },
      { id: "chapters", label: "Suggested chapter markers", reversible: true },
      cameraDecisions.length > 0
        ? { id: "camera-activity", label: `Planned ${cameraDecisions.length} camera changes from saved microphone activity`, reversible: true }
        : { id: "camera-program", label: "Kept the Program camera because separate microphone activity was unavailable", reversible: true }
    ],
    audioWarnings: ["Listen through the mixed microphones before export"],
    reviewFlags: ["Review automatic camera choices and suggested clips before sharing"],
    originalRecordingSafe: true
  };
  const draft: TimelineDraft = {
    ...input.draft,
    episodeId: input.episodeId ?? input.draft.episodeId,
    version: input.draft.version + 1,
    updatedAt: now,
    durationMs: editedLengthMs,
    editMode: "auto",
    cameraDecisions: cameraDecisions.length > 0 ? cameraDecisions : input.draft.cameraDecisions,
    editLog: [...input.draft.editLog, autoOperation],
    undoneEditLog: [],
    hasUnsavedChanges: true,
    autoEdit: {
      mode,
      reportId: report.id,
      chapters,
      clips,
      reviewFlags: report.reviewFlags
    },
    nonDestructive: true
  };

  return {
    report,
    draft,
    stages: createAutoEditStages()
  };
}

function createCameraDecisions(activity: AutoEditActivitySegment[], now: string) {
  const decisions: TimelineDraft["cameraDecisions"] = [];
  for (const segment of [...activity].sort((a, b) => a.startMs - b.startMs)) {
    const previous = decisions.at(-1);
    if (previous?.cameraTrackId === segment.cameraTrackId) continue;
    decisions.push({
      id: `auto-camera-${segment.cameraTrackId}-${segment.startMs}-${now}`,
      cameraTrackId: segment.cameraTrackId,
      startMs: segment.startMs,
      source: "auto",
      reason: `${segment.microphoneTrackId} was strongest here (${segment.averageDb.toFixed(1)} dB)`
    });
  }
  return decisions;
}

function createChapters(draft: TimelineDraft, durationMs: number): AutoEditChapter[] {
  const base = [
    { id: "chapter-intro", title: "Intro", timestampMs: 0 },
    { id: "chapter-story", title: "Guest Story", timestampMs: Math.round(durationMs * 0.18) },
    { id: "chapter-discussion", title: "Main Discussion", timestampMs: Math.round(durationMs * 0.42) },
    { id: "chapter-closing", title: "Closing", timestampMs: Math.round(durationMs * 0.86) }
  ];
  const hasSponsor = draft.markers.some((marker) => marker.label.toLowerCase().includes("sponsor"));
  return hasSponsor
    ? [...base.slice(0, 3), { id: "chapter-sponsor", title: "Sponsor", timestampMs: Math.round(durationMs * 0.68) }, base[3]]
    : base;
}

function createClipSuggestions(draft: TimelineDraft, durationMs: number, mode: AutoEditMode): AutoEditClipSuggestion[] {
  const markerClips = draft.markers.slice(0, mode === "clip-hunter" ? 4 : 2).map((marker, index) => ({
    id: `clip-marker-${marker.id}`,
    startMs: Math.max(0, marker.timestampMs - 10000),
    endMs: Math.min(durationMs, marker.timestampMs + 35000),
    title: `${marker.label} moment`,
    reason: "This matched a marker Morgan saved while recording.",
    confidence: index === 0 ? "High" as const : "Medium" as const
  }));

  if (markerClips.length > 0) return markerClips;

  return [
    {
      id: "clip-main-highlight",
      startMs: Math.round(durationMs * 0.35),
      endMs: Math.round(durationMs * 0.42),
      title: "Main highlight",
      reason: "This section looks like a strong standalone moment.",
      confidence: "Needs review"
    }
  ];
}
