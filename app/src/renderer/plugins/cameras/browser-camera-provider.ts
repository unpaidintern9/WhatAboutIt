import type { StudioDevice } from "../devices/types";
import type { CameraProvider } from "./types";

export const browserCameraProvider: CameraProvider = {
  id: "local-browser-cameras",
  label: "Computer Cameras",
  kind: "local-browser",
  capabilities: {
    localPreview: true,
    wirelessDiscovery: false,
    batteryStatus: false,
    signalStatus: false,
    autoReconnect: true
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
