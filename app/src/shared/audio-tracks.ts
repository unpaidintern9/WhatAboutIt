import type { MicrophoneSlotKey } from "./types";

export const microphoneSlots: ReadonlyArray<{
  key: MicrophoneSlotKey;
  label: string;
  assetId: string;
}> = [
  { key: "morganMic", label: "Morgan Mic", assetId: "morgan-mic" },
  { key: "guestMic", label: "Guest Mic", assetId: "guest-mic" },
  { key: "extraMic", label: "Extra Mic", assetId: "extra-mic" },
  ...([4, 5, 6, 7, 8] as const).map((number) => ({
    key: `mic${number}` as MicrophoneSlotKey,
    label: `Mic ${number}`,
    assetId: `mic-${number}`,
  })),
];
export function microphoneAssetId(slot: string) {
  return microphoneSlots.find((item) => item.key === slot)?.assetId ?? slot;
}
export function microphoneLabel(slot: string) {
  return microphoneSlots.find((item) => item.key === slot)?.label ?? slot;
}
