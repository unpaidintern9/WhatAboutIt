import type { ExportJobStatus } from "./export";
import type { RecordingStatus } from "./recording";

export type HardwareTestStep = "cameras" | "microphones" | "recording" | "export" | "results";
export type HardwareTestStatus = "not-run" | "ready" | "needs-attention";

export interface HardwareTestResult {
  label: string;
  status: HardwareTestStatus;
  message: string;
}

export interface HardwareTestResults {
  camera1: HardwareTestResult;
  camera2: HardwareTestResult;
  camera3: HardwareTestResult;
  morganMic: HardwareTestResult;
  exportReady: HardwareTestResult;
}

const stepOrder: HardwareTestStep[] = ["cameras", "microphones", "recording", "export", "results"];

export function getNextHardwareTestStep(step: HardwareTestStep): HardwareTestStep {
  return stepOrder[Math.min(stepOrder.indexOf(step) + 1, stepOrder.length - 1)];
}

export function getPreviousHardwareTestStep(step: HardwareTestStep): HardwareTestStep {
  return stepOrder[Math.max(stepOrder.indexOf(step) - 1, 0)];
}

export function createHardwareTestResult(label: string, ready: boolean | undefined): HardwareTestResult {
  if (ready === undefined) {
    return { label, status: "not-run", message: "Not checked yet" };
  }

  return ready
    ? { label, status: "ready", message: `${label} Ready` }
    : { label, status: "needs-attention", message: `${label} Needs Attention` };
}

export function createHardwareTestResults(input: {
  cameraReady?: [boolean | undefined, boolean | undefined, boolean | undefined];
  morganMicReady?: boolean;
  exportStatus?: ExportJobStatus;
} = {}): HardwareTestResults {
  const exportReady =
    input.exportStatus === undefined ? undefined : input.exportStatus === "complete";

  return {
    camera1: createHardwareTestResult("Camera 1", input.cameraReady?.[0]),
    camera2: createHardwareTestResult("Camera 2", input.cameraReady?.[1]),
    camera3: createHardwareTestResult("Camera 3", input.cameraReady?.[2]),
    morganMic: createHardwareTestResult("Morgan Mic", input.morganMicReady),
    exportReady: createHardwareTestResult("Export", exportReady)
  };
}

export function getRecordingTestStatus(status: RecordingStatus): HardwareTestStatus {
  if (status === "recording" || status === "paused" || status === "stopped") return "ready";
  if (status === "error" || status === "interrupted") return "needs-attention";
  return "not-run";
}

export function getExportTestStatus(status?: ExportJobStatus): HardwareTestStatus {
  if (!status || status === "idle" || status === "queued") return "not-run";
  if (status === "complete") return "ready";
  return "needs-attention";
}

export function getFriendlyHardwareFailureMessage(area: "camera" | "mic" | "recording" | "export") {
  const messages = {
    camera: "Camera needs attention before the test can pass.",
    mic: "Morgan Mic needs attention before the test can pass.",
    recording: "Recording needs attention. Your local files are still safe.",
    export: "Export needs attention before the finished test copy is ready."
  };

  return messages[area];
}
