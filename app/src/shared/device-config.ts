import type { CameraSlotKey, DeviceDefaults, MicrophoneInputChannel, MicrophoneSlotKey, StudioSettings } from "./types";

export interface DeviceAssignmentConflict {
  kind: "camera" | "microphone-route";
  deviceId: string;
  slots: string[];
  channel?: string;
}

export const microphoneInputChannelOptions: Array<{ value: MicrophoneInputChannel; label: string }> = [
  { value: "mix", label: "Automatic / combined input" },
  { value: "input-1", label: "Input 1 · Mono" },
  { value: "input-2", label: "Input 2 · Mono" },
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
  if (channel === "input-1") return { short: "Input 1 · Mono", detail: "Physical Input 1 on the interface" };
  if (channel === "input-2") return { short: "Input 2 · Mono", detail: "Physical Input 2 on the interface" };
  if (channel === "mix") return { short: "Automatic / Combined", detail: "All browser-visible channels combined" };
  const number = channel.replace("input-", "");
  return { short: `Input ${number}`, detail: `Physical Input ${number} on the interface` };
}

export function isTwoInputAudioInterface(label = "") {
  return /m[\s-]*track\s*(?:solo\s*(?:and|&|\/)?\s*)?duo|m[\s-]*audio.*duo/i.test(label);
}

export function getMicrophoneInputOptions(label = "", activeChannelCount?: number, sharedDevice = false) {
  const count = Number.isInteger(activeChannelCount) && (activeChannelCount ?? 0) > 0
    ? Math.min(16, activeChannelCount!) : undefined;
  const knownTwo = isTwoInputAudioInterface(label);
  const maximum = knownTwo ? Math.min(2, count ?? 2) : count ?? 2;
  return microphoneInputChannelOptions.filter((option) => option.value === "mix"
    ? !knownTwo && !sharedDevice : Number(option.value.replace("input-", "")) <= maximum);
}

export function microphoneRoutesOverlap(first: MicrophoneInputChannel, second: MicrophoneInputChannel) {
  return first === "mix" || second === "mix" || first === second;
}

export function distinctAudioDeviceChoices<T extends { id: string; groupId?: string }>(devices: T[], selectedId?: string) {
  return devices.filter((device) => device.id === selectedId || !["default", "communications"].includes(device.id) || !device.groupId
    || !devices.some((other) => !["default", "communications"].includes(other.id) && other.groupId === device.groupId));
}

export function assignTwoInputInterface(defaults: DeviceDefaults, deviceId: string, label: string): DeviceDefaults {
  return { ...defaults,
    microphones: { ...defaults.microphones, morganMic: deviceId, guestMic: deviceId },
    microphoneChannels: { ...defaults.microphoneChannels, morganMic: "input-1", guestMic: "input-2" },
    microphoneDeviceLabels: { ...defaults.microphoneDeviceLabels, morganMic: label, guestMic: label }
  };
}

export function getMicrophoneRoutingIssue(defaults: DeviceDefaults) {
  for (const [slot, deviceId] of Object.entries(defaults.microphones)) {
    if (!deviceId) continue;
    const label = defaults.microphoneDeviceLabels?.[slot as MicrophoneSlotKey] ?? "";
    const channel = defaults.microphoneChannels?.[slot as MicrophoneSlotKey] ?? "mix";
    if (isTwoInputAudioInterface(label) && !["input-1", "input-2"].includes(channel)) {
      return `${label} has two inputs. Choose Input 1 or Input 2 for ${defaults.microphoneNames?.[slot as MicrophoneSlotKey] || slot}.`;
    }
  }
  return undefined;
}

const numberedMicrophoneInputs = microphoneInputChannelOptions
  .map((option) => option.value)
  .filter((channel): channel is Exclude<MicrophoneInputChannel, "mix"> => channel !== "mix");

export const defaultDeviceDefaults: DeviceDefaults = {
  captureQuality: "balanced",
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

export function resolveAvailableAudioOutputId(configuredId: string | undefined, availableIds: readonly string[]) {
  return configuredId && availableIds.includes(configuredId) ? configuredId : undefined;
}

/** Reconnect a renamed USB endpoint only when its saved label identifies one physical device. */
export function reconnectMicrophoneSelections(defaults: DeviceDefaults, devices: readonly { id: string; label: string }[]): DeviceDefaults {
  const labelKey = (label: string) => label.toLowerCase().replace(/\(\d+-\s*/g, "(").replace(/\s+/g, " ").trim();
  const physical = devices.filter(({ id }) => id !== "default" && id !== "communications");
  const replacements = new Map<string, { id: string; label: string }>();
  for (const [slot, oldId] of Object.entries(defaults.microphones) as Array<[MicrophoneSlotKey, string | undefined]>) {
    if (!oldId || devices.some(({ id }) => id === oldId)) continue;
    const savedLabel = defaults.microphoneDeviceLabels?.[slot];
    if (!savedLabel) continue;
    const key = labelKey(savedLabel);
    // Identical models cannot be distinguished by label; keep manual selection in that case.
    const savedIds = new Set(Object.entries(defaults.microphones).filter(([otherSlot]) => labelKey(defaults.microphoneDeviceLabels?.[otherSlot as MicrophoneSlotKey] ?? "") === key).map(([, id]) => id));
    const matches = physical.filter(({ label }) => labelKey(label) === key);
    if (savedIds.size === 1 && matches.length === 1) replacements.set(oldId, matches[0]);
  }
  if (replacements.size === 0) return defaults;
  return {
    ...defaults,
    microphones: Object.fromEntries(Object.entries(defaults.microphones).map(([slot, id]) => [slot, id && replacements.get(id)?.id || id])),
    microphoneDeviceLabels: Object.fromEntries(Object.entries(defaults.microphones).map(([slot, id]) => [slot, id && replacements.get(id)?.label || defaults.microphoneDeviceLabels?.[slot as MicrophoneSlotKey]]))
  };
}

export function withDeviceDefaults(settings: StudioSettings): StudioSettings {
  const mergedDefaults: DeviceDefaults = {
    captureQuality: settings.deviceDefaults?.captureQuality ?? "balanced",
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
  // A combined route overlaps every numbered input on the same device.
  for (const [route, slots] of microphoneOwners) {
    const [deviceId, channel] = route.split("\u0000");
    if (channel !== "mix") continue;
    const numbered = [...microphoneOwners.entries()].filter(([key]) => key.startsWith(`${deviceId}\u0000`) && !key.endsWith("\u0000mix")).flatMap(([, owners]) => owners);
    if (numbered.length) conflicts.push({ kind: "microphone-route", deviceId, channel, slots: [...slots, ...numbered] });
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
  deviceId: string,
  deviceLabel?: string
) {
  const next = { ...saveMicrophoneSlot(defaults, slot, deviceId),
    microphoneDeviceLabels: { ...defaults.microphoneDeviceLabels, ...(deviceLabel ? { [slot]: deviceLabel } : {}) } };
  const microphoneChannels = {
    ...defaultDeviceDefaults.microphoneChannels,
    ...defaults.microphoneChannels
  };
  if (!deviceId) return { ...next, microphoneChannels: { ...microphoneChannels, [slot]: "mix" as const } };

  const siblingSlots = (Object.entries(next.microphones) as Array<[MicrophoneSlotKey, string | undefined]>)
    .filter(([candidate, assignedDeviceId]) => candidate !== slot && assignedDeviceId === deviceId)
    .map(([candidate]) => candidate);
  if (siblingSlots.length === 0) {
    return { ...next, microphoneChannels: { ...microphoneChannels, [slot]: isTwoInputAudioInterface(deviceLabel) ? "input-1" as const : "mix" as const } };
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
