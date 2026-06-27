import { createUniversalCameraCapabilities, type CameraManufacturer } from "../../../shared/camera-config";
import type { StudioDevice } from "../devices/types";
import type { CameraProvider } from "./types";

function createUnavailableProvider(input: {
  id: string;
  label: string;
  manufacturer: CameraManufacturer;
  usb?: boolean;
  hdmi?: boolean;
  wireless?: boolean;
  remoteControl?: boolean;
  networkStreaming?: boolean;
}): CameraProvider {
  return {
    id: input.id,
    label: input.label,
    kind: input.networkStreaming ? "wireless-discovery" : input.hdmi ? "hdmi-capture" : input.usb ? "usb-uvc" : "future-plugin",
    capabilities: {
      manufacturer: input.manufacturer,
      localPreview: Boolean(input.usb || input.hdmi),
      wirelessDiscovery: Boolean(input.wireless || input.networkStreaming),
      batteryStatus: false,
      signalStatus: Boolean(input.wireless || input.networkStreaming),
      autoReconnect: true,
      remoteControl: Boolean(input.remoteControl),
      hdmi: Boolean(input.hdmi),
      usb: Boolean(input.usb),
      networkStreaming: Boolean(input.networkStreaming)
    },
    async discover(): Promise<StudioDevice[]> {
      return [];
    },
    async getCapabilities(cameraId: string) {
      return createUniversalCameraCapabilities({
        cameraName: cameraId,
        manufacturer: input.manufacturer,
        usb: input.usb ? "not-confirmed" : "unavailable",
        hdmi: input.hdmi ? "not-confirmed" : "unavailable",
        wirelessVideo: input.wireless ? "not-confirmed" : "unavailable",
        remoteControl: input.remoteControl ? "not-confirmed" : "unavailable",
        networkStreaming: input.networkStreaming ? "not-confirmed" : "unavailable",
        healthStatus: "not-connected"
      });
    },
    async connect(cameraId: string) {
      return {
        cameraId,
        status: "not-connected" as const,
        friendlyMessage: "Needs attention",
        signal: "unknown" as const,
        canRecord: false,
        fallbackRecommendations: ["Try USB", "Try HDMI capture"]
      };
    },
    async reconnect(cameraId: string) {
      return this.connect(cameraId);
    },
    async forget(_cameraId: string) {
      await Promise.resolve();
    }
  };
}

export const universalCameraProviders: CameraProvider[] = [
  createUnavailableProvider({ id: "canon-camera-provider", label: "Canon Cameras", manufacturer: "Canon", usb: true, hdmi: true, wireless: true, remoteControl: true }),
  createUnavailableProvider({ id: "nikon-camera-provider", label: "Nikon Cameras", manufacturer: "Nikon", usb: true, hdmi: true, wireless: true, remoteControl: true }),
  createUnavailableProvider({ id: "panasonic-camera-provider", label: "Panasonic Cameras", manufacturer: "Panasonic", usb: true, hdmi: true, wireless: true, remoteControl: true }),
  createUnavailableProvider({ id: "fujifilm-camera-provider", label: "Fujifilm Cameras", manufacturer: "Fujifilm", usb: true, hdmi: true, wireless: true, remoteControl: true }),
  createUnavailableProvider({ id: "gopro-camera-provider", label: "GoPro Cameras", manufacturer: "GoPro", usb: true, hdmi: true, wireless: true }),
  createUnavailableProvider({ id: "dji-camera-provider", label: "DJI Cameras", manufacturer: "DJI", usb: true, hdmi: true, wireless: true, remoteControl: true }),
  createUnavailableProvider({ id: "blackmagic-camera-provider", label: "Blackmagic Cameras", manufacturer: "Blackmagic", usb: true, hdmi: true, remoteControl: true }),
  createUnavailableProvider({ id: "generic-hdmi-capture-provider", label: "HDMI Capture", manufacturer: "HDMI capture", hdmi: true }),
  createUnavailableProvider({ id: "generic-network-camera-provider", label: "Network Cameras", manufacturer: "Network camera", wireless: true, networkStreaming: true }),
  createUnavailableProvider({ id: "future-camera-provider", label: "Future Camera Providers", manufacturer: "Future provider" })
];
