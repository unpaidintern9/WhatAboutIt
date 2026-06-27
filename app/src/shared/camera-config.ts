import type { DeviceDefaults } from "./types";

export type CameraSlotId = "camera1" | "camera2" | "camera3";
export type SonyCameraConnectionMethod = "usb-webcam" | "hdmi-capture" | "wifi-video" | "bluetooth-control" | "remote-control" | "future-sdk";
export type SonyCapabilityStatus = "supported" | "not-supported" | "not-confirmed";
export type CameraConnectionHealth = "ready" | "needs-attention" | "signal-weak" | "battery-low" | "not-connected";

export interface CameraAdvancedSettings {
  connectionType: "built-in" | "usb" | "capture-card" | "wireless" | "unknown";
  resolution: string;
  fps: number;
  preferredCamera: boolean;
  autoReconnect: boolean;
}

export interface CameraAssignment {
  slot: CameraSlotId;
  label: "Camera 1" | "Camera 2" | "Camera 3";
  deviceId?: string;
  order: number;
}

export interface SonyCameraCapability {
  model: string;
  firmware?: string;
  usbWebcam: SonyCapabilityStatus;
  hdmiCapture: SonyCapabilityStatus;
  wifiVideo: SonyCapabilityStatus;
  bluetoothControl: SonyCapabilityStatus;
  remoteControl: SonyCapabilityStatus;
  batteryStatus: SonyCapabilityStatus;
}

export interface CameraFallbackRecommendation {
  label: "Try USB" | "Try HDMI capture" | "Check Wi-Fi connection" | "This camera may only support Bluetooth control, not wireless video";
}

export interface CameraConnectionState {
  cameraId: string;
  health: CameraConnectionHealth;
  userStatus: "Ready" | "Needs attention" | "Signal weak" | "Battery low" | "Not connected";
  canRecord: boolean;
  signal?: "good" | "weak" | "lost" | "unknown";
  batteryPercent?: number;
  recommendations: CameraFallbackRecommendation[];
}

export const cameraSlotOrder: CameraSlotId[] = ["camera1", "camera2", "camera3"];

export const defaultCameraAdvancedSettings: CameraAdvancedSettings = {
  connectionType: "unknown",
  resolution: "Auto",
  fps: 30,
  preferredCamera: false,
  autoReconnect: true
};

export function getOrderedCameraAssignments(defaults: DeviceDefaults): CameraAssignment[] {
  return cameraSlotOrder.map((slot, index) => ({
    slot,
    label: `Camera ${index + 1}` as CameraAssignment["label"],
    deviceId: defaults.cameras[slot],
    order: index + 1
  }));
}

export function saveCameraAdvancedSettings(
  defaults: DeviceDefaults,
  cameraId: string,
  settings: Partial<CameraAdvancedSettings>
): DeviceDefaults {
  return {
    ...defaults,
    cameraSettings: {
      ...defaults.cameraSettings,
      [cameraId]: {
        ...defaultCameraAdvancedSettings,
        ...defaults.cameraSettings?.[cameraId],
        ...settings
      }
    }
  };
}

export function getCameraAdvancedSettings(defaults: DeviceDefaults, cameraId?: string): CameraAdvancedSettings {
  if (!cameraId) return defaultCameraAdvancedSettings;
  return {
    ...defaultCameraAdvancedSettings,
    ...defaults.cameraSettings?.[cameraId]
  };
}

export function createSonyCapabilityAudit(input: Partial<SonyCameraCapability> & { model?: string }): SonyCameraCapability {
  return {
    model: input.model?.trim() || "Sony camera model not provided",
    firmware: input.firmware,
    usbWebcam: input.usbWebcam ?? "not-confirmed",
    hdmiCapture: input.hdmiCapture ?? "not-confirmed",
    wifiVideo: input.wifiVideo ?? "not-confirmed",
    bluetoothControl: input.bluetoothControl ?? "not-confirmed",
    remoteControl: input.remoteControl ?? "not-confirmed",
    batteryStatus: input.batteryStatus ?? "not-confirmed"
  };
}

export function wirelessVideoRecommendations(capability: SonyCameraCapability): CameraFallbackRecommendation[] {
  if (capability.wifiVideo === "supported") return [{ label: "Check Wi-Fi connection" }];
  if (capability.bluetoothControl === "supported") {
    return [
      { label: "This camera may only support Bluetooth control, not wireless video" },
      { label: "Try USB" },
      { label: "Try HDMI capture" }
    ];
  }
  return [{ label: "Try USB" }, { label: "Try HDMI capture" }, { label: "Check Wi-Fi connection" }];
}

export function createCameraConnectionState(input: {
  cameraId: string;
  connected: boolean;
  signal?: "good" | "weak" | "lost" | "unknown";
  batteryPercent?: number;
  wirelessCapability?: SonyCameraCapability;
}): CameraConnectionState {
  if (!input.connected) {
    return {
      cameraId: input.cameraId,
      health: "not-connected",
      userStatus: "Not connected",
      canRecord: false,
      signal: input.signal ?? "unknown",
      batteryPercent: input.batteryPercent,
      recommendations: input.wirelessCapability ? wirelessVideoRecommendations(input.wirelessCapability) : [{ label: "Try USB" }]
    };
  }

  if (input.signal === "weak") {
    return {
      cameraId: input.cameraId,
      health: "signal-weak",
      userStatus: "Signal weak",
      canRecord: true,
      signal: input.signal,
      batteryPercent: input.batteryPercent,
      recommendations: [{ label: "Check Wi-Fi connection" }]
    };
  }

  if (input.batteryPercent !== undefined && input.batteryPercent <= 15) {
    return {
      cameraId: input.cameraId,
      health: "battery-low",
      userStatus: "Battery low",
      canRecord: true,
      signal: input.signal ?? "unknown",
      batteryPercent: input.batteryPercent,
      recommendations: [{ label: "Try USB" }]
    };
  }

  return {
    cameraId: input.cameraId,
    health: "ready",
    userStatus: "Ready",
    canRecord: true,
    signal: input.signal ?? "unknown",
    batteryPercent: input.batteryPercent,
    recommendations: []
  };
}

export function createSonyConnectionMatrix(capability: SonyCameraCapability) {
  return [
    { method: "usb-webcam" as const, status: capability.usbWebcam, recommendation: "Try USB" as const },
    { method: "hdmi-capture" as const, status: capability.hdmiCapture, recommendation: "Try HDMI capture" as const },
    { method: "wifi-video" as const, status: capability.wifiVideo, recommendation: "Check Wi-Fi connection" as const },
    {
      method: "bluetooth-control" as const,
      status: capability.bluetoothControl,
      recommendation: "This camera may only support Bluetooth control, not wireless video" as const
    },
    { method: "remote-control" as const, status: capability.remoteControl, recommendation: "Try USB" as const },
    { method: "future-sdk" as const, status: "not-confirmed" as const, recommendation: "Try USB" as const }
  ];
}
