import { describe, expect, it, vi } from "vitest";
import { checkRecordingInputs } from "./recording-preflight";
import type { DeviceDefaults } from "../../shared/types";

function stream(channels = 8, kind: "audio" | "video" = "audio") {
  const track = { readyState: "live", getSettings: () => ({ channelCount: channels }), getCapabilities: () => ({ channelCount: { max: 16 } }) };
  return { getAudioTracks: () => kind === "audio" ? [track] : [], getVideoTracks: () => kind === "video" ? [track] : [] } as unknown as MediaStream;
}
describe("real recording input preflight", () => {
  const defaults: DeviceDefaults = { cameras: { camera1: "camera" }, microphones: { morganMic: "usb", guestMic: "usb", mic8: "usb" }, microphoneChannels: { morganMic: "input-1", guestMic: "input-2", mic8: "input-8" } };
  it("opens a shared eight-channel interface once and releases every check stream", async () => {
    const devices = { openCameraPreview: vi.fn(async () => stream(0, "video")), openMicrophoneStream: vi.fn(async () => stream()), releaseStream: vi.fn() };
    await checkRecordingInputs(defaults, devices);
    expect(devices.openMicrophoneStream).toHaveBeenCalledTimes(1);
    expect(devices.releaseStream).toHaveBeenCalledTimes(2);
  });
  it("rejects an input that is advertised but not active and releases late openers", async () => {
    let finishCamera!: (stream: MediaStream) => void;
    const devices = { openCameraPreview: vi.fn(() => new Promise<MediaStream>((resolve) => { finishCamera = resolve; })), openMicrophoneStream: vi.fn(async () => stream(2)), releaseStream: vi.fn() };
    const check = checkRecordingInputs(defaults, devices);
    const result = expect(check).rejects.toThrow("Mic 8: Only 2 input channels are available");
    finishCamera(stream(0, "video"));
    await result;
    expect(devices.releaseStream).toHaveBeenCalledTimes(2);
  });  it("rejects impossible Duo inputs before opening any capture devices", async () => {
    const devices = { openCameraPreview: vi.fn(), openMicrophoneStream: vi.fn(), releaseStream: vi.fn() };
    await expect(checkRecordingInputs({ cameras: { camera1: "camera" }, microphones: { morganMic: "duo" }, microphoneChannels: { morganMic: "input-3" }, microphoneDeviceLabels: { morganMic: "M-Track Duo" } }, devices)).rejects.toThrow("has two inputs");
    expect(devices.openCameraPreview).not.toHaveBeenCalled(); expect(devices.openMicrophoneStream).not.toHaveBeenCalled();
  });

});
