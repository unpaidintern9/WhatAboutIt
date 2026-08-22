import { afterEach, describe, expect, it, vi } from "vitest";
import { browserDevicePlugin } from "./browser-device-plugin";
import { cameraProviders } from "../cameras/camera-provider-registry";
import type { CameraProvider } from "../cameras/types";

function setMediaDevices(mediaDevices: Partial<MediaDevices>) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: mediaDevices
  });
}

describe("browserDevicePlugin", () => {
  const originalProviderCount = cameraProviders.length;

  afterEach(() => {
    cameraProviders.splice(originalProviderCount);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns a recoverable state when Windows device enumeration hangs", async () => {
    vi.useFakeTimers();
    setMediaDevices({
      enumerateDevices: vi.fn(() => new Promise<MediaDeviceInfo[]>(() => undefined))
    });

    const detection = browserDevicePlugin.detectDevices();
    await vi.advanceTimersByTimeAsync(8000);
    const result = await detection;

    expect(result.permissionNeeded).toBe(false);
    expect(result.cameras).toEqual([]);
    expect(result.errorMessage).toContain("Windows camera service stopped responding");
  });

  it("times out a stuck preview and stops the stream if the driver resolves late", async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    let resolvePreview: ((stream: MediaStream) => void) | undefined;
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => {
      resolvePreview = resolve;
    }));
    setMediaDevices({ getUserMedia });

    const preview = browserDevicePlugin.openCameraPreview("sony-camera");
    const rejection = expect(preview).rejects.toMatchObject({ name: "NotReadableError" });
    await vi.advanceTimersByTimeAsync(10000);
    await rejection;

    resolvePreview?.({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await Promise.resolve();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("does not reopen cameras after Windows has already exposed labeled inputs", async () => {
    const getUserMedia = vi.fn();
    setMediaDevices({
      getUserMedia,
      enumerateDevices: vi.fn(async () => [
        { deviceId: "sony-camera-a", kind: "videoinput", label: "ZV-1F" },
        { deviceId: "sony-camera-b", kind: "videoinput", label: "ZV-1F" },
        { deviceId: "studio-mic", kind: "audioinput", label: "Studio Mic" }
      ] as MediaDeviceInfo[])
    });

    const result = await browserDevicePlugin.requestStudioPermissions();

    expect(result.permissionNeeded).toBe(false);
    expect(result.cameras).toHaveLength(2);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("keeps enumerating devices when one permission request fails", async () => {
    const cameraStop = vi.fn();
    const micStop = vi.fn();
    const getUserMedia = vi.fn(async (constraints?: MediaStreamConstraints) => ({
      getTracks: () => [{ stop: constraints?.video ? cameraStop : micStop }]
    }) as unknown as MediaStream);
    const enumerateDevices = vi
      .fn()
      .mockResolvedValueOnce([
        { deviceId: "sony-camera", kind: "videoinput", label: "" },
        { deviceId: "realtek-mic", kind: "audioinput", label: "" }
      ] as MediaDeviceInfo[])
      .mockResolvedValue([
        { deviceId: "sony-camera", kind: "videoinput", label: "Sony Camera (Imaging Edge)" },
        { deviceId: "realtek-mic", kind: "audioinput", label: "Microphone (Realtek(R) Audio)" }
      ] as MediaDeviceInfo[]);

    setMediaDevices({
      getUserMedia,
      enumerateDevices
    });

    const result = await browserDevicePlugin.requestStudioPermissions();

    expect(result.permissionNeeded).toBe(false);
    expect(result.cameras).toEqual([expect.objectContaining({ id: "sony-camera", label: "Sony Camera (Imaging Edge)" })]);
    expect(result.microphones).toEqual([expect.objectContaining({ id: "realtek-mic", label: "Microphone (Realtek(R) Audio)" })]);
    expect(cameraStop).toHaveBeenCalled();
    expect(micStop).toHaveBeenCalled();
  });

  it("grants camera access through the laptop camera when the default Sony endpoint is busy", async () => {
    const sonyStop = vi.fn();
    const laptopStop = vi.fn();
    const micStop = vi.fn();
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      const video = constraints.video as MediaTrackConstraints | boolean | undefined;
      const exactDevice = typeof video === "object" ? (video.deviceId as { exact?: string } | undefined)?.exact : undefined;
      if (exactDevice === "sony-camera") throw new DOMException("Camera busy", "NotReadableError");
      if (exactDevice === "laptop-camera") return { getTracks: () => [{ stop: laptopStop }] } as unknown as MediaStream;
      if (constraints.audio) return { getTracks: () => [{ stop: micStop }] } as unknown as MediaStream;
      return { getTracks: () => [{ stop: sonyStop }] } as unknown as MediaStream;
    });
    setMediaDevices({
      getUserMedia,
      enumerateDevices: vi
        .fn()
        .mockResolvedValueOnce([
          { deviceId: "sony-camera", kind: "videoinput", label: "" },
          { deviceId: "laptop-camera", kind: "videoinput", label: "" },
          { deviceId: "laptop-mic", kind: "audioinput", label: "" }
        ] as MediaDeviceInfo[])
        .mockResolvedValue([
          { deviceId: "sony-camera", kind: "videoinput", label: "Sony Camera (Imaging Edge)" },
          { deviceId: "laptop-camera", kind: "videoinput", label: "Integrated Camera" },
          { deviceId: "laptop-mic", kind: "audioinput", label: "Microphone Array" }
        ] as MediaDeviceInfo[])
    });

    const result = await browserDevicePlugin.requestStudioPermissions();

    expect(result.permissionNeeded).toBe(false);
    expect(result.cameras.map((camera) => camera.id)).toEqual(["sony-camera", "laptop-camera"]);
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { deviceId: { exact: "laptop-camera" } },
      audio: false
    });
    expect(laptopStop).toHaveBeenCalledTimes(1);
    expect(micStop).toHaveBeenCalledTimes(1);
    expect(sonyStop).not.toHaveBeenCalled();
  });

  it("preserves detected Sony camera names", async () => {
    setMediaDevices({
      enumerateDevices: vi.fn(async () => [
        { deviceId: "sony-camera", kind: "videoinput", label: "Sony Camera (Imaging Edge)" }
      ] as MediaDeviceInfo[])
    });

    const result = await browserDevicePlugin.detectDevices();

    expect(result.cameras).toEqual([expect.objectContaining({ id: "sony-camera", label: "Sony Camera (Imaging Edge)" })]);
  });

  it("opens USB cameras with stable full-HD, 30 fps preferences", async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    setMediaDevices({ getUserMedia });

    await expect(browserDevicePlugin.openCameraPreview("sony-camera")).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({
      video: {
        deviceId: { exact: "sony-camera" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 30 }
      },
      audio: false
    });
  });

  it("falls back to a driver-safe camera request when full-HD constraints are rejected", async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new DOMException("Unsupported mode", "OverconstrainedError"))
      .mockResolvedValueOnce(stream);
    setMediaDevices({ getUserMedia });

    await expect(browserDevicePlugin.openCameraPreview("sony-camera")).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenLastCalledWith({
      video: {
        deviceId: { exact: "sony-camera" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 }
      },
      audio: false
    });
  });

  it("keeps three same-named Imaging Edge endpoints distinct and selectable", async () => {
    setMediaDevices({
      enumerateDevices: vi.fn(async () => [
        { deviceId: "sony-camera-a", kind: "videoinput", label: "Sony Camera (Imaging Edge)" },
        { deviceId: "sony-camera-b", kind: "videoinput", label: "Sony Camera (Imaging Edge)" },
        { deviceId: "sony-camera-c", kind: "videoinput", label: "Sony Camera (Imaging Edge)" }
      ] as MediaDeviceInfo[])
    });

    const result = await browserDevicePlugin.detectDevices();

    expect(result.cameras.map((camera) => ({ id: camera.id, label: camera.label }))).toEqual([
      { id: "sony-camera-a", label: "Sony Camera (Imaging Edge) 1" },
      { id: "sony-camera-b", label: "Sony Camera (Imaging Edge) 2" },
      { id: "sony-camera-c", label: "Sony Camera (Imaging Edge) 3" }
    ]);
  });

  it("preserves every browser-visible computer and interface audio input", async () => {
    setMediaDevices({
      enumerateDevices: vi.fn(async () => [
        { deviceId: "default", kind: "audioinput", label: "Default - Microphone Array" },
        { deviceId: "built-in", kind: "audioinput", label: "Microphone Array (Realtek Audio)" },
        { deviceId: "interface-1-2", kind: "audioinput", label: "Inputs 1-2 (Studio Interface)" },
        { deviceId: "interface-3-4", kind: "audioinput", label: "Inputs 3-4 (Studio Interface)" }
      ] as MediaDeviceInfo[])
    });

    const result = await browserDevicePlugin.detectDevices();

    expect(result.microphones.map((microphone) => microphone.label)).toEqual([
      "Default - Microphone Array",
      "Microphone Array (Realtek Audio)",
      "Inputs 1-2 (Studio Interface)",
      "Inputs 3-4 (Studio Interface)"
    ]);
  });

  it("surfaces the generic Windows name used by the connected USB interface", async () => {
    setMediaDevices({
      enumerateDevices: vi.fn(async () => [
        { deviceId: "m-track-duo", groupId: "m-track-group", kind: "audioinput", label: "Line (2- USB AUDIO  CODEC)" }
      ] as MediaDeviceInfo[])
    });

    const result = await browserDevicePlugin.detectDevices();

    expect(result.microphones).toEqual([expect.objectContaining({
      id: "m-track-duo",
      label: "USB Audio Interface (Line (2- USB AUDIO CODEC))",
      rawLabel: "Line (2- USB AUDIO  CODEC)",
      groupId: "m-track-group",
      audio: { interfaceLike: true }
    })]);
  });

  it("returns fallback camera options before labels are visible", async () => {
    setMediaDevices({
      enumerateDevices: vi.fn(async () => [
        { deviceId: "hidden-camera", kind: "videoinput", label: "" }
      ] as MediaDeviceInfo[])
    });

    const result = await browserDevicePlugin.detectDevices();

    expect(result.permissionNeeded).toBe(true);
    expect(result.cameras).toEqual([expect.objectContaining({ id: "hidden-camera", label: "Camera 1" })]);
  });

  it("does not treat a hidden speaker label as missing camera or microphone permission", async () => {
    setMediaDevices({
      enumerateDevices: vi.fn(async () => [
        { deviceId: "laptop-camera", kind: "videoinput", label: "Integrated Camera" },
        { deviceId: "laptop-mic", kind: "audioinput", label: "Microphone Array" },
        { deviceId: "default", kind: "audiooutput", label: "" }
      ] as MediaDeviceInfo[])
    });

    const result = await browserDevicePlugin.detectDevices();

    expect(result.permissionNeeded).toBe(false);
    expect(result.errorMessage).toBeUndefined();
  });

  it("merges camera provider output into device detection", async () => {
    const provider: CameraProvider = {
      id: "phase-9c-provider",
      label: "Phase 9C Provider",
      kind: "local-browser",
      capabilities: {
        manufacturer: "USB webcam",
        localPreview: true,
        wirelessDiscovery: false,
        batteryStatus: false,
        signalStatus: false,
        autoReconnect: true,
        remoteControl: false,
        hdmi: false,
        usb: true,
        networkStreaming: false
      },
      discover: vi.fn(async () => [{ id: "provider-camera", label: "Provider Camera", kind: "camera" as const }]),
      getCapabilities: vi.fn(),
      connect: vi.fn(),
      reconnect: vi.fn(),
      forget: vi.fn()
    };

    cameraProviders.push(provider);
    setMediaDevices({
      enumerateDevices: vi.fn(async () => [] as MediaDeviceInfo[])
    });

    const result = await browserDevicePlugin.detectDevices();

    expect(result.cameras).toEqual([expect.objectContaining({ id: "provider-camera", label: "Provider Camera" })]);
  });
});
