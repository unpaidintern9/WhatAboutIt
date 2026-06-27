import type { StudioDevice } from "../devices/types";
import type { CameraProvider } from "./types";
import { createUniversalCameraCapabilities } from "../../../shared/camera-config";

export const wirelessCameraProvider: CameraProvider = {
  id: "wireless-camera-foundation",
  label: "Find Cameras",
  kind: "wireless-discovery",
  capabilities: {
    manufacturer: "Network camera",
    localPreview: false,
    wirelessDiscovery: true,
    batteryStatus: true,
    signalStatus: true,
    autoReconnect: true,
    remoteControl: false,
    hdmi: false,
    usb: false,
    networkStreaming: true
  },

  async discover(): Promise<StudioDevice[]> {
    return [];
  },

  async getCapabilities(cameraId: string) {
    return createUniversalCameraCapabilities({
      cameraName: cameraId,
      manufacturer: "Network camera",
      wirelessVideo: "not-confirmed",
      networkStreaming: "not-confirmed",
      battery: "not-confirmed",
      signalStrength: "not-confirmed",
      healthStatus: "needs-attention"
    });
  },

  async connect(cameraId: string) {
    return {
      cameraId,
      status: "needs-attention" as const,
      friendlyMessage: "We found it, but it needs one more step before it is ready",
      signal: "unknown" as const
    };
  },

  async reconnect(cameraId: string) {
    return {
      cameraId,
      status: "needs-attention" as const,
      friendlyMessage: "Trying to reconnect",
      signal: "weak" as const
    };
  },

  async forget(_cameraId: string) {
    await Promise.resolve();
  }
};
