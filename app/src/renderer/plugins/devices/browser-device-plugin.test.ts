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
    vi.restoreAllMocks();
  });

  it("keeps enumerating devices when one permission request fails", async () => {
    const stop = vi.fn();
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("Camera busy", "NotReadableError"))
      .mockResolvedValueOnce({ getTracks: () => [{ stop }] });

    setMediaDevices({
      getUserMedia,
      enumerateDevices: vi.fn(async () => [
        { deviceId: "sony-camera", kind: "videoinput", label: "Sony Camera (Imaging Edge)" },
        { deviceId: "realtek-mic", kind: "audioinput", label: "Microphone (Realtek(R) Audio)" }
      ] as MediaDeviceInfo[])
    });

    const result = await browserDevicePlugin.requestStudioPermissions();

    expect(result.permissionNeeded).toBe(false);
    expect(result.cameras).toEqual([expect.objectContaining({ id: "sony-camera", label: "Sony Camera (Imaging Edge)" })]);
    expect(result.microphones).toEqual([expect.objectContaining({ id: "realtek-mic", label: "Microphone (Realtek(R) Audio)" })]);
    expect(stop).toHaveBeenCalled();
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
