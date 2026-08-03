import type { DeviceDefaults } from "../../shared/types";
import { stopStudioMediaStream } from "../plugins/audio/studio-audio";
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
  private readonly managedStreams = new Map<string, MediaStream>();
  private readonly microphoneSources = new Map<string, MediaStream>();
  private readonly microphoneOpenPromises = new Map<string, Promise<MediaStream>>();
  private microphoneGeneration = 0;

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
    return this.openManagedStream(`camera:${deviceId ?? "none"}`, () => this.plugin.openCameraPreview(deviceId));
  }

  async openMicrophoneStream(deviceId?: string) {
    const key = deviceId ?? "none";
    let source = this.getLiveMicrophoneSource(key);
    if (!source) {
      let opening = this.microphoneOpenPromises.get(key);
      if (!opening) {
        const generation = this.microphoneGeneration;
        opening = this.plugin.openMicrophoneStream(deviceId).then((opened) => {
          if (generation !== this.microphoneGeneration) {
            stopStudioMediaStream(opened);
            throw new Error("Microphone request was released");
          }
          this.microphoneSources.set(key, opened);
          return opened;
        }).finally(() => this.microphoneOpenPromises.delete(key));
        this.microphoneOpenPromises.set(key, opening);
      }
      source = await opening;
    }
    return source.clone();
  }

  getActiveCameraStream(deviceId?: string) {
    return this.getManagedStream(`camera:${deviceId ?? "none"}`);
  }

  getActiveMicrophoneStream(deviceId?: string) {
    return this.getLiveMicrophoneSource(deviceId ?? "none");
  }

  releaseStream(kind: "camera" | "microphone", deviceId?: string, stream?: MediaStream) {
    if (kind === "microphone" && stream) {
      stopStudioMediaStream(stream);
      return;
    }
    this.stopManagedStream(`${kind}:${deviceId ?? "none"}`, stream);
  }

  releaseAll() {
    this.microphoneGeneration += 1;
    for (const key of Array.from(this.managedStreams.keys())) {
      this.stopManagedStream(key);
    }
    for (const stream of this.microphoneSources.values()) stopStudioMediaStream(stream);
    this.microphoneSources.clear();
    this.microphoneOpenPromises.clear();
  }

  private getLiveMicrophoneSource(key: string) {
    const stream = this.microphoneSources.get(key);
    if (!stream) return undefined;
    if (stream.getAudioTracks().some((track) => track.readyState === "live")) return stream;
    this.microphoneSources.delete(key);
    return undefined;
  }

  private async openManagedStream(key: string, open: () => Promise<MediaStream>) {
    this.stopManagedStream(key);
    const stream = await open();
    this.managedStreams.set(key, stream);
    stream.getTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        if (this.managedStreams.get(key) === stream) this.managedStreams.delete(key);
      }, { once: true });
    });
    return stream;
  }

  private getManagedStream(key: string) {
    const stream = this.managedStreams.get(key);
    if (!stream) return undefined;
    return stream.getTracks().some((track) => track.readyState === "live") ? stream : undefined;
  }

  private stopManagedStream(key: string, expectedStream?: MediaStream) {
    const stream = this.managedStreams.get(key);
    if (!stream) return;
    if (expectedStream && stream !== expectedStream) return;
    stopStudioMediaStream(stream);
    this.managedStreams.delete(key);
  }
}
