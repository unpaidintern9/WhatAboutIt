import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireStudioAudioContext, subscribeStudioMeter } from "./shared-audio-engine";

describe("shared live audio engine", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("shares one graph across eight same-clock channels without closing surviving channels", () => {
    const close = vi.fn(async () => undefined);
    const create = vi.fn(function () { return { state: "running", close }; });
    vi.stubGlobal("AudioContext", create);
    const channels = Array.from({ length: 8 }, () => acquireStudioAudioContext(48000));
    expect(create).toHaveBeenCalledTimes(1);
    channels.slice(0, 7).forEach((channel) => { channel.release(); channel.release(); });
    expect(close).not.toHaveBeenCalled();
    channels[7].release();
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("uses one bounded sampling timer instead of a display-frame loop per microphone", () => {
    vi.useFakeTimers();
    const samples = Array.from({ length: 8 }, () => vi.fn());
    const release = samples.map(subscribeStudioMeter);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(samples[0].mock.calls.length).toBeLessThanOrEqual(21);
    expect(samples[7]).toHaveBeenCalledTimes(samples[0].mock.calls.length);
    release.forEach((stop) => stop());
    expect(vi.getTimerCount()).toBe(0);
  });
});
