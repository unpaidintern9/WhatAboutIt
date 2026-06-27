import type { CameraConnectionType, CameraSignalStatus, StudioDevice } from "../devices/types";

export type CameraProviderKind = "local-browser" | "wireless-discovery" | "future-plugin";

export interface CameraProviderCapabilities {
  localPreview: boolean;
  wirelessDiscovery: boolean;
  batteryStatus: boolean;
  signalStatus: boolean;
  autoReconnect: boolean;
}

export interface CameraProviderStatus {
  cameraId: string;
  status: "ready" | "needs-attention" | "not-connected";
  friendlyMessage: string;
  signal: CameraSignalStatus;
  batteryPercent?: number;
}

export interface CameraProvider {
  id: string;
  label: string;
  kind: CameraProviderKind;
  capabilities: CameraProviderCapabilities;
  discover: () => Promise<StudioDevice[]>;
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
