import { createStudioAudioContext } from "./studio-audio";

/** A meter/monitor graph per device clock and output, rather than per channel. */
const contexts = new Map<string, { context: AudioContext; references: number }>();
export function acquireStudioAudioContext(sampleRate?: number, outputDeviceId?: string) {
  const key = `${sampleRate ?? 48000}:${outputDeviceId ?? "default"}`;
  let entry = contexts.get(key);
  if (!entry || entry.context.state === "closed") {
    entry = { context: createStudioAudioContext(outputDeviceId, sampleRate), references: 0 };
    contexts.set(key, entry);
  }
  entry.references++;
  const acquired = entry;
  let released = false;
  return {
    context: acquired.context,
    release() {
      if (released) return;
      released = true;
      acquired.references--;
      if (acquired.references === 0) {
        if (contexts.get(key) === acquired) contexts.delete(key);
        void acquired.context.close().catch(() => undefined);
      }
    }
  };
}

const meters = new Set<() => void>();
let timer: number | undefined;
function sampleMeters() {
  timer = undefined;
  for (const sample of meters) sample();
  if (meters.size > 0) timer = window.setTimeout(sampleMeters, document.hidden ? 1000 : 50);
}
/** Twenty updates per second is enough for meters; hidden windows use one. */
export function subscribeStudioMeter(sample: () => void) {
  meters.add(sample);
  if (timer === undefined) timer = window.setTimeout(sampleMeters, 0);
  return () => {
    meters.delete(sample);
    if (meters.size === 0 && timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  };
}
