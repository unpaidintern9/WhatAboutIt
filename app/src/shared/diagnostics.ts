import type { DiagnosticsBundleRequest, DiagnosticsBundleResult } from "./hardware-test";

export type { DiagnosticsBundleRequest, DiagnosticsBundleResult };

export interface StorageStatus {
  availableBytes?: number;
  message: "Storage check ready" | "Storage check unavailable";
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
}): RecordingStorageAssessment {
  const estimatedMinutes = Math.max(5, input.estimatedMinutes);
  const programBitsPerSecond = 8_000_000;
  const cameraBitsPerSecond = input.cameraCount * 6_000_000;
  const microphoneBitsPerSecond = input.microphoneCount * 192_000;
  const captureBytes = ((programBitsPerSecond + cameraBitsPerSecond + microphoneBitsPerSecond) / 8) * estimatedMinutes * 60;
  const requiredBytes = Math.ceil(captureBytes * 1.35 + 2 * 1024 ** 3);
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
