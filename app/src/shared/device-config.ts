import type { DeviceDefaults, StudioSettings } from "./types";

export const defaultDeviceDefaults: DeviceDefaults = {
  cameras: {},
  cameraMicrophones: {
    camera1: "morganMic",
    camera2: "guestMic",
    camera3: "extraMic"
  },
  microphones: {},
  microphoneChannels: {
    morganMic: "mix",
    guestMic: "mix",
    extraMic: "mix"
  },
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
      microphoneChannels: {
        ...defaultDeviceDefaults.microphoneChannels,
        ...settings.deviceDefaults?.microphoneChannels
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

export function saveMicrophoneInputChannel(
  defaults: DeviceDefaults,
  slot: keyof DeviceDefaults["microphones"],
  channel: NonNullable<DeviceDefaults["microphoneChannels"]>[keyof DeviceDefaults["microphones"]]
) {
  return {
    ...defaults,
    microphoneChannels: {
      ...defaultDeviceDefaults.microphoneChannels,
      ...defaults.microphoneChannels,
      [slot]: channel ?? "mix"
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
