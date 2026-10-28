/** Numeric window summaries only. Never retains audio buffers or changes the audio graph. */
export class AudioSignalDiagnostics {
  private startedAt: number;
  private measurements = 0;
  private sampleCount = 0;
  private squareSum = 0;
  private dcSum = 0;
  private minimumRmsDbfs = 0;
  private maximumRmsDbfs = -120;
  private peak = 0;
  private nearFullScaleSamples = 0;
  private quietMeasurements = 0;
  constructor(private readonly emit: (summary: Record<string, unknown>) => void,
    private readonly now = () => performance.now(), private readonly nearFullScaleThreshold = 0.98) { this.startedAt = now(); }
  observe(samples: Float32Array, state: Record<string, unknown> = {}) {
    let squares = 0, sum = 0, peak = 0;
    for (const sample of samples) {
      if (!Number.isFinite(sample)) continue;
      squares += sample * sample; sum += sample; peak = Math.max(peak, Math.abs(sample));
      if (Math.abs(sample) >= this.nearFullScaleThreshold) this.nearFullScaleSamples++;
    }
    const rms = Math.sqrt(squares / Math.max(1, samples.length)), db = Math.max(-120, 20 * Math.log10(Math.max(rms, 0.000001)));
    this.measurements++; this.sampleCount += samples.length; this.squareSum += squares; this.dcSum += sum;
    this.minimumRmsDbfs = Math.min(this.minimumRmsDbfs, db); this.maximumRmsDbfs = Math.max(this.maximumRmsDbfs, db); this.peak = Math.max(this.peak, peak);
    if (rms < 0.0003) this.quietMeasurements++;
    if (this.now() - this.startedAt >= 15000) this.flush(state);
  }
  flush(state: Record<string, unknown> = {}) {
    if (!this.measurements) return;
    this.emit({ ...state, windowMs: Math.round(this.now() - this.startedAt), measurements: this.measurements,
      minimumRmsDbfs: Math.round(this.minimumRmsDbfs * 10) / 10, maximumRmsDbfs: Math.round(this.maximumRmsDbfs * 10) / 10,
      meanRmsDbfs: Math.round(Math.max(-120, 10 * Math.log10(Math.max(this.squareSum / Math.max(1, this.sampleCount), 1e-12))) * 10) / 10,
      peakDbfs: Math.round(Math.max(-120, 20 * Math.log10(Math.max(this.peak, 1e-6))) * 10) / 10,
      dcOffset: Math.round(this.dcSum / Math.max(1, this.sampleCount) * 1e6) / 1e6,
      nearFullScaleSamples: this.nearFullScaleSamples, quietMeasurements: this.quietMeasurements });
    this.startedAt = this.now(); this.measurements = 0; this.sampleCount = 0; this.squareSum = 0; this.dcSum = 0;
    this.minimumRmsDbfs = 0; this.maximumRmsDbfs = -120; this.peak = 0; this.nearFullScaleSamples = 0; this.quietMeasurements = 0;
  }
}
