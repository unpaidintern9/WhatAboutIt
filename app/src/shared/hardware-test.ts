import type { ExportJobStatus } from "./export";
import type { RecordingStatus } from "./recording";
import type { DeviceDefaults } from "./types";

export type HardwareTestStep = "cameras" | "microphones" | "recording" | "export" | "results";
export type HardwareTestStatus = "not-run" | "ready" | "needs-attention" | "disconnected" | "reconnecting";

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

export interface HardwareDeviceSummary {
  id: string;
  label: string;
  kind: "camera" | "microphone" | "speaker";
}

export interface HardwareDeviceReadiness {
  cameraReady: [boolean | undefined, boolean | undefined, boolean | undefined];
  morganMicReady?: boolean;
  summary: "Everything Ready" | "Needs Attention";
  message: string;
  missingDeviceIds: string[];
}

export interface DiagnosticsBundleRequest {
  devices: HardwareDeviceSummary[];
  results: HardwareTestResults;
  appVersion: string;
  activeEpisodeId?: string;
  recordingSessionFolder?: string;
  message: string;
}

export interface DiagnosticsBundleResult {
  folderPath: string;
  files: string[];
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

export function createHardwareStateResult(label: string, status: HardwareTestStatus): HardwareTestResult {
  const messages: Record<HardwareTestStatus, string> = {
    "not-run": "Not checked yet",
    ready: `${label} Ready`,
    "needs-attention": `${label} Needs Attention`,
    disconnected: `${label} Disconnected`,
    reconnecting: `${label} Reconnecting`
  };

  return { label, status, message: messages[status] };
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

function hasDevice(devices: HardwareDeviceSummary[], deviceId?: string) {
  if (!deviceId) return undefined;
  return devices.some((device) => device.id === deviceId);
}

function hasAnyDevice(devices: HardwareDeviceSummary[], kind: HardwareDeviceSummary["kind"]) {
  return devices.some((device) => device.kind === kind);
}

export function getHardwareDeviceReadiness(defaults: DeviceDefaults, devices: HardwareDeviceSummary[]): HardwareDeviceReadiness {
  const cameraDevices = devices.filter((device) => device.kind === "camera");
  const microphoneDevices = devices.filter((device) => device.kind === "microphone");
  const cameraSlots = [defaults.cameras.camera1, defaults.cameras.camera2, defaults.cameras.camera3] as const;
  const cameraReady = cameraSlots.map((deviceId, index) => {
    // Camera 2 and Camera 3 are optional. An unassigned optional slot must not
    // turn the hardware test red just because only one camera is connected.
    if (!deviceId) return index === 0 ? Boolean(cameraDevices[0]) : undefined;
    return hasDevice(cameraDevices, deviceId);
  }) as [boolean | undefined, boolean | undefined, boolean | undefined];
  const morganMicReady = defaults.microphones.morganMic
    ? hasDevice(microphoneDevices, defaults.microphones.morganMic)
    : hasAnyDevice(devices, "microphone");
  const missingDeviceIds = [
    ...cameraSlots.filter((deviceId): deviceId is string => Boolean(deviceId) && !hasDevice(cameraDevices, deviceId)),
    ...(defaults.microphones.morganMic && !hasDevice(microphoneDevices, defaults.microphones.morganMic)
      ? [defaults.microphones.morganMic]
      : [])
  ];
  const ready = Boolean(cameraReady[0] && morganMicReady && missingDeviceIds.length === 0);

  return {
    cameraReady,
    morganMicReady,
    summary: ready ? "Everything Ready" : "Needs Attention",
    message: ready
      ? "Everything Ready"
      : missingDeviceIds.length > 0
      ? "A saved device is missing. Your choice is still remembered."
      : "Pick a camera and microphone before recording.",
    missingDeviceIds
  };
}

export function didDeviceDisconnectDuringRecording(input: {
  status: RecordingStatus;
  defaults: DeviceDefaults;
  devices: HardwareDeviceSummary[];
}) {
  if (input.status !== "recording" && input.status !== "paused") return false;
  const readiness = getHardwareDeviceReadiness(input.defaults, input.devices);
  return readiness.missingDeviceIds.length > 0 || readiness.cameraReady[0] === false || readiness.morganMicReady === false;
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
