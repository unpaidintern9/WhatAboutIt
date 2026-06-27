import type { StudioDevice } from "../devices/types";
import type { CameraProvider, CameraProviderStatus } from "./types";
import { createUniversalCameraCapabilities } from "../../../shared/camera-config";

function unsupportedWirelessStatus(cameraId: string): CameraProviderStatus {
  return {
    cameraId,
    status: "needs-attention",
    friendlyMessage: "This camera may only support Bluetooth control, not wireless video",
    signal: "unknown",
    canRecord: false,
    fallbackRecommendations: ["Try USB", "Try HDMI capture", "Check Wi-Fi connection"]
  };
}

export const sonyUsbCameraProvider: CameraProvider = {
  id: "sony-usb-uvc-cameras",
  label: "Sony USB Cameras",
  kind: "usb-uvc",
  capabilities: {
    manufacturer: "Sony",
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
    return [];
  },
  async getCapabilities(cameraId: string) {
    return createUniversalCameraCapabilities({
      cameraName: cameraId,
      manufacturer: "Sony",
      usb: "available",
      previewReady: true,
      recordingReady: true,
      healthStatus: "ready"
    });
  },
  async connect(cameraId: string) {
    return {
      cameraId,
      status: "ready" as const,
      friendlyMessage: "Everything looks good",
      signal: "unknown" as const,
      canRecord: true
    };
  },
  async reconnect(cameraId: string) {
    return {
      cameraId,
      status: "ready" as const,
      friendlyMessage: "Everything looks good",
      signal: "unknown" as const,
      canRecord: true
    };
  },
  async forget(_cameraId: string) {
    await Promise.resolve();
  }
};

export const sonyHdmiCaptureProvider: CameraProvider = {
  ...sonyUsbCameraProvider,
  id: "sony-hdmi-capture-cameras",
  label: "Sony HDMI Capture",
  kind: "hdmi-capture",
  capabilities: {
    ...sonyUsbCameraProvider.capabilities,
    hdmi: true,
    usb: false
  },
  async getCapabilities(cameraId: string) {
    return createUniversalCameraCapabilities({
      cameraName: cameraId,
      manufacturer: "Sony",
      hdmi: "available",
      previewReady: true,
      recordingReady: true,
      healthStatus: "ready"
    });
  }
};

export const sonyWirelessCameraProvider: CameraProvider = {
  id: "sony-wireless-video-cameras",
  label: "Sony Wireless Cameras",
  kind: "wireless-discovery",
  capabilities: {
    manufacturer: "Sony",
    localPreview: false,
    wirelessDiscovery: true,
    batteryStatus: true,
    signalStatus: true,
    autoReconnect: true,
    remoteControl: true,
    hdmi: false,
    usb: false,
    networkStreaming: false
  },
  async discover(): Promise<StudioDevice[]> {
    return [];
  },
  async getCapabilities(cameraId: string) {
    return createUniversalCameraCapabilities({
      cameraName: cameraId,
      manufacturer: "Sony",
      wirelessVideo: "not-confirmed",
      remoteControl: "not-confirmed",
      battery: "not-confirmed",
      signalStrength: "not-confirmed",
      healthStatus: "needs-attention"
    });
  },
  async connect(cameraId: string) {
    return unsupportedWirelessStatus(cameraId);
  },
  async reconnect(cameraId: string) {
    return {
      ...unsupportedWirelessStatus(cameraId),
      friendlyMessage: "Check Wi-Fi connection",
      signal: "weak"
    };
  },
  async forget(_cameraId: string) {
    await Promise.resolve();
  }
};

export const sonyRemoteControlProvider: CameraProvider = {
  id: "sony-remote-control-capabilities",
  label: "Sony Remote Control",
  kind: "sony-remote-control",
  capabilities: {
    manufacturer: "Sony",
    localPreview: false,
    wirelessDiscovery: false,
    batteryStatus: true,
    signalStatus: false,
    autoReconnect: false,
    remoteControl: true,
    hdmi: false,
    usb: false,
    networkStreaming: false
  },
  async discover(): Promise<StudioDevice[]> {
    return [];
  },
  async getCapabilities(cameraId: string) {
    return createUniversalCameraCapabilities({
      cameraName: cameraId,
      manufacturer: "Sony",
      remoteControl: "not-confirmed",
      wirelessVideo: "unavailable",
      recordingReady: false,
      previewReady: false,
      healthStatus: "needs-attention"
    });
  },
  async connect(cameraId: string) {
    return {
      cameraId,
      status: "needs-attention" as const,
      friendlyMessage: "This camera may only support Bluetooth control, not wireless video",
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

export const futureSonySdkProvider: CameraProvider = {
  ...sonyRemoteControlProvider,
  id: "future-sony-sdk-provider",
  label: "Future Sony Camera Support",
  kind: "future-plugin"
};
