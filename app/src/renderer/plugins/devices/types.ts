export type StudioDeviceKind = "camera" | "microphone" | "speaker";
export type CameraConnectionType = "built-in" | "usb" | "capture-card" | "wireless" | "unknown";
export type CameraSignalStatus = "good" | "weak" | "lost" | "unknown";

export interface StudioDevice {
  id: string;
  label: string;
  kind: StudioDeviceKind;
  isDefault?: boolean;
  camera?: {
    connectionType: CameraConnectionType;
    signal: CameraSignalStatus;
    batteryPercent?: number;
    preferred?: boolean;
    autoReconnect?: boolean;
    maxResolution?: string;
    maxFps?: number;
  };
}

export interface DeviceDetectionResult {
  cameras: StudioDevice[];
  microphones: StudioDevice[];
  speakers: StudioDevice[];
  permissionNeeded: boolean;
  errorMessage?: string;
}

export interface DevicePlugin {
  detectDevices: () => Promise<DeviceDetectionResult>;
  requestStudioPermissions: () => Promise<DeviceDetectionResult>;
  sampleMicrophoneLevel: (deviceId?: string) => Promise<number>;
  playTestSound: (deviceId?: string) => Promise<void>;
  openCameraPreview: (deviceId?: string) => Promise<MediaStream>;
  openMicrophoneStream: (deviceId?: string) => Promise<MediaStream>;
}
