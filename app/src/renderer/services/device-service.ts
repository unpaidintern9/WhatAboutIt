import type { DeviceDefaults } from "../../shared/types";
import type { DeviceDetectionResult, DevicePlugin, StudioDevice } from "../plugins/devices/types";

export type StudioReadyState = "ready" | "needs-camera" | "needs-microphone" | "needs-permission";

export function getEmptyStateMessage(kind: "camera" | "microphone" | "speaker" | "permission" | "quiet" | "busy" | "ready") {
  const messages = {
    camera: "No camera found",
    microphone: "No microphone found",
    speaker: "Pick your headphones or speakers when they show up.",
    permission: "Permission needed",
    quiet: "We can't hear you yet",
    busy: "Camera is busy in another app",
    ready: "Everything looks good"
  };

  return messages[kind];
}

export function getDeviceReadiness(result: DeviceDetectionResult, defaults: DeviceDefaults): StudioReadyState {
  if (result.permissionNeeded) return "needs-permission";
  if (result.cameras.length === 0 || !defaults.cameras.camera1) return "needs-camera";
  if (result.microphones.length === 0 || !defaults.microphones.morganMic) return "needs-microphone";
  return "ready";
}

export function findDeviceLabel(devices: StudioDevice[], deviceId?: string) {
  return devices.find((device) => device.id === deviceId)?.label ?? "Not picked yet";
}

export class DeviceService {
  constructor(private readonly plugin: DevicePlugin) {}

  detectDevices() {
    return this.plugin.detectDevices();
  }

  requestStudioPermissions() {
    return this.plugin.requestStudioPermissions();
  }

  sampleMicrophoneLevel(deviceId?: string) {
    return this.plugin.sampleMicrophoneLevel(deviceId);
  }

  playTestSound(deviceId?: string) {
    return this.plugin.playTestSound(deviceId);
  }

  openCameraPreview(deviceId?: string) {
    return this.plugin.openCameraPreview(deviceId);
  }

  openMicrophoneStream(deviceId?: string) {
    return this.plugin.openMicrophoneStream(deviceId);
  }
}
