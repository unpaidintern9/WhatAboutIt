import type { TimelineAudioPreset } from "./timeline";

export type AudioTreatmentInput = {
  audioPreset?: TimelineAudioPreset;
  noiseReduction?: number;
  deEsser?: number;
  compression?: number;
  eqLowDb?: number;
  eqMidDb?: number;
  eqHighDb?: number;
};

export type AudioTreatmentParameters = {
  highpassHz: number;
  lowpassHz: number;
  lowDb: number;
  midDb: number;
  highDb: number;
  compression: number;
  compressorThreshold: number;
  compressorThresholdDb: number;
  compressorRatio: number;
  compressorAttackSeconds: number;
  compressorReleaseSeconds: number;
  compressorMakeup: number;
};

function bounded(value: number | undefined, minimum: number, maximum: number, fallback = 0) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value! : fallback));
}

export function getAudioTreatmentParameters(input: AudioTreatmentInput = {}): AudioTreatmentParameters {
  const preset = input.audioPreset ?? "natural";
  const noiseReduction = bounded(input.noiseReduction, 0, 100);
  const explicitCompression = bounded(input.compression, 0, 100);
  const presetLow = preset === "warm" ? 2 : preset === "broadcast" ? 1 : 0;
  const presetMid = preset === "clean" ? 0.8 : preset === "warm" ? 0.6 : preset === "broadcast" ? 1.2 : 0;
  const presetHigh = preset === "clean" ? 1.2 : preset === "broadcast" ? 2 : 0;
  const presetCompression = preset === "clean" ? 20 : preset === "warm" ? 32 : preset === "broadcast" ? 48 : 0;
  const compression = Math.max(explicitCompression, presetCompression);
  const compressorThreshold = compression === 0 ? 1 : Math.max(0.05, 0.24 - compression * 0.0017);
  return {
    highpassHz: Math.max(preset === "broadcast" ? 80 : preset === "clean" || preset === "warm" ? 70 : 35, 35 + noiseReduction * 0.85),
    lowpassHz: Math.min(preset === "clean" ? 16_000 : 20_000, 20_000 - noiseReduction * 55),
    lowDb: bounded(input.eqLowDb, -12, 12) + presetLow,
    midDb: bounded(input.eqMidDb, -12, 12) + presetMid,
    highDb: bounded(input.eqHighDb, -12, 12) + presetHigh,
    compression,
    compressorThreshold,
    compressorThresholdDb: compression === 0 ? 0 : 20 * Math.log10(compressorThreshold),
    compressorRatio: compression === 0 ? 1 : 1.5 + compression * 0.045,
    compressorAttackSeconds: 0.005,
    compressorReleaseSeconds: 0.11,
    compressorMakeup: compression === 0 ? 1 : 1.15,
  };
}


/** Only source treatment is baked; gain, pan, fades and edits remain interactive. */
export function audioTreatmentSignature(input: AudioTreatmentInput = {}) {
  return JSON.stringify([input.audioPreset ?? "natural", input.noiseReduction ?? 0, input.deEsser ?? 0, input.compression ?? 0, input.eqLowDb ?? 0, input.eqMidDb ?? 0, input.eqHighDb ?? 0, (input as AudioTreatmentInput & { noiseGateDb?: number }).noiseGateDb ?? -80]);
}
export function needsExactAudioTreatment(input: AudioTreatmentInput & { noiseGateDb?: number }) {
  return audioTreatmentSignature(input) !== audioTreatmentSignature();
}
