type AudioContextWithOutput = AudioContext & {
  setSinkId?: (deviceId: string) => Promise<void>;
};

type MonitorRoute = {
  context: AudioContextWithOutput;
  highpass: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  pan?: StereoPannerNode;
  analyser: AnalyserNode;
  gateGain: GainNode;
  trackGain: GainNode;
  limiter: DynamicsCompressorNode;
  monitorGain: GainNode;
  settings: ReviewMonitorSettings;
  frame?: number;
  samples: Uint8Array<ArrayBuffer>;
};

export type ReviewMonitorTreatment = {
  volume?: number;
  pan?: number;
  audioPreset?: "natural" | "clean" | "warm" | "broadcast";
  noiseReduction?: number;
  noiseGateDb?: number;
  deEsser?: number;
  compression?: number;
  eqLowDb?: number;
  eqMidDb?: number;
  eqHighDb?: number;
  limiterEnabled?: boolean;
  fadeInMs?: number;
  fadeOutMs?: number;
};

export type ReviewMonitorSettings = {
  trackGain: number;
  pan: number;
  highpassHz: number;
  lowpassHz: number;
  lowDb: number;
  midDb: number;
  highDb: number;
  compressorThresholdDb: number;
  compressorRatio: number;
  limiterThresholdDb: number;
  limiterRatio: number;
  noiseGateDb: number;
  fadeInMs: number;
  fadeOutMs: number;
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

function bounded(value: number | undefined, minimum: number, maximum: number, fallback = 0) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value! : fallback));
}

export function getReviewMonitorSettings(treatment: ReviewMonitorTreatment = {}): ReviewMonitorSettings {
  const preset = treatment.audioPreset ?? "natural";
  const noiseReduction = bounded(treatment.noiseReduction, 0, 100);
  const deEsser = bounded(treatment.deEsser, 0, 100);
  const compression = bounded(treatment.compression, 0, 100);
  const presetLow = preset === "warm" ? 2 : preset === "broadcast" ? 1 : 0;
  const presetMid = preset === "clean" ? 0.8 : preset === "warm" ? 0.6 : preset === "broadcast" ? 1.2 : 0;
  const presetHigh = preset === "clean" ? 1.2 : preset === "broadcast" ? 2 : 0;
  const presetCompression = preset === "clean" ? 20 : preset === "warm" ? 32 : preset === "broadcast" ? 48 : 0;
  const effectiveCompression = Math.max(compression, presetCompression);
  return {
    trackGain: clampReviewMonitorGain(bounded(treatment.volume, 0, 300, 100) / 100),
    pan: bounded(treatment.pan, -100, 100) / 100,
    highpassHz: 35 + noiseReduction * 0.85,
    lowpassHz: 20_000 - noiseReduction * 55,
    lowDb: bounded(treatment.eqLowDb, -12, 12) + presetLow,
    midDb: bounded(treatment.eqMidDb, -12, 12) + presetMid,
    highDb: bounded(treatment.eqHighDb, -12, 12) + presetHigh - deEsser * 0.055,
    compressorThresholdDb: effectiveCompression === 0 ? 0 : -12 - effectiveCompression * 0.18,
    compressorRatio: effectiveCompression === 0 ? 1 : 1.5 + effectiveCompression * 0.065,
    limiterThresholdDb: treatment.limiterEnabled === false ? 0 : -1,
    limiterRatio: treatment.limiterEnabled === false ? 1 : 20,
    noiseGateDb: bounded(treatment.noiseGateDb, -80, -20, -80),
    fadeInMs: bounded(treatment.fadeInMs, 0, 10_000),
    fadeOutMs: bounded(treatment.fadeOutMs, 0, 10_000)
  };
}

function setParam(param: AudioParam, value: number, context: AudioContext) {
  param.cancelScheduledValues(context.currentTime);
  param.setTargetAtTime(value, context.currentTime, 0.012);
}

function getDynamicGain(route: MonitorRoute, element: HTMLMediaElement) {
  const { settings } = route;
  let gate = 1;
  if (settings.noiseGateDb > -80) {
    route.analyser.getByteTimeDomainData(route.samples);
    let sum = 0;
    for (const sample of route.samples) {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / route.samples.length);
    const levelDb = 20 * Math.log10(Math.max(rms, 0.00001));
    gate = levelDb >= settings.noiseGateDb ? 1 : 0.025;
  }
  let fade = 1;
  const elapsedMs = element.currentTime * 1000;
  if (settings.fadeInMs > 0) fade = Math.min(fade, elapsedMs / settings.fadeInMs);
  if (settings.fadeOutMs > 0 && Number.isFinite(element.duration)) {
    fade = Math.min(fade, Math.max(0, (element.duration * 1000 - elapsedMs) / settings.fadeOutMs));
  }
  return settings.trackGain * Math.max(0, Math.min(1, gate * fade));
}

function updateDynamicGain(route: MonitorRoute, element: HTMLMediaElement) {
  setParam(route.trackGain.gain, getDynamicGain(route, element), route.context);
  const dynamic = route.settings.noiseGateDb > -80 || route.settings.fadeInMs > 0 || route.settings.fadeOutMs > 0;
  if (dynamic && element.isConnected) route.frame = window.requestAnimationFrame(() => updateDynamicGain(route, element));
  else route.frame = undefined;
}

function refreshDynamicGain(route: MonitorRoute, element: HTMLMediaElement) {
  if (route.frame !== undefined) window.cancelAnimationFrame(route.frame);
  updateDynamicGain(route, element);
}

function getMonitorRoute(element: HTMLMediaElement) {
  const existing = routes.get(element);
  if (existing) return existing;
  const AudioContextConstructor = audioContextConstructor();
  if (!AudioContextConstructor) return undefined;
  sharedContext ??= new AudioContextConstructor() as AudioContextWithOutput;
  const source = sharedContext.createMediaElementSource(element);
  const highpass = sharedContext.createBiquadFilter();
  highpass.type = "highpass";
  const lowpass = sharedContext.createBiquadFilter();
  lowpass.type = "lowpass";
  const low = sharedContext.createBiquadFilter();
  low.type = "lowshelf";
  low.frequency.value = 120;
  const mid = sharedContext.createBiquadFilter();
  mid.type = "peaking";
  mid.frequency.value = 1_000;
  mid.Q.value = 0.8;
  const high = sharedContext.createBiquadFilter();
  high.type = "highshelf";
  high.frequency.value = 5_500;
  const compressor = sharedContext.createDynamicsCompressor();
  compressor.knee.value = 12;
  compressor.attack.value = 0.008;
  compressor.release.value = 0.14;
  const pan = sharedContext.createStereoPanner?.();
  const analyser = sharedContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.15;
  const gateGain = sharedContext.createGain();
  const trackGain = sharedContext.createGain();
  const limiter = sharedContext.createDynamicsCompressor();
  limiter.knee.value = 0;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.08;
  const monitorGain = sharedContext.createGain();
  source.connect(highpass).connect(lowpass).connect(low).connect(mid).connect(high).connect(compressor);
  if (pan) compressor.connect(pan).connect(analyser);
  else compressor.connect(analyser);
  analyser.connect(gateGain).connect(trackGain);
  trackGain.connect(limiter).connect(monitorGain).connect(sharedContext.destination);
  const route: MonitorRoute = {
    context: sharedContext,
    highpass,
    lowpass,
    low,
    mid,
    high,
    compressor,
    pan,
    analyser,
    gateGain,
    trackGain,
    limiter,
    monitorGain,
    settings: getReviewMonitorSettings(),
    samples: new Uint8Array(analyser.frequencyBinCount)
  };
  routes.set(element, route);
  applyTreatment(route, element, {});
  return route;
}

function applyTreatment(route: MonitorRoute, element: HTMLMediaElement, treatment: ReviewMonitorTreatment) {
  const settings = getReviewMonitorSettings(treatment);
  route.settings = settings;
  setParam(route.highpass.frequency, settings.highpassHz, route.context);
  setParam(route.lowpass.frequency, settings.lowpassHz, route.context);
  setParam(route.low.gain, settings.lowDb, route.context);
  setParam(route.mid.gain, settings.midDb, route.context);
  setParam(route.high.gain, settings.highDb, route.context);
  setParam(route.compressor.threshold, settings.compressorThresholdDb, route.context);
  setParam(route.compressor.ratio, settings.compressorRatio, route.context);
  if (route.pan) setParam(route.pan.pan, settings.pan, route.context);
  setParam(route.limiter.threshold, settings.limiterThresholdDb, route.context);
  setParam(route.limiter.ratio, settings.limiterRatio, route.context);
  refreshDynamicGain(route, element);
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
    setParam(route.monitorGain.gain, gain, route.context);
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

export function setReviewMonitorTreatment(
  element: HTMLMediaElement | null | undefined,
  treatment: ReviewMonitorTreatment,
  monitorGain: number,
  outputId?: string
) {
  if (!element) return false;
  const routed = setReviewMonitorGain(element, monitorGain, outputId);
  const route = routes.get(element);
  if (!route) return routed;
  applyTreatment(route, element, treatment);
  return true;
}

export function resumeReviewMonitor() {
  if (sharedContext?.state === "suspended")
    void sharedContext.resume().catch(() => undefined);
}
