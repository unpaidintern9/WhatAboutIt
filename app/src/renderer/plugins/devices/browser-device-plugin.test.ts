import { afterEach, describe, expect, it, vi } from "vitest";
import { browserDevicePlugin } from "./browser-device-plugin";

function setMediaDevices(mediaDevices: Partial<MediaDevices>) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: mediaDevices
  });
}

describe("browserDevicePlugin", () => {
  afterEach(() => {
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
});
