import type { TimelineCaptionCue } from "./timeline";

export type LocalTranscriptionStage =
  | "checking"
  | "downloading-engine"
  | "downloading-model"
  | "preparing-audio"
  | "transcribing"
  | "complete";

export interface LocalTranscriptionProgress {
  episodeId: string;
  stage: LocalTranscriptionStage;
  progress: number;
  message: string;
}

export interface LocalTranscriptionStatus {
  supported: boolean;
  ready: boolean;
  modelName: string;
  modelSizeBytes: number;
  message: string;
}

export interface LocalTranscriptionResult {
  cues: TimelineCaptionCue[];
  modelName: string;
  message: string;
}

interface WhisperJsonSegment {
  text?: unknown;
  offsets?: {
    from?: unknown;
    to?: unknown;
  };
  timestamps?: {
    from?: unknown;
    to?: unknown;
  };
}

function parseTimestamp(value: unknown) {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})[.,](\d{3})$/);
  if (!match) return undefined;
  return (((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000) + Number(match[4]);
}

function segmentTimes(segment: WhisperJsonSegment) {
  const offsetStart = typeof segment.offsets?.from === "number" ? segment.offsets.from : Number.NaN;
  const offsetEnd = typeof segment.offsets?.to === "number" ? segment.offsets.to : Number.NaN;
  if (Number.isFinite(offsetStart) && Number.isFinite(offsetEnd)) {
    return { startMs: offsetStart, endMs: offsetEnd };
  }
  return {
    startMs: parseTimestamp(segment.timestamps?.from),
    endMs: parseTimestamp(segment.timestamps?.to)
  };
}

export function parseWhisperJson(input: unknown, idPrefix = "caption-whisper"): TimelineCaptionCue[] {
  if (!input || typeof input !== "object") return [];
  const transcription = (input as { transcription?: unknown }).transcription;
  if (!Array.isArray(transcription)) return [];

  return transcription.flatMap((value, index) => {
    if (!value || typeof value !== "object") return [];
    const segment = value as WhisperJsonSegment;
    const text = typeof segment.text === "string" ? segment.text.replace(/\s+/g, " ").trim() : "";
    const { startMs, endMs } = segmentTimes(segment);
    if (!text || startMs === undefined || endMs === undefined || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
    return [{
      id: `${idPrefix}-${index + 1}`,
      startMs: Math.max(0, Math.round(startMs)),
      endMs: Math.max(1, Math.round(endMs)),
      text
    }];
  });
}
