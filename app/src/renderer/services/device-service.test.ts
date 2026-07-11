import { describe, expect, it, vi } from "vitest";
import { defaultDeviceDefaults } from "../../shared/device-config";
import type { DevicePlugin } from "../plugins/devices/types";
import { DeviceService, getDeviceReadiness, getEmptyStateMessage } from "./device-service";

function createStream() {
  const track = {
    readyState: "live",
    stop: vi.fn(function stop(this: { readyState: string }) {
      this.readyState = "ended";
    }),
    addEventListener: vi.fn()
  };
  return {
    track,
    stream: {
      getTracks: () => [track]
    } as unknown as MediaStream
  };
}

describe("device service", () => {
  it("returns friendly empty states", () => {
    expect(getEmptyStateMessage("camera")).toBe("No camera found");
    expect(getEmptyStateMessage("microphone")).toBe("No microphone found");
    expect(getEmptyStateMessage("quiet")).toBe("We can't hear you yet");
    expect(getEmptyStateMessage("ready")).toBe("Everything looks good");
  });

  it("checks readiness from detected devices and saved defaults", () => {
    expect(
      getDeviceReadiness({ cameras: [], microphones: [], speakers: [], permissionNeeded: false }, defaultDeviceDefaults)
    ).toBe("needs-camera");

    expect(
      getDeviceReadiness(
        {
          cameras: [{ id: "camera-a", label: "Studio Camera", kind: "camera" }],
          microphones: [{ id: "mic-a", label: "Morgan Mic", kind: "microphone" }],
          speakers: [],
          permissionNeeded: false
        },
        { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } }
      )
    ).toBe("ready");
  });

  it("stops duplicate mic streams before opening another stream for the same device", async () => {
    const first = createStream();
    const second = createStream();
    const plugin: DevicePlugin = {
      detectDevices: vi.fn(),
      requestStudioPermissions: vi.fn(),
      sampleMicrophoneLevel: vi.fn(),
      playTestSound: vi.fn(),
      openCameraPreview: vi.fn(),
      openMicrophoneStream: vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream)
    };
    const service = new DeviceService(plugin);

    await service.openMicrophoneStream("mic-a");
    await service.openMicrophoneStream("mic-a");

    expect(first.track.stop).toHaveBeenCalledTimes(1);
    expect(second.track.stop).not.toHaveBeenCalled();
  });

  it("releases managed camera and mic streams on cleanup", async () => {
    const camera = createStream();
    const mic = createStream();
    const plugin: DevicePlugin = {
      detectDevices: vi.fn(),
      requestStudioPermissions: vi.fn(),
      sampleMicrophoneLevel: vi.fn(),
      playTestSound: vi.fn(),
      openCameraPreview: vi.fn().mockResolvedValue(camera.stream),
      openMicrophoneStream: vi.fn().mockResolvedValue(mic.stream)
    };
    const service = new DeviceService(plugin);

    await service.openCameraPreview("camera-a");
    await service.openMicrophoneStream("mic-a");
    service.releaseAll();

    expect(camera.track.stop).toHaveBeenCalledTimes(1);
    expect(mic.track.stop).toHaveBeenCalledTimes(1);
  });

  it("exposes active preview and microphone streams for recording reuse", async () => {
    const camera = createStream();
    const mic = createStream();
    const plugin: DevicePlugin = {
      detectDevices: vi.fn(),
      requestStudioPermissions: vi.fn(),
      sampleMicrophoneLevel: vi.fn(),
      playTestSound: vi.fn(),
      openCameraPreview: vi.fn().mockResolvedValue(camera.stream),
      openMicrophoneStream: vi.fn().mockResolvedValue(mic.stream)
    };
    const service = new DeviceService(plugin);

    await service.openCameraPreview("camera-a");
    await service.openMicrophoneStream("mic-a");

    expect(service.getActiveCameraStream("camera-a")).toBe(camera.stream);
    expect(service.getActiveMicrophoneStream("mic-a")).toBe(mic.stream);

    service.releaseStream("camera", "camera-a");
    expect(service.getActiveCameraStream("camera-a")).toBeUndefined();
  });

  it("does not release a newer stream when an older preview finishes late", async () => {
    const first = createStream();
    const second = createStream();
    const plugin: DevicePlugin = {
      detectDevices: vi.fn(),
      requestStudioPermissions: vi.fn(),
      sampleMicrophoneLevel: vi.fn(),
      playTestSound: vi.fn(),
      openCameraPreview: vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream),
      openMicrophoneStream: vi.fn()
    };
    const service = new DeviceService(plugin);

    await service.openCameraPreview("camera-a");
    await service.openCameraPreview("camera-a");
    service.releaseStream("camera", "camera-a", first.stream);

    expect(service.getActiveCameraStream("camera-a")).toBe(second.stream);
    expect(second.track.stop).not.toHaveBeenCalled();
  });
});
