import { afterEach, describe, expect, it, vi } from "vitest";
import { assertMicrophoneInputAvailable, calculateAudioLevel, getAudioStreamDiagnostics, getMicrophoneInputIndex, highQualityAudioConstraint, openAudioStreamWithFallback } from "./studio-audio";

describe("studio audio capture", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps system default devices flexible and physical devices exact", () => {
    expect(highQualityAudioConstraint("default")).toMatchObject({ deviceId: { ideal: "default" } });
    expect(highQualityAudioConstraint("built-in-mic")).toMatchObject({ deviceId: { exact: "built-in-mic" } });
  });

  it("preserves a stereo request when optional quality preferences are rejected", async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const openStream = vi.fn()
      .mockRejectedValueOnce(new DOMException("Unsupported constraint", "OverconstrainedError"))
      .mockResolvedValueOnce(stream);

    await expect(openAudioStreamWithFallback(openStream, "interface-a")).resolves.toBe(stream);
    expect(openStream).toHaveBeenCalledTimes(2);
    expect(openStream.mock.calls[0][0]).toMatchObject({ deviceId: { exact: "interface-a" }, sampleRate: { ideal: 48000 } });
    expect(openStream.mock.calls[1][0]).toMatchObject({
      deviceId: { exact: "interface-a" },
      channelCount: { ideal: 2 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    });
  });

  it("falls back to the selected device alone only after stereo capture is rejected", async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const openStream = vi.fn()
      .mockRejectedValueOnce(new DOMException("Unsupported quality constraint", "OverconstrainedError"))
      .mockRejectedValueOnce(new DOMException("Unsupported channel constraint", "OverconstrainedError"))
      .mockResolvedValueOnce(stream);

    await expect(openAudioStreamWithFallback(openStream, "interface-a")).resolves.toBe(stream);
    expect(openStream).toHaveBeenCalledTimes(3);
    expect(openStream.mock.calls[2][0]).toEqual({ deviceId: { exact: "interface-a" } });
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

  it("calculates independent RMS and clipping peaks", () => {
    expect(calculateAudioLevel(new Uint8Array([128, 128, 128]))).toEqual({ rms: 0, peak: 0 });
    expect(calculateAudioLevel(new Uint8Array([0, 128, 255])).peak).toBe(100);
  });
});
