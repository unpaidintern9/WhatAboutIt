/** Compare encoded/sample time with a monotonic clock; refuse jitter/suspension. */
export class MediaClock {
  private points: Array<{ sourceMs: number; wallMs: number }> = [];
  private lastSourceMs = -Infinity;
  rateRatio = 1;
  observe(sourceMs: number, wallMs: number) {
    if (
      !Number.isFinite(sourceMs) ||
      !Number.isFinite(wallMs) ||
      sourceMs - this.lastSourceMs < 1000
    )
      return this.rateRatio;
    this.lastSourceMs = sourceMs;
    this.points.push({ sourceMs, wallMs });
    if (this.points.length > 600)
      this.points.splice(0, this.points.length - 600);
    if (
      this.points.length < 30 ||
      this.points.at(-1)!.wallMs - this.points[0].wallMs < 120_000
    )
      return this.rateRatio;
    const mean = this.points.reduce(
      (value, point) => ({
        sourceMs: value.sourceMs + point.sourceMs / this.points.length,
        wallMs: value.wallMs + point.wallMs / this.points.length,
      }),
      { sourceMs: 0, wallMs: 0 },
    );
    let cross = 0;
    let variance = 0;
    for (const point of this.points) {
      cross += (point.wallMs - mean.wallMs) * (point.sourceMs - mean.sourceMs);
      variance += (point.wallMs - mean.wallMs) ** 2;
    }
    const ratio = cross / variance;
    const residual = Math.max(
      ...this.points.map((point) =>
        Math.abs(
          point.sourceMs - mean.sourceMs - ratio * (point.wallMs - mean.wallMs),
        ),
      ),
    );
    if (ratio > 0.998 && ratio < 1.002 && residual < 15) this.rateRatio = ratio;
    return this.rateRatio;
  }
}
