import type { TimelineDraft } from "./timeline";
import type { DeviceDefaults } from "./types";

export type ExportType = "full-episode-video" | "audio-only" | "archive-master" | "social-clip-placeholder";
export type ExportQualityPreset = "standard" | "high" | "archive";
export type ExportJobStatus = "idle" | "queued" | "running" | "complete" | "canceled" | "error";

export interface ExportSettings {
  defaultExportFolder: string;
  defaultExportType: ExportType;
  qualityPreset: ExportQualityPreset;
}

export interface ExportRequest {
  episodeId: string;
  type: ExportType;
  qualityPreset: ExportQualityPreset;
  draft: TimelineDraft;
  deviceDefaults?: DeviceDefaults;
  practice?: boolean;
}

export interface MediaToolsStatus {
  ready: boolean;
  message: "Media tools are ready" | "Media tools need setup before export";
  ffmpegPath?: string;
  ffprobePath?: string;
  ffmpegVersion?: string;
  ffprobeVersion?: string;
}

export interface ExportJob {
  id: string;
  episodeId: string;
  type: ExportType;
  qualityPreset: ExportQualityPreset;
  status: ExportJobStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  outputFolder: string;
  message: string;
  error?: ExportFriendlyError;
  outputFileName?: string;
  outputFileNames?: string[];
}

export type ExportFriendlyError =
  | "recording-missing"
  | "media-tools-missing"
  | "not-enough-space"
  | "clip-range-missing"
  | "canceled"
  | "needs-attention";

export interface ExportSummary {
  jobId: string;
  episodeId: string;
  type: ExportType;
  qualityPreset: ExportQualityPreset;
  status: ExportJobStatus;
  createdAt: string;
  completedAt?: string;
  outputFolder: string;
  outputFileName?: string;
  originalRecordingSafe: true;
  message: string;
}

export const defaultExportSettings: ExportSettings = {
  defaultExportFolder: "Exports",
  defaultExportType: "full-episode-video",
  qualityPreset: "standard"
};

export const exportTypeLabels: Record<ExportType, { title: string; description: string; locked?: boolean }> = {
  "full-episode-video": {
    title: "Full Episode Video",
    description: "Ready for YouTube"
  },
  "audio-only": {
    title: "Audio Only",
    description: "Audio file for podcast platforms"
  },
  "archive-master": {
    title: "Archive Master",
    description: "A keepsake copy for your local archive"
  },
  "social-clip-placeholder": {
    title: "Social Clip",
    description: "Vertical video from the selected timeline range"
  }
};

export const exportFriendlyErrorCopy: Record<ExportFriendlyError, string> = {
  "recording-missing": "We couldn't find the recording file",
  "media-tools-missing": "Media tools need setup before export",
  "not-enough-space": "There isn't enough space",
  "clip-range-missing": "Select a timeline range before exporting a social clip",
  canceled: "Export was canceled",
  "needs-attention": "Something needs attention before export"
};

export function createExportJob(input: {
  episodeId: string;
  type: ExportType;
  qualityPreset: ExportQualityPreset;
  outputFolder: string;
  now?: string;
}): ExportJob {
  const now = input.now ?? new Date().toISOString();
  return {
    id: `export-${now.replace(/[:.]/g, "-")}`,
    episodeId: input.episodeId,
    type: input.type,
    qualityPreset: input.qualityPreset,
    status: "queued",
    progress: 0,
    createdAt: now,
    updatedAt: now,
    outputFolder: input.outputFolder,
    message: "Save a finished copy"
  };
}

export function completeExportJob(job: ExportJob, outputFileName: string, now = new Date().toISOString()): ExportJob {
  return {
    ...job,
    status: "complete",
    progress: 100,
    updatedAt: now,
    outputFileName,
    message: "Export complete"
  };
}

export function cancelExportJob(job: ExportJob, now = new Date().toISOString()): ExportJob {
  return {
    ...job,
    status: "canceled",
    progress: job.progress,
    updatedAt: now,
    error: "canceled",
    message: exportFriendlyErrorCopy.canceled
  };
}

export function failExportJob(job: ExportJob, error: ExportFriendlyError, now = new Date().toISOString()): ExportJob {
  return {
    ...job,
    status: "error",
    updatedAt: now,
    error,
    message: exportFriendlyErrorCopy[error]
  };
}

export function createExportSummary(job: ExportJob): ExportSummary {
  return {
    jobId: job.id,
    episodeId: job.episodeId,
    type: job.type,
    qualityPreset: job.qualityPreset,
    status: job.status,
    createdAt: job.createdAt,
    completedAt: job.status === "complete" ? job.updatedAt : undefined,
    outputFolder: job.outputFolder,
    outputFileName: job.outputFileName,
    originalRecordingSafe: true,
    message: job.message
  };
}
