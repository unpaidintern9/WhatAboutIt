import type { StudioDevice } from "../devices/types";
import type { CameraProvider } from "./types";

export const wirelessCameraProvider: CameraProvider = {
  id: "wireless-camera-foundation",
  label: "Find Cameras",
  kind: "wireless-discovery",
  capabilities: {
    localPreview: false,
    wirelessDiscovery: true,
    batteryStatus: true,
    signalStatus: true,
    autoReconnect: true
  },

  async discover(): Promise<StudioDevice[]> {
    return [];
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
