import type { TimelineTrack } from "../shared/timeline";
import { getAudioTreatmentParameters } from "../shared/audio-treatment";

export function createAudioTreatment(track: TimelineTrack | undefined) {
  const filters: string[] = [];
  const treatment = getAudioTreatmentParameters(track);
  if ((track?.audioPreset ?? "natural") !== "natural" || (track?.noiseReduction ?? 0) > 0) {
    filters.push(`highpass=f=${treatment.highpassHz.toFixed(0)}`, `lowpass=f=${treatment.lowpassHz.toFixed(0)}`);
  }
  if (track) {
    if (track.deEsser > 0) {
      const amount = Math.max(0, Math.min(100, track.deEsser));
      const threshold = -18 - amount * 0.14;
      const ratio = 1 + amount * 0.05;
      const ceiling = threshold * (1 - 1 / ratio);
      // Compress the sibilance band only; low-frequency speech stays at unity.
      filters.push(`aresample=48000,mcompand=args='0.001,0.08 0.1 -90/-90,0/0 4500 | 0.001,0.08 3 -90/-90,${threshold.toFixed(2)}/${threshold.toFixed(2)},0/${ceiling.toFixed(2)} 22000'`);
    }
    if (track.noiseReduction > 0) filters.push(`afftdn=nr=${Math.max(0.01, track.noiseReduction * 0.65).toFixed(2)}:nf=-50:tn=1`);
    if (track.noiseGateDb > -80) {
      const threshold = Math.pow(10, track.noiseGateDb / 20);
      filters.push(`agate=threshold=${threshold.toFixed(5)}:ratio=2.5:attack=15:release=220:range=0.08`);
    }
    if (treatment.lowDb !== 0) filters.push(`equalizer=f=120:t=q:w=0.8:g=${treatment.lowDb.toFixed(1)}`);
    if (treatment.midDb !== 0) filters.push(`equalizer=f=1200:t=q:w=1:g=${treatment.midDb.toFixed(1)}`);
    if (treatment.highDb !== 0) filters.push(`equalizer=f=6000:t=q:w=0.8:g=${treatment.highDb.toFixed(1)}`);
    if (treatment.compression > 0) filters.push(`acompressor=threshold=${treatment.compressorThreshold.toFixed(3)}:ratio=${treatment.compressorRatio.toFixed(2)}:attack=${(treatment.compressorAttackSeconds * 1000).toFixed(0)}:release=${(treatment.compressorReleaseSeconds * 1000).toFixed(0)}:makeup=${treatment.compressorMakeup.toFixed(2)}`);
  }
  return filters.length > 0 ? `${filters.join(",")},` : "";
}

