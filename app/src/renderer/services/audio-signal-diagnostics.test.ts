import { describe, expect, it } from "vitest";
import { AudioSignalDiagnostics } from "./audio-signal-diagnostics";
describe("passive audio diagnostics", () => {
  it("summarizes quiet and loud input without retaining or modifying samples", () => {
    let now = 0; const summaries: Record<string, unknown>[] = [];
    const meter = new AudioSignalDiagnostics((summary) => summaries.push(summary), () => now);
    const quiet = new Float32Array(512).fill(0.0001), loud = new Float32Array(512).fill(0.5);
    meter.observe(quiet); expect(quiet[0]).toBeCloseTo(0.0001);
    quiet.fill(1); now = 15001; meter.observe(loud);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ measurements: 2, minimumRmsDbfs: -80, maximumRmsDbfs: -6, peakDbfs: -6, quietMeasurements: 1 });
    expect(JSON.stringify(summaries)).not.toContain("samples");
    expect(loud[0]).toBe(0.5);
  });
  it("records near-full-scale observations and flushes the last partial window", () => {
    const summaries: Record<string, unknown>[] = [];
    const meter = new AudioSignalDiagnostics((summary) => summaries.push(summary));
    meter.observe(new Float32Array([0.99, -0.99, 0])); meter.flush({ trackState: "ended" }); meter.flush();
    expect(summaries).toHaveLength(1); expect(summaries[0]).toMatchObject({ nearFullScaleSamples: 2, trackState: "ended" });
  });
});
