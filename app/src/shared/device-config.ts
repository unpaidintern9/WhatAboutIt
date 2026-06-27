import type { DeviceDefaults, StudioSettings } from "./types";

export const defaultDeviceDefaults: DeviceDefaults = {
  cameras: {},
  microphones: {},
  audioOutputId: undefined
};

export function withDeviceDefaults(settings: StudioSettings): StudioSettings {
  return {
    ...settings,
    deviceDefaults: {
      cameras: {
        ...defaultDeviceDefaults.cameras,
        ...settings.deviceDefaults?.cameras
      },
      cameraSettings: settings.deviceDefaults?.cameraSettings
        ? {
            ...settings.deviceDefaults.cameraSettings
          }
        : undefined,
      microphones: {
        ...defaultDeviceDefaults.microphones,
        ...settings.deviceDefaults?.microphones
      },
      audioOutputId: settings.deviceDefaults?.audioOutputId
    }
  };
}

export function saveCameraSlot(defaults: DeviceDefaults, slot: keyof DeviceDefaults["cameras"], deviceId: string) {
  return {
    ...defaults,
    cameras: {
      ...defaults.cameras,
      [slot]: deviceId || undefined
    }
  };
}

export function saveMicrophoneSlot(
  defaults: DeviceDefaults,
  slot: keyof DeviceDefaults["microphones"],
  deviceId: string
) {
  return {
    ...defaults,
    microphones: {
      ...defaults.microphones,
      [slot]: deviceId || undefined
    }
  };
}
