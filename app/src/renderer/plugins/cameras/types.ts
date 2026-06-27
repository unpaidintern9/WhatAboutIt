import type { CameraConnectionType, CameraSignalStatus, StudioDevice } from "../devices/types";
import type { CameraManufacturer, UniversalCameraCapabilities } from "../../../shared/camera-config";

export type CameraProviderKind =
  | "local-browser"
  | "usb-uvc"
  | "hdmi-capture"
  | "wireless-discovery"
  | "sony-remote-control"
  | "future-plugin";

export interface CameraProviderCapabilities {
  manufacturer: CameraManufacturer;
  localPreview: boolean;
  wirelessDiscovery: boolean;
  batteryStatus: boolean;
  signalStatus: boolean;
  autoReconnect: boolean;
  remoteControl: boolean;
  hdmi: boolean;
  usb: boolean;
  networkStreaming: boolean;
}

export interface CameraProviderStatus {
  cameraId: string;
  status: "ready" | "needs-attention" | "not-connected" | "signal-weak" | "battery-low";
  friendlyMessage: string;
  signal: CameraSignalStatus;
  batteryPercent?: number;
  canRecord?: boolean;
  fallbackRecommendations?: string[];
}

export interface CameraProvider {
  id: string;
  label: string;
  kind: CameraProviderKind;
  capabilities: CameraProviderCapabilities;
  discover: () => Promise<StudioDevice[]>;
  getCapabilities: (cameraId: string) => Promise<UniversalCameraCapabilities>;
  connect: (cameraId: string) => Promise<CameraProviderStatus>;
  reconnect: (cameraId: string) => Promise<CameraProviderStatus>;
  forget: (cameraId: string) => Promise<void>;
}

export interface CameraAdvancedSettings {
  connectionType: CameraConnectionType;
  resolution: string;
  fps: number;
  preferredCamera: boolean;
  autoReconnect: boolean;
}
