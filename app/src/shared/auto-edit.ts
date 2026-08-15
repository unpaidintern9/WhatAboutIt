import { commitTimelineDraftChange, type TimelineCameraDecision, type TimelineDraft, type TimelineEditOperation, type TimelineTrack } from "./timeline";

export type AutoEditMode = "gentle" | "balanced" | "fast-paced" | "clip-hunter";
export type AutoEditStageId = "recording" | "transcript" | "audio-analysis" | "speaker-detection" | "marker-analysis" | "timeline-decisions" | "camera-decisions" | "draft-timeline" | "review" | "export-ready";
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

export interface AutoEditSilenceSegment {
  startMs: number;
  endMs: number;
}

export interface AutoEditSilenceSuggestion extends AutoEditSilenceSegment {
  id: string;
  accepted: boolean;
}

export interface AutoEditLearningProfile {
  sampleCount: number;
  updatedAt: string;
  preferredMode: AutoEditMode;
  audioTreatment: Pick<TimelineTrack, "audioPreset" | "noiseReduction" | "noiseGateDb" | "deEsser" | "compression" | "eqLowDb" | "eqMidDb" | "eqHighDb">;
  cameraTreatment: Pick<TimelineTrack, "cropMode" | "brightness" | "contrast" | "saturation" | "temperature" | "tint" | "sharpness" | "denoise" | "zoom" | "positionX" | "positionY">;
  cameraTransition: TimelineDraft["cameraTransition"];
  cameraTransitionMs: number;
  minimumCameraHoldMs: number;
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
  silenceSuggestions: AutoEditSilenceSuggestion[];
  chaptersGenerated: AutoEditChapter[];
  clipsSuggested: AutoEditClipSuggestion[];
  changesMade: AutoEditChange[];
  audioWarnings: string[];
  reviewFlags: string[];
  learningSummary?: string;
  originalRecordingSafe: true;
}

export interface AutoEditResult {
  report: AutoEditReport;
  draft: TimelineDraft;
  stages: AutoEditStage[];
}

export const autoEditModes: AutoEditModeDefinition[] = [
  {
    id: "gentle",
    title: "Gentle",
    icon: "Flower",
    description: "Light voice and picture polish. Preserve natural pacing."
  },
  {
    id: "balanced",
    title: "Balanced",
    icon: "Zap",
    description: "Polish voices, smooth camera choices, and keep conversation natural."
  },
  {
    id: "fast-paced",
    title: "Fast Paced",
    icon: "Rocket",
    description: "Stronger voice polish and direct camera cuts for a tighter rhythm."
  },
  {
    id: "clip-hunter",
    title: "Clip Hunter",
    icon: "Target",
    description: "Polish the episode and prioritize strong highlight suggestions."
  }
];

export const autoEditStageLabels: Record<AutoEditStageId, string> = {
  recording: "Checking saved sources...",
  transcript: "Checking episode notes...",
  "audio-analysis": "Listening for cleanup spots...",
  "speaker-detection": "Matching microphones to cameras...",
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

export function runOfflineAutoEdit(input: { draft: TimelineDraft; mode?: AutoEditMode; now?: string; episodeId?: string; activitySegments?: AutoEditActivitySegment[]; silenceSegments?: AutoEditSilenceSegment[]; learningProfile?: AutoEditLearningProfile }): AutoEditResult {
  const mode = input.mode ?? "balanced";
  const now = input.now ?? new Date().toISOString();
  const originalLengthMs = Math.max(input.draft.durationMs, 0);
  const silenceSuggestions = createSilenceSuggestions(input.silenceSegments ?? [], mode, originalLengthMs);
  const silenceRemovedMs = silenceSuggestions.reduce((total, segment) => total + segment.endMs - segment.startMs, 0);
  const editedLengthMs = Math.max(0, originalLengthMs - silenceRemovedMs);
  const autoOperation: TimelineEditOperation = {
    id: `auto-edit-${mode}-${now}`,
    type: "auto-edit-suggestion",
    label: `Auto Edit draft (${autoEditModes.find((item) => item.id === mode)?.title ?? "Balanced"})`,
    timestampMs: 0,
    targetTrackId: "program",
    createdAt: now
  };
  const minimumCameraHoldMs = getMinimumCameraHoldMs(mode, input.learningProfile);
  const cameraDecisions = createCameraDecisions(input.activitySegments ?? [], now, minimumCameraHoldMs);
  const mergedCameraDecisions = mergeAutoCameraDecisions(input.draft.cameraDecisions, cameraDecisions);
  const silenceOperations: TimelineEditOperation[] = silenceSuggestions.map((segment) => ({
    id: segment.id,
    type: "delete-section",
    label: "Remove long pause",
    timestampMs: segment.startMs,
    endTimestampMs: segment.endMs,
    targetTrackId: "program",
    createdAt: now
  }));
  const polishedTracks = input.draft.tracks.map((track) => applyAutoEditProductionPolish(track, mode, input.learningProfile));
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
    silenceSuggestions,
    chaptersGenerated: chapters,
    clipsSuggested: clips,
    changesMade: [
      silenceSuggestions.length > 0
        ? {
            id: "timing-pauses",
            label: `Removed ${silenceSuggestions.length} long ${silenceSuggestions.length === 1 ? "pause" : "pauses"} for review`,
            reversible: true
          }
        : {
            id: "timing-safe",
            label: "Kept episode timing intact because no long pauses were detected",
            reversible: true
          },
      {
        id: "markers",
        label: "Kept all markers and manual edits",
        reversible: true
      },
      { id: "chapters", label: "Suggested chapter markers", reversible: true },
      {
        id: "voice-polish",
        label: "Applied podcast voice cleanup, tone, dynamics, and output protection to every saved microphone",
        reversible: true
      },
      {
        id: "camera-polish",
        label: "Applied conservative denoise, color balance, and sharpening to every saved camera",
        reversible: true
      },
      ...(input.learningProfile
        ? [
            {
              id: "learning-profile",
              label: `Used ${input.learningProfile.sampleCount} approved manual ${input.learningProfile.sampleCount === 1 ? "draft" : "drafts"} to match your production style`,
              reversible: true as const
            }
          ]
        : []),
      {
        id: "camera-transitions",
        label: mode === "gentle" ? "Added short fades through black between camera choices" : "Kept direct camera cuts for a clean conversational rhythm",
        reversible: true
      },
      cameraDecisions.length > 0
        ? {
            id: "camera-activity",
            label: `Planned ${cameraDecisions.length} camera changes from saved microphone activity`,
            reversible: true
          }
        : {
            id: "camera-program",
            label: "Kept the Program camera because separate microphone activity was unavailable",
            reversible: true
          }
    ],
    audioWarnings: ["Listen through each polished microphone and the final mix before export"],
    reviewFlags: ["Review automatic camera choices, voice cleanup, picture finishing, and suggested clips before sharing"],
    learningSummary: input.learningProfile
      ? `Learned from ${input.learningProfile.sampleCount} approved manual ${input.learningProfile.sampleCount === 1 ? "draft" : "drafts"}. Camera choices hold for at least ${(minimumCameraHoldMs / 1000).toFixed(1)} seconds.`
      : "No approved manual drafts yet. Auto Edit used the selected production mode.",
    originalRecordingSafe: true
  };
  const proposedDraft: TimelineDraft = {
    ...input.draft,
    episodeId: input.episodeId ?? input.draft.episodeId,
    durationMs: originalLengthMs,
    editMode: "auto",
    tracks: polishedTracks,
    cameraDecisions: mergedCameraDecisions,
    cameraTransition: input.learningProfile?.cameraTransition ?? (mode === "gentle" ? "fade" : "cut"),
    cameraTransitionMs: input.learningProfile?.cameraTransitionMs ?? (mode === "gentle" ? 300 : 180),
    editLog: [
      ...input.draft.editLog.filter((operation) => operation.type !== "auto-edit-suggestion" && !operation.id.startsWith("auto-silence-")),
      ...silenceOperations,
      autoOperation
    ],
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
  const draft = commitTimelineDraftChange(input.draft, proposedDraft, `Auto Edit draft (${mode})`, now);

  return {
    report,
    draft,
    stages: createAutoEditStages()
  };
}

export function mergeAutoCameraDecisions(existing: TimelineCameraDecision[], generated: TimelineCameraDecision[]) {
  const manualDecisions = existing.filter((decision) => decision.source === "manual").sort((left, right) => left.startMs - right.startMs);
  if (manualDecisions.length === 0) return generated.length > 0 ? generated : existing;

  const firstManualStartMs = manualDecisions[0].startMs;
  const unclaimedAutomaticDecisions = generated.filter((decision) => decision.startMs < firstManualStartMs);
  return [...unclaimedAutomaticDecisions, ...manualDecisions].sort((left, right) => left.startMs - right.startMs);
}

export function applyAutoEditProductionPolish(track: TimelineTrack, mode: AutoEditMode, learningProfile?: AutoEditLearningProfile): TimelineTrack {
  if (track.kind === "microphone") {
    const profile = {
      gentle: {
        audioPreset: "clean" as const,
        noiseReduction: 12,
        noiseGateDb: -60,
        deEsser: 18,
        compression: 24,
        eqLowDb: 0,
        eqMidDb: 0,
        eqHighDb: 1
      },
      balanced: {
        audioPreset: "warm" as const,
        noiseReduction: 24,
        noiseGateDb: -54,
        deEsser: 32,
        compression: 45,
        eqLowDb: 1,
        eqMidDb: 0,
        eqHighDb: 1
      },
      "fast-paced": {
        audioPreset: "broadcast" as const,
        noiseReduction: 32,
        noiseGateDb: -50,
        deEsser: 42,
        compression: 62,
        eqLowDb: -1,
        eqMidDb: 1,
        eqHighDb: 2
      },
      "clip-hunter": {
        audioPreset: "broadcast" as const,
        noiseReduction: 28,
        noiseGateDb: -52,
        deEsser: 38,
        compression: 55,
        eqLowDb: 0,
        eqMidDb: 1,
        eqHighDb: 2
      }
    }[mode];
    const learned = learningProfile?.audioTreatment;
    return {
      ...track,
      ...blendTreatment(profile, learned, learningWeight(learningProfile)),
      limiterEnabled: true
    };
  }
  if (track.kind === "camera") {
    const profile = {
      gentle: { denoise: 8, sharpness: 10, contrast: 102, saturation: 101 },
      balanced: { denoise: 14, sharpness: 18, contrast: 104, saturation: 103 },
      "fast-paced": {
        denoise: 18,
        sharpness: 24,
        contrast: 108,
        saturation: 106
      },
      "clip-hunter": {
        denoise: 16,
        sharpness: 22,
        contrast: 106,
        saturation: 105
      }
    }[mode];
    return {
      ...track,
      ...blendTreatment(profile, learningProfile?.cameraTreatment, learningWeight(learningProfile))
    };
  }
  return track;
}

function createCameraDecisions(activity: AutoEditActivitySegment[], now: string, minimumCameraHoldMs: number) {
  const decisions: TimelineDraft["cameraDecisions"] = [];
  for (const segment of [...activity].sort((a, b) => a.startMs - b.startMs)) {
    const previous = decisions.at(-1);
    if (previous?.cameraTrackId === segment.cameraTrackId) continue;
    if (previous && segment.startMs - previous.startMs < minimumCameraHoldMs) continue;
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

function createSilenceSuggestions(segments: AutoEditSilenceSegment[], mode: AutoEditMode, durationMs: number): AutoEditSilenceSuggestion[] {
  const minimumDurationMs = {
    gentle: 2500,
    balanced: 1600,
    "fast-paced": 900,
    "clip-hunter": 1800
  }[mode];
  const breathingRoomMs = mode === "fast-paced" ? 180 : mode === "gentle" ? 450 : 300;
  return segments
    .filter((segment) => segment.endMs - segment.startMs >= minimumDurationMs)
    .map((segment, index) => ({
      id: `auto-silence-${index}-${Math.round(segment.startMs)}`,
      startMs: Math.max(0, Math.round(segment.startMs + breathingRoomMs)),
      endMs: Math.min(durationMs, Math.round(segment.endMs - breathingRoomMs)),
      accepted: true
    }))
    .filter((segment) => segment.endMs - segment.startMs >= 400);
}

export function learnAutoEditProfile(draft: TimelineDraft, previous?: AutoEditLearningProfile, preferredMode: AutoEditMode = previous?.preferredMode ?? "balanced", now = new Date().toISOString()): AutoEditLearningProfile {
  const microphones = draft.tracks.filter((track) => track.kind === "microphone");
  const cameras = draft.tracks.filter((track) => track.kind === "camera");
  const audioTreatment = averageAudioTreatment(microphones);
  const cameraTreatment = averageCameraTreatment(cameras);
  const sampleCount = (previous?.sampleCount ?? 0) + 1;
  const manualCuts = draft.cameraDecisions.filter((decision) => decision.source === "manual").sort((a, b) => a.startMs - b.startMs);
  const gaps = manualCuts
    .slice(1)
    .map((decision, index) => decision.startMs - manualCuts[index].startMs)
    .filter((gap) => gap > 0);
  const observedHold = gaps.length > 0 ? average(gaps) : (previous?.minimumCameraHoldMs ?? 3500);
  return {
    sampleCount,
    updatedAt: now,
    preferredMode,
    audioTreatment: previous ? mergeTreatment(previous.audioTreatment, audioTreatment, previous.sampleCount) : audioTreatment,
    cameraTreatment: previous ? mergeTreatment(previous.cameraTreatment, cameraTreatment, previous.sampleCount) : cameraTreatment,
    cameraTransition: draft.cameraTransition,
    cameraTransitionMs: draft.cameraTransitionMs,
    minimumCameraHoldMs: Math.round(Math.max(1500, Math.min(12000, observedHold)))
  };
}

function getMinimumCameraHoldMs(mode: AutoEditMode, profile?: AutoEditLearningProfile) {
  const modeHold = {
    gentle: 6000,
    balanced: 3500,
    "fast-paced": 1800,
    "clip-hunter": 2500
  }[mode];
  if (!profile) return modeHold;
  const weight = learningWeight(profile);
  return Math.round(modeHold * (1 - weight) + profile.minimumCameraHoldMs * weight);
}

function learningWeight(profile?: AutoEditLearningProfile) {
  return profile ? Math.min(0.65, 0.2 + profile.sampleCount * 0.1) : 0;
}

function blendTreatment<T extends Record<string, string | number>>(base: T, learned: T | undefined, weight: number): T {
  if (!learned || weight <= 0) return base;
  return Object.fromEntries(
    Object.entries(base).map(([key, value]) => {
      const learnedValue = learned[key];
      if (typeof value === "number" && typeof learnedValue === "number") return [key, Math.round((value * (1 - weight) + learnedValue * weight) * 10) / 10];
      return [key, weight >= 0.4 ? learnedValue : value];
    })
  ) as T;
}

function mergeTreatment<T extends Record<string, string | number>>(previous: T, current: T, previousSamples: number): T {
  return Object.fromEntries(
    Object.entries(current).map(([key, value]) => {
      const previousValue = previous[key];
      if (typeof value === "number" && typeof previousValue === "number") return [key, Math.round(((previousValue * previousSamples + value) / (previousSamples + 1)) * 10) / 10];
      return [key, value];
    })
  ) as T;
}

function averageAudioTreatment(tracks: TimelineTrack[]): AutoEditLearningProfile["audioTreatment"] {
  const fallback = {
    audioPreset: "warm" as const,
    noiseReduction: 24,
    noiseGateDb: -54,
    deEsser: 32,
    compression: 45,
    eqLowDb: 1,
    eqMidDb: 0,
    eqHighDb: 1
  };
  if (tracks.length === 0) return fallback;
  return {
    audioPreset: mostCommon(tracks.map((track) => track.audioPreset)) ?? fallback.audioPreset,
    noiseReduction: average(tracks.map((track) => track.noiseReduction)),
    noiseGateDb: average(tracks.map((track) => track.noiseGateDb)),
    deEsser: average(tracks.map((track) => track.deEsser)),
    compression: average(tracks.map((track) => track.compression)),
    eqLowDb: average(tracks.map((track) => track.eqLowDb)),
    eqMidDb: average(tracks.map((track) => track.eqMidDb)),
    eqHighDb: average(tracks.map((track) => track.eqHighDb))
  };
}

function averageCameraTreatment(tracks: TimelineTrack[]): AutoEditLearningProfile["cameraTreatment"] {
  const fallback = {
    cropMode: "fit" as const,
    brightness: 0,
    contrast: 104,
    saturation: 103,
    temperature: 0,
    tint: 0,
    sharpness: 18,
    denoise: 14,
    zoom: 100,
    positionX: 0,
    positionY: 0
  };
  if (tracks.length === 0) return fallback;
  return {
    cropMode: mostCommon(tracks.map((track) => track.cropMode)) ?? fallback.cropMode,
    brightness: average(tracks.map((track) => track.brightness)),
    contrast: average(tracks.map((track) => track.contrast)),
    saturation: average(tracks.map((track) => track.saturation)),
    temperature: average(tracks.map((track) => track.temperature)),
    tint: average(tracks.map((track) => track.tint)),
    sharpness: average(tracks.map((track) => track.sharpness)),
    denoise: average(tracks.map((track) => track.denoise)),
    zoom: average(tracks.map((track) => track.zoom)),
    positionX: average(tracks.map((track) => track.positionX)),
    positionY: average(tracks.map((track) => track.positionY))
  };
}

function average(values: number[]) {
  return values.length === 0 ? 0 : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function mostCommon<T extends string>(values: T[]): T | undefined {
  return values.reduce<{ value?: T; count: number }>(
    (winner, value) => {
      const count = values.filter((candidate) => candidate === value).length;
      return count > winner.count ? { value, count } : winner;
    },
    { count: 0 }
  ).value;
}

function createChapters(draft: TimelineDraft, durationMs: number): AutoEditChapter[] {
  const base = [
    { id: "chapter-intro", title: "Intro", timestampMs: 0 },
    {
      id: "chapter-story",
      title: "Guest Story",
      timestampMs: Math.round(durationMs * 0.18)
    },
    {
      id: "chapter-discussion",
      title: "Main Discussion",
      timestampMs: Math.round(durationMs * 0.42)
    },
    {
      id: "chapter-closing",
      title: "Closing",
      timestampMs: Math.round(durationMs * 0.86)
    }
  ];
  const hasSponsor = draft.markers.some((marker) => marker.label.toLowerCase().includes("sponsor"));
  return hasSponsor
    ? [
        ...base.slice(0, 3),
        {
          id: "chapter-sponsor",
          title: "Sponsor",
          timestampMs: Math.round(durationMs * 0.68)
        },
        base[3]
      ]
    : base;
}

function createClipSuggestions(draft: TimelineDraft, durationMs: number, mode: AutoEditMode): AutoEditClipSuggestion[] {
  const markerClips = draft.markers.slice(0, mode === "clip-hunter" ? 4 : 2).map((marker, index) => ({
    id: `clip-marker-${marker.id}`,
    startMs: Math.max(0, marker.timestampMs - 10000),
    endMs: Math.min(durationMs, marker.timestampMs + 35000),
    title: `${marker.label} moment`,
    reason: "This matched a marker Morgan saved while recording.",
    confidence: index === 0 ? ("High" as const) : ("Medium" as const)
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
