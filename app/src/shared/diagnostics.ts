import type { DiagnosticsBundleRequest, DiagnosticsBundleResult } from "./hardware-test";

export type { DiagnosticsBundleRequest, DiagnosticsBundleResult };

export interface LiveLogInfo {
  folderPath: string;
  filePath: string;
  runId?: string;
  fallback?: boolean;
  droppedEntries?: number;
  loggingWarning?: string;
}

export interface RuntimeLogEntry {
  level: "info" | "warning" | "error" | "debug";
  source: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface StorageStatus {
  availableBytes?: number;
  message: "Storage check ready" | "Storage check unavailable";
}

export interface RecordingDriveCheck {
  folder: string;
  checkedAt: string;
  testedBytes: number;
  durationMs: number;
  writeBytesPerSecond: number;
  availableBytes: number;
}

export function recordingCaptureBytesPerSecond(cameraCount: number, microphoneCount: number, quality?: "balanced" | "high") {
  return (Math.max(1, cameraCount) * (quality === "high" ? 16_000_000 : 8_000_000) + microphoneCount * 48000 * 24) / 8;
}

export interface RecordingStorageAssessment {
  ready: boolean;
  requiredBytes: number;
  availableBytes?: number;
  estimatedMinutes: number;
  message: string;
}

export function assessRecordingStorage(input: {
  status?: StorageStatus;
  cameraCount: number;
  microphoneCount: number;
  estimatedMinutes: number;
  captureQuality?: "balanced" | "high";
}): RecordingStorageAssessment {
  const estimatedMinutes = Math.max(5, input.estimatedMinutes);
  const bitsPerCamera = input.captureQuality === "high" ? 16_000_000 : 8_000_000;
  const programBitsPerSecond = input.cameraCount === 0 ? bitsPerCamera : 0;
  const cameraBitsPerSecond = input.cameraCount * bitsPerCamera;
  const microphoneBitsPerSecond = input.microphoneCount * 48000 * 24;
  const captureBytes = ((programBitsPerSecond + cameraBitsPerSecond + microphoneBitsPerSecond) / 8) * estimatedMinutes * 60;
  const requiredBytes = Math.ceil(captureBytes * 3 + 2 * 1024 ** 3);
  const availableBytes = input.status?.availableBytes;
  const ready = Boolean(availableBytes && availableBytes >= requiredBytes);
  const requiredGb = Math.ceil(requiredBytes / 1024 ** 3);
  const availableGb = availableBytes === undefined ? undefined : Math.floor(availableBytes / 1024 ** 3);

  return {
    ready,
    requiredBytes,
    availableBytes,
    estimatedMinutes,
    message: availableGb === undefined
      ? "Storage could not be verified. Check the recording drive before starting."
      : ready
        ? `${availableGb} GB free · about ${requiredGb} GB reserved for ${estimatedMinutes} minutes`
        : `Only ${availableGb} GB free · about ${requiredGb} GB is needed for ${estimatedMinutes} minutes`
  };
}
