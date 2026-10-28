import { afterEach, describe, expect, it, vi } from "vitest";
import { assertMicrophoneInputAvailable, calculateAudioLevel, createRoutedMonoStream, createStudioAudioContext, getAudioStreamDiagnostics, getMicrophoneInputIndex, highQualityAudioConstraint, openAudioStreamWithFallback } from "./studio-audio";

describe("studio audio capture", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps system default devices flexible and physical devices exact", () => {
    expect(highQualityAudioConstraint("default")).toMatchObject({ deviceId: { ideal: "default" } });
    expect(highQualityAudioConstraint("built-in-mic")).toMatchObject({ deviceId: { exact: "built-in-mic" } });
  });

  it("requests the native two-channel input for the M-Audio Solo/Duo without changing other interfaces", () => {
    expect(highQualityAudioConstraint("duo", "Line 1/2 (3- M-Audio M-Track Solo and Duo)")).toMatchObject({
      channelCount: { ideal: 2 }, sampleSize: { ideal: 16 }, sampleRate: { exact: 48000 },
      echoCancellation: false, noiseSuppression: false, autoGainControl: false
    });
    expect(highQualityAudioConstraint("other", "Eight channel USB interface")).toMatchObject({ channelCount: { ideal: 8 } });
  });

  it("preserves a stereo request when optional quality preferences are rejected", async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const openStream = vi.fn()
      .mockRejectedValueOnce(new DOMException("Unsupported constraint", "OverconstrainedError"))
      .mockResolvedValueOnce(stream);

    await expect(openAudioStreamWithFallback(openStream, "interface-a")).resolves.toBe(stream);
    expect(openStream).toHaveBeenCalledTimes(2);
    expect(openStream.mock.calls[0][0]).toMatchObject({ deviceId: { exact: "interface-a" }, sampleRate: { exact: 48000 } });
    expect(openStream.mock.calls[1][0]).toMatchObject({
      deviceId: { exact: "interface-a" },
      channelCount: { ideal: 2 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    });
  });

  it("keeps browser voice processing off when quality and channel preferences are rejected", async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const openStream = vi.fn()
      .mockRejectedValueOnce(new DOMException("Unsupported quality constraint", "OverconstrainedError"))
      .mockRejectedValueOnce(new DOMException("Unsupported channel constraint", "OverconstrainedError"))
      .mockResolvedValueOnce(stream);

    await expect(openAudioStreamWithFallback(openStream, "interface-a")).resolves.toBe(stream);
    expect(openStream).toHaveBeenCalledTimes(3);
    for (const [constraints] of openStream.mock.calls) expect(constraints).toMatchObject({ sampleRate: { exact: 48000 } });
    expect(openStream.mock.calls[2][0]).toEqual({ deviceId: { exact: "interface-a" }, sampleRate: { exact: 48000 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false });
  });

  it("requires 48 kHz with a stable recording buffer", () => {
    const constraints = highQualityAudioConstraint("interface-a") as MediaTrackConstraints;
    expect(constraints).toMatchObject({ latency: { ideal: 0.04 }, sampleRate: { exact: 48000 } });
  });

  it("maps every supported numbered interface route", () => {
    expect(getMicrophoneInputIndex("mix")).toBeUndefined();
    expect(getMicrophoneInputIndex("input-1")).toBe(0);
    expect(getMicrophoneInputIndex("input-8")).toBe(7);
    expect(getMicrophoneInputIndex("input-16")).toBe(15);
  });

  it("rejects a numbered input the browser did not expose", () => {
    expect(() => assertMicrophoneInputAvailable("input-1", 1)).not.toThrow();
    expect(() => assertMicrophoneInputAvailable("input-2", 1)).toThrow("Only 1 input channel is available");
    expect(() => assertMicrophoneInputAvailable("input-2", 2)).not.toThrow();
  });

  it("reads real stream settings for diagnostics", () => {
    const track = {
      getSettings: () => ({ deviceId: "usb-interface", groupId: "usb-group", channelCount: 2, sampleRate: 44100, sampleSize: 16, echoCancellation: false, noiseSuppression: false, autoGainControl: false }),
      getCapabilities: () => ({})
    } as unknown as MediaStreamTrack;
    const stream = { getAudioTracks: () => [track] } as unknown as MediaStream;

    expect(getAudioStreamDiagnostics(stream)).toMatchObject({ deviceId: "usb-interface", groupId: "usb-group", channelCount: 2, sampleRate: 44100, sampleSize: 16 });
  });

  it("uses the interface sample rate for live routing instead of forcing a resampling clock", () => {
    let receivedOptions: AudioContextOptions | undefined;
    vi.stubGlobal("AudioContext", function FakeContext(options: AudioContextOptions) {
      receivedOptions = options;
    });

    createStudioAudioContext(undefined, 44100);

    expect(receivedOptions).toMatchObject({ latencyHint: "interactive", sampleRate: 44100 });
  });

  it("keeps the requested sample rate when retrying without an unsupported output selector", () => {
    const calls: AudioContextOptions[] = [];
    vi.stubGlobal("AudioContext", function FakeContext(options: AudioContextOptions) {
      calls.push(options);
      if (calls.length === 1) throw new Error("Unsupported sinkId");
    });
    createStudioAudioContext("speaker", 48000, "playback");
    expect(calls[1]).toEqual({ sampleRate: 48000, latencyHint: "playback" });
  });

  it("calculates independent RMS and clipping peaks", () => {
    expect(calculateAudioLevel(new Uint8Array([128, 128, 128]))).toEqual({ rms: 0, peak: 0 });
    expect(calculateAudioLevel(new Uint8Array([0, 128, 255])).peak).toBe(100);
  });

  it("records the normal mixed microphone track without a Web Audio bridge", () => {
    const audioTrack = {} as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [audioTrack],
      getVideoTracks: () => []
    } as unknown as MediaStream;
    const originalAudioContext = window.AudioContext;
    window.AudioContext = vi.fn() as unknown as typeof AudioContext;

    expect(createRoutedMonoStream(stream, "mix", { preserveVideo: true })).toBe(stream);

    window.AudioContext = originalAudioContext;
  });
});
