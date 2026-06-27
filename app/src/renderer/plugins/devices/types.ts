export type StudioDeviceKind = "camera" | "microphone" | "speaker";

export interface StudioDevice {
  id: string;
  label: string;
  kind: StudioDeviceKind;
  isDefault?: boolean;
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
}

