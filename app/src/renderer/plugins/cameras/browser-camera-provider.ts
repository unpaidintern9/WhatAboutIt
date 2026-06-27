import type { StudioDevice } from "../devices/types";
import type { CameraProvider } from "./types";
import { createUniversalCameraCapabilities } from "../../../shared/camera-config";

export const browserCameraProvider: CameraProvider = {
  id: "local-browser-cameras",
  label: "Computer Cameras",
  kind: "local-browser",
  capabilities: {
    manufacturer: "USB webcam",
    localPreview: true,
    wirelessDiscovery: false,
    batteryStatus: false,
    signalStatus: false,
    autoReconnect: true,
    remoteControl: false,
    hdmi: false,
    usb: true,
    networkStreaming: false
  },

  async discover(): Promise<StudioDevice[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];

    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "videoinput")
      .map((device, index) => ({
        id: device.deviceId,
        label: device.label || `Camera ${index + 1}`,
        kind: "camera" as const,
        isDefault: device.deviceId === "default",
        camera: {
          connectionType: index === 0 ? "built-in" : "usb",
          signal: "unknown",
          autoReconnect: true,
          maxResolution: "Auto",
          maxFps: 30
        }
      }));
  },

  async getCapabilities(cameraId: string) {
    return createUniversalCameraCapabilities({
      cameraName: cameraId,
      manufacturer: "USB webcam",
      usb: "available",
      previewReady: true,
      recordingReady: true,
      healthStatus: "ready",
      wirelessVideo: "unavailable",
      remoteControl: "unavailable",
      hdmi: "unavailable",
      networkStreaming: "unavailable",
      resolution: "available",
      frameRate: "available"
    });
  },

  async connect(cameraId: string) {
    return {
      cameraId,
      status: "ready" as const,
      friendlyMessage: "Everything looks good",
      signal: "unknown" as const
    };
  },

  async reconnect(cameraId: string) {
    return {
      cameraId,
      status: "ready" as const,
      friendlyMessage: "Everything looks good",
      signal: "unknown" as const
    };
  },

  async forget(_cameraId: string) {
    await Promise.resolve();
  }
};
