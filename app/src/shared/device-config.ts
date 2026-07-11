import type { DeviceDefaults, StudioSettings } from "./types";

export const defaultDeviceDefaults: DeviceDefaults = {
  cameras: {},
  cameraMicrophones: {
    camera1: "morganMic",
    camera2: "guestMic",
    camera3: "extraMic"
  },
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
      cameraMicrophones: {
        ...defaultDeviceDefaults.cameraMicrophones,
        ...settings.deviceDefaults?.cameraMicrophones
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

export function saveCameraMicrophoneSlot(
  defaults: DeviceDefaults,
  slot: keyof DeviceDefaults["cameras"],
  micSlot: keyof DeviceDefaults["microphones"]
) {
  return {
    ...defaults,
    cameraMicrophones: {
      ...defaultDeviceDefaults.cameraMicrophones,
      ...defaults.cameraMicrophones,
      [slot]: micSlot
    }
  };
}
