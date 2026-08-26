type AudioContextWithOutput = AudioContext & {
  setSinkId?: (deviceId: string) => Promise<void>;
};

type MonitorRoute = {
  context: AudioContextWithOutput;
  gain: GainNode;
};

const routes = new WeakMap<HTMLMediaElement, MonitorRoute>();
let sharedContext: AudioContextWithOutput | undefined;
let selectedOutputId: string | undefined;

function audioContextConstructor() {
  return (
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  );
}

export function clampReviewMonitorGain(gain: number) {
  return Math.max(0, Math.min(3, Number.isFinite(gain) ? gain : 1));
}

function getMonitorRoute(element: HTMLMediaElement) {
  const existing = routes.get(element);
  if (existing) return existing;
  const AudioContextConstructor = audioContextConstructor();
  if (!AudioContextConstructor) return undefined;
  sharedContext ??= new AudioContextConstructor() as AudioContextWithOutput;
  const source = sharedContext.createMediaElementSource(element);
  const gain = sharedContext.createGain();
  source.connect(gain);
  gain.connect(sharedContext.destination);
  const route = { context: sharedContext, gain };
  routes.set(element, route);
  return route;
}

export function setReviewMonitorGain(
  element: HTMLMediaElement | null | undefined,
  requestedGain: number,
  outputId?: string,
) {
  if (!element) return false;
  const gain = clampReviewMonitorGain(requestedGain);
  try {
    const route = getMonitorRoute(element);
    if (!route) {
      element.volume = Math.min(1, gain);
      element.muted = gain === 0;
      return false;
    }
    element.volume = 1;
    element.muted = false;
    route.gain.gain.setValueAtTime(gain, route.context.currentTime);
    const requestedOutputId = outputId ?? "";
    if (requestedOutputId !== (selectedOutputId ?? "") && route.context.setSinkId) {
      selectedOutputId = requestedOutputId;
      void route.context.setSinkId(requestedOutputId).catch(() => {
        selectedOutputId = undefined;
      });
    }
    return true;
  } catch {
    element.volume = Math.min(1, gain);
    element.muted = gain === 0;
    return false;
  }
}

export function resumeReviewMonitor() {
  if (sharedContext?.state === "suspended")
    void sharedContext.resume().catch(() => undefined);
}
