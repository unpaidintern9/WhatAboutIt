import type { CameraSlotKey, DeviceDefaults, MicrophoneInputChannel, MicrophoneSlotKey, StudioSettings } from "./types";

export interface DeviceAssignmentConflict {
  kind: "camera" | "microphone-route";
  deviceId: string;
  slots: string[];
  channel?: string;
}

export const microphoneInputChannelOptions: Array<{ value: MicrophoneInputChannel; label: string }> = [
  { value: "mix", label: "Automatic / combined input" },
  { value: "input-1", label: "Physical Input 1 (left channel)" },
  { value: "input-2", label: "Physical Input 2 (right channel)" },
  { value: "input-3", label: "Input 3" },
  { value: "input-4", label: "Input 4" },
  { value: "input-5", label: "Input 5" },
  { value: "input-6", label: "Input 6" },
  { value: "input-7", label: "Input 7" },
  { value: "input-8", label: "Input 8" },
  { value: "input-9", label: "Input 9" },
  { value: "input-10", label: "Input 10" },
  { value: "input-11", label: "Input 11" },
  { value: "input-12", label: "Input 12" },
  { value: "input-13", label: "Input 13" },
  { value: "input-14", label: "Input 14" },
  { value: "input-15", label: "Input 15" },
  { value: "input-16", label: "Input 16" }
];

export function getMicrophoneInputDisplay(channel: MicrophoneInputChannel) {
  if (channel === "input-1") return { short: "Jack 1 / Left", detail: "Physical Input 1 on the interface" };
  if (channel === "input-2") return { short: "Jack 2 / Right", detail: "Physical Input 2 on the interface" };
  if (channel === "mix") return { short: "Automatic / Combined", detail: "All browser-visible channels combined" };
  const number = channel.replace("input-", "");
  return { short: `Input ${number}`, detail: `Physical Input ${number} on the interface` };
}

const numberedMicrophoneInputs = microphoneInputChannelOptions
  .map((option) => option.value)
  .filter((channel): channel is Exclude<MicrophoneInputChannel, "mix"> => channel !== "mix");

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
  microphoneNames: {
    morganMic: "Morgan",
    guestMic: "Guest",
    extraMic: "Extra"
  },
  microphoneDeviceLabels: {},
  audioOutputId: undefined
};

export function withDeviceDefaults(settings: StudioSettings): StudioSettings {
  const mergedDefaults: DeviceDefaults = {
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
    microphoneNames: {
      ...defaultDeviceDefaults.microphoneNames,
      ...settings.deviceDefaults?.microphoneNames
    },
    microphoneDeviceLabels: {
      ...defaultDeviceDefaults.microphoneDeviceLabels,
      ...settings.deviceDefaults?.microphoneDeviceLabels
    },
    audioOutputId: settings.deviceDefaults?.audioOutputId
  };
  return {
    ...settings,
    deviceDefaults: normalizeSharedMicrophoneRoutes(mergedDefaults)
  };
}

/**
 * Older settings allowed two named microphone tracks to point at the same
 * browser-visible interface mix. That produces two files containing the same
 * combined audio. Preserve single-device laptop microphones, but when multiple
 * roles share one physical interface allocate a unique physical input to each.
 */
export function normalizeSharedMicrophoneRoutes(defaults: DeviceDefaults): DeviceDefaults {
  const microphoneChannels = {
    ...defaultDeviceDefaults.microphoneChannels,
    ...defaults.microphoneChannels
  };
  const slotsByDevice = new Map<string, MicrophoneSlotKey[]>();

  for (const [slot, deviceId] of Object.entries(defaults.microphones) as Array<[MicrophoneSlotKey, string | undefined]>) {
    if (!deviceId) continue;
    slotsByDevice.set(deviceId, [...(slotsByDevice.get(deviceId) ?? []), slot]);
  }

  for (const slots of slotsByDevice.values()) {
    if (slots.length < 2) continue;
    const used = new Set<MicrophoneInputChannel>();
    for (const slot of slots) {
      const savedChannel = microphoneChannels[slot] ?? "mix";
      const channel = savedChannel !== "mix" && !used.has(savedChannel)
        ? savedChannel
        : numberedMicrophoneInputs.find((candidate) => !used.has(candidate)) ?? "mix";
      microphoneChannels[slot] = channel;
      used.add(channel);
    }
  }

  return { ...defaults, microphoneChannels };
}

export function saveCameraSlot(defaults: DeviceDefaults, slot: keyof DeviceDefaults["cameras"], deviceId: string) {
  const cameras = { ...defaults.cameras };
  if (deviceId) {
    for (const cameraSlot of Object.keys(cameras) as CameraSlotKey[]) {
      if (cameraSlot !== slot && cameras[cameraSlot] === deviceId) cameras[cameraSlot] = undefined;
    }
  }
  return {
    ...defaults,
    cameras: {
      ...cameras,
      [slot]: deviceId || undefined
    }
  };
}

export function getDeviceAssignmentConflicts(defaults: DeviceDefaults): DeviceAssignmentConflict[] {
  const conflicts: DeviceAssignmentConflict[] = [];
  const cameraOwners = new Map<string, CameraSlotKey[]>();
  for (const [slot, deviceId] of Object.entries(defaults.cameras) as Array<[CameraSlotKey, string | undefined]>) {
    if (!deviceId) continue;
    cameraOwners.set(deviceId, [...(cameraOwners.get(deviceId) ?? []), slot]);
  }
  for (const [deviceId, slots] of cameraOwners) {
    if (slots.length > 1) conflicts.push({ kind: "camera", deviceId, slots });
  }

  const microphoneOwners = new Map<string, MicrophoneSlotKey[]>();
  for (const [slot, deviceId] of Object.entries(defaults.microphones) as Array<[MicrophoneSlotKey, string | undefined]>) {
    if (!deviceId) continue;
    const channel = defaults.microphoneChannels?.[slot] ?? "mix";
    const route = `${deviceId}\u0000${channel}`;
    microphoneOwners.set(route, [...(microphoneOwners.get(route) ?? []), slot]);
  }
  for (const [route, slots] of microphoneOwners) {
    if (slots.length < 2) continue;
    const [deviceId, channel] = route.split("\u0000");
    conflicts.push({ kind: "microphone-route", deviceId, channel, slots });
  }
  return conflicts;
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

export function saveMicrophoneDeviceRoute(
  defaults: DeviceDefaults,
  slot: MicrophoneSlotKey,
  deviceId: string
) {
  const next = saveMicrophoneSlot(defaults, slot, deviceId);
  const microphoneChannels = {
    ...defaultDeviceDefaults.microphoneChannels,
    ...defaults.microphoneChannels
  };
  if (!deviceId) return { ...next, microphoneChannels: { ...microphoneChannels, [slot]: "mix" as const } };

  const siblingSlots = (Object.entries(next.microphones) as Array<[MicrophoneSlotKey, string | undefined]>)
    .filter(([candidate, assignedDeviceId]) => candidate !== slot && assignedDeviceId === deviceId)
    .map(([candidate]) => candidate);
  if (siblingSlots.length === 0) {
    return { ...next, microphoneChannels: { ...microphoneChannels, [slot]: "mix" as const } };
  }

  const used = new Set<MicrophoneInputChannel>();
  for (const sibling of siblingSlots) {
    let channel = microphoneChannels[sibling] ?? "mix";
    if (channel === "mix" || used.has(channel)) {
      channel = numberedMicrophoneInputs.find((candidate) => !used.has(candidate)) ?? "mix";
      microphoneChannels[sibling] = channel;
    }
    used.add(channel);
  }
  microphoneChannels[slot] = numberedMicrophoneInputs.find((candidate) => !used.has(candidate)) ?? "mix";
  return { ...next, microphoneChannels };
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
