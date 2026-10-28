/** Inspect acknowledged mono 24-bit PCM without retaining samples or altering bytes. */
export function summarizePcmSignal(bytes: Uint8Array, mimeType: string) {
  if (!mimeType.startsWith("audio/x-pcm") || !/channels=1(?:;|$)/.test(mimeType) || bytes.length % 3 || !bytes.length || bytes.length > 768 * 1024) return undefined;
  let squares = 0, sum = 0, peak = 0, nearFullScaleSamples = 0;
  for (let index = 0; index < bytes.length; index += 3) {
    const integer = (bytes[index] | (bytes[index + 1] << 8) | (bytes[index + 2] << 16)) << 8 >> 8;
    const sample = integer / 8388608;
    squares += sample * sample; sum += sample; peak = Math.max(peak, Math.abs(sample)); if (Math.abs(sample) >= 0.98) nearFullScaleSamples++;
  }
  const frames = bytes.length / 3;
  return { frames, sumSquares: squares, sum, peak, nearFullScaleSamples,
    rmsDbfs: Math.max(-120, 10 * Math.log10(Math.max(squares / frames, 1e-12))) };
}
