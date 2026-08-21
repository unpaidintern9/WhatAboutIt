import { describe, expect, it, vi } from "vitest";
import { defaultDeviceDefaults } from "../../shared/device-config";
import type { DevicePlugin } from "../plugins/devices/types";
import { DeviceService, getDeviceReadiness, getEmptyStateMessage } from "./device-service";

function createStream() {
  const createTrack = () => ({
    readyState: "live",
    stop: vi.fn(function stop(this: { readyState: string }) {
      this.readyState = "ended";
    }),
    addEventListener: vi.fn(),
    clone: vi.fn()
  });
  const track = createTrack();
  const clones: ReturnType<typeof createTrack>[] = [];
  const makeStream = (streamTrack: ReturnType<typeof createTrack>) => ({
    getTracks: () => [streamTrack],
    getAudioTracks: () => [streamTrack],
    getVideoTracks: () => [streamTrack],
    clone: () => {
      const clonedTrack = createTrack();
      clones.push(clonedTrack);
      return makeStream(clonedTrack);
    }
  });
  return {
    track,
    clones,
    stream: makeStream(track) as unknown as MediaStream
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

  it("shares one physical microphone source across independent channel consumers", async () => {
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

    expect(plugin.openMicrophoneStream).toHaveBeenCalledTimes(1);
    expect(first.track.stop).not.toHaveBeenCalled();
    expect(first.clones).toHaveLength(2);
    expect(second.track.stop).not.toHaveBeenCalled();
  });

  it("shares one physical camera source across independent preview consumers", async () => {
    const camera = createStream();
    const plugin: DevicePlugin = {
      detectDevices: vi.fn(),
      requestStudioPermissions: vi.fn(),
      sampleMicrophoneLevel: vi.fn(),
      playTestSound: vi.fn(),
      openCameraPreview: vi.fn().mockResolvedValue(camera.stream),
      openMicrophoneStream: vi.fn()
    };
    const service = new DeviceService(plugin);

    const [firstConsumer, secondConsumer] = await Promise.all([
      service.openCameraPreview("camera-a"),
      service.openCameraPreview("camera-a")
    ]);

    expect(plugin.openCameraPreview).toHaveBeenCalledTimes(1);
    expect(camera.clones).toHaveLength(2);
    expect(service.getActiveCameraStream("camera-a")).toBe(camera.stream);

    service.releaseStream("camera", "camera-a", firstConsumer);

    expect(camera.clones[0].stop).toHaveBeenCalledTimes(1);
    expect(camera.clones[1].stop).not.toHaveBeenCalled();
    expect(camera.track.stop).not.toHaveBeenCalled();
    expect(service.getActiveCameraStream("camera-a")).toBe(camera.stream);

    service.releaseStream("camera", "camera-a", secondConsumer);
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

  it("opens a fresh physical camera source after the previous source ends", async () => {
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

    const firstConsumer = await service.openCameraPreview("camera-a");
    service.releaseStream("camera", "camera-a");
    await service.openCameraPreview("camera-a");
    service.releaseStream("camera", "camera-a", firstConsumer);

    expect(service.getActiveCameraStream("camera-a")).toBe(second.stream);
    expect(first.track.stop).toHaveBeenCalledTimes(1);
    expect(second.track.stop).not.toHaveBeenCalled();
  });
});
