import type { DeviceDefaults } from "../../shared/types";
import { getDeviceAssignmentConflicts } from "../../shared/device-config";
import { stopStudioMediaStream } from "../plugins/audio/studio-audio";
import type { DeviceDetectionResult, DevicePlugin, StudioDevice } from "../plugins/devices/types";

export type StudioReadyState = "ready" | "needs-camera" | "needs-microphone" | "needs-permission" | "needs-routing";

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
  if (getDeviceAssignmentConflicts(defaults).length > 0) return "needs-routing";
  if (result.cameras.length === 0 || !defaults.cameras.camera1 || !result.cameras.some((device) => device.id === defaults.cameras.camera1)) return "needs-camera";
  if (result.microphones.length === 0 || !defaults.microphones.morganMic || !result.microphones.some((device) => device.id === defaults.microphones.morganMic)) return "needs-microphone";
  return "ready";
}

export function findDeviceLabel(devices: StudioDevice[], deviceId?: string) {
  return devices.find((device) => device.id === deviceId)?.label ?? "Not picked yet";
}

export class DeviceService {
  private readonly cameraSources = new Map<string, MediaStream>();
  private readonly cameraOpenPromises = new Map<string, Promise<MediaStream>>();
  private readonly streamConsumers = new Map<MediaStream, { kind: "camera" | "microphone"; key: string }>();
  private readonly idleSourceTimers = new Map<string, number>();
  private readonly microphoneSources = new Map<string, MediaStream>();
  private readonly microphoneOpenPromises = new Map<string, Promise<MediaStream>>();
  private deviceDetectionPromise?: Promise<DeviceDetectionResult>;
  private permissionRequestPromise?: Promise<DeviceDetectionResult>;
  private lastDeviceDetection?: { result: DeviceDetectionResult; timestamp: number };
  private cameraGeneration = 0;
  private microphoneGeneration = 0;

  constructor(private readonly plugin: DevicePlugin) {}

  detectDevices() {
    if (this.deviceDetectionPromise) return this.deviceDetectionPromise;
    if (this.lastDeviceDetection && Date.now() - this.lastDeviceDetection.timestamp < 750) {
      return Promise.resolve(this.lastDeviceDetection.result);
    }
    const pending = this.plugin.detectDevices().then((result) => {
      this.lastDeviceDetection = { result, timestamp: Date.now() };
      return result;
    }).finally(() => {
      if (this.deviceDetectionPromise === pending) this.deviceDetectionPromise = undefined;
    });
    this.deviceDetectionPromise = pending;
    return pending;
  }

  requestStudioPermissions() {
    if (this.permissionRequestPromise) return this.permissionRequestPromise;
    const pending = this.plugin.requestStudioPermissions().then((result) => {
      this.lastDeviceDetection = { result, timestamp: Date.now() };
      return result;
    }).finally(() => {
      if (this.permissionRequestPromise === pending) this.permissionRequestPromise = undefined;
    });
    this.permissionRequestPromise = pending;
    return pending;
  }

  sampleMicrophoneLevel(deviceId?: string) {
    return this.plugin.sampleMicrophoneLevel(deviceId);
  }

  playTestSound(deviceId?: string) {
    return this.plugin.playTestSound(deviceId);
  }

  async openCameraPreview(deviceId?: string) {
    const key = deviceId ?? "none";
    this.cancelIdleSourceStop("camera", key);
    let source = this.getLiveCameraSource(key);
    if (!source) {
      let opening = this.cameraOpenPromises.get(key);
      if (!opening) {
        const generation = this.cameraGeneration;
        opening = this.plugin.openCameraPreview(deviceId).then((opened) => {
          if (generation !== this.cameraGeneration) {
            stopStudioMediaStream(opened);
            throw new Error("Camera request was released");
          }
          this.cameraSources.set(key, opened);
          opened.getVideoTracks().forEach((track) => {
            track.addEventListener("ended", () => {
              if (this.cameraSources.get(key) === opened) this.cameraSources.delete(key);
            }, { once: true });
          });
          return opened;
        }).finally(() => {
          if (this.cameraOpenPromises.get(key) === opening) this.cameraOpenPromises.delete(key);
        });
        this.cameraOpenPromises.set(key, opening);
      }
      source = await opening;
    }
    const consumer = source.clone();
    this.streamConsumers.set(consumer, { kind: "camera", key });
    return consumer;
  }

  async openMicrophoneStream(deviceId?: string) {
    const key = deviceId ?? "none";
    this.cancelIdleSourceStop("microphone", key);
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
        }).finally(() => {
          if (this.microphoneOpenPromises.get(key) === opening) this.microphoneOpenPromises.delete(key);
        });
        this.microphoneOpenPromises.set(key, opening);
      }
      source = await opening;
    }
    const consumer = source.clone();
    this.streamConsumers.set(consumer, { kind: "microphone", key });
    return consumer;
  }

  getActiveCameraStream(deviceId?: string) {
    return this.getLiveCameraSource(deviceId ?? "none");
  }

  getActiveMicrophoneStream(deviceId?: string) {
    return this.getLiveMicrophoneSource(deviceId ?? "none");
  }

  releaseStream(kind: "camera" | "microphone", deviceId?: string, stream?: MediaStream) {
    if (stream) {
      stopStudioMediaStream(stream);
      const consumer = this.streamConsumers.get(stream);
      this.streamConsumers.delete(stream);
      if (consumer) this.scheduleIdleSourceStop(consumer.kind, consumer.key);
      return;
    }
    const key = deviceId ?? "none";
    if (kind === "camera") this.stopCameraSource(key);
    else this.stopMicrophoneSource(key);
  }

  releaseAll() {
    this.cameraGeneration += 1;
    this.microphoneGeneration += 1;
    for (const timer of this.idleSourceTimers.values()) window.clearTimeout(timer);
    this.idleSourceTimers.clear();
    for (const stream of this.streamConsumers.keys()) stopStudioMediaStream(stream);
    this.streamConsumers.clear();
    for (const stream of this.cameraSources.values()) stopStudioMediaStream(stream);
    this.cameraSources.clear();
    this.cameraOpenPromises.clear();
    for (const stream of this.microphoneSources.values()) stopStudioMediaStream(stream);
    this.microphoneSources.clear();
    this.microphoneOpenPromises.clear();
  }

  private getLiveCameraSource(key: string) {
    const stream = this.cameraSources.get(key);
    if (!stream) return undefined;
    if (stream.getVideoTracks().some((track) => track.readyState === "live")) return stream;
    this.cameraSources.delete(key);
    return undefined;
  }

  private getLiveMicrophoneSource(key: string) {
    const stream = this.microphoneSources.get(key);
    if (!stream) return undefined;
    if (stream.getAudioTracks().some((track) => track.readyState === "live")) return stream;
    this.microphoneSources.delete(key);
    return undefined;
  }

  private stopCameraSource(key: string) {
    this.cancelIdleSourceStop("camera", key);
    const stream = this.cameraSources.get(key);
    if (!stream) return;
    stopStudioMediaStream(stream);
    this.cameraSources.delete(key);
  }

  private stopMicrophoneSource(key: string) {
    this.cancelIdleSourceStop("microphone", key);
    const stream = this.microphoneSources.get(key);
    if (!stream) return;
    stopStudioMediaStream(stream);
    this.microphoneSources.delete(key);
  }

  private scheduleIdleSourceStop(kind: "camera" | "microphone", key: string) {
    const timerKey = `${kind}:${key}`;
    if ([...this.streamConsumers.values()].some((consumer) => consumer.kind === kind && consumer.key === key)) return;
    this.cancelIdleSourceStop(kind, key);
    this.idleSourceTimers.set(timerKey, window.setTimeout(() => {
      this.idleSourceTimers.delete(timerKey);
      if ([...this.streamConsumers.values()].some((consumer) => consumer.kind === kind && consumer.key === key)) return;
      if (kind === "camera") this.stopCameraSource(key);
      else this.stopMicrophoneSource(key);
    }, 1000));
  }

  private cancelIdleSourceStop(kind: "camera" | "microphone", key: string) {
    const timerKey = `${kind}:${key}`;
    const timer = this.idleSourceTimers.get(timerKey);
    if (timer) window.clearTimeout(timer);
    this.idleSourceTimers.delete(timerKey);
  }
}
