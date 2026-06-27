import { describe, expect, it } from "vitest";
import { cameraProviders, getCameraProvider } from "./camera-provider-registry";

describe("camera provider registry", () => {
  it("registers local and wireless camera providers behind the UI", () => {
    expect(cameraProviders.map((provider) => provider.id)).toContain("local-browser-cameras");
    expect(cameraProviders.map((provider) => provider.id)).toContain("wireless-camera-foundation");
    expect(cameraProviders.map((provider) => provider.id)).toContain("sony-usb-uvc-cameras");
    expect(cameraProviders.map((provider) => provider.id)).toContain("sony-hdmi-capture-cameras");
    expect(cameraProviders.map((provider) => provider.id)).toContain("sony-wireless-video-cameras");
    expect(cameraProviders.map((provider) => provider.id)).toContain("sony-remote-control-capabilities");
    expect(cameraProviders.map((provider) => provider.id)).toContain("future-sony-sdk-provider");
    expect(cameraProviders.map((provider) => provider.id)).toEqual(
      expect.arrayContaining([
        "canon-camera-provider",
        "nikon-camera-provider",
        "panasonic-camera-provider",
        "fujifilm-camera-provider",
        "gopro-camera-provider",
        "dji-camera-provider",
        "blackmagic-camera-provider",
        "generic-hdmi-capture-provider",
        "generic-network-camera-provider",
        "future-camera-provider"
      ])
    );
    expect(getCameraProvider("wireless-camera-foundation")?.capabilities.wirelessDiscovery).toBe(true);
  });

  it("returns friendly fallback copy when Sony wireless video is not confirmed", async () => {
    const provider = getCameraProvider("sony-wireless-video-cameras");
    const status = await provider?.connect("sony-a");

    expect(status?.status).toBe("needs-attention");
    expect(status?.friendlyMessage).toBe("This camera may only support Bluetooth control, not wireless video");
    expect(status?.fallbackRecommendations).toContain("Try USB");
    expect(status?.fallbackRecommendations).toContain("Try HDMI capture");
  });

  it("exposes a common capability shape for future ecosystems", async () => {
    const provider = getCameraProvider("canon-camera-provider");
    const capabilities = await provider?.getCapabilities("canon-a");

    expect(capabilities).toMatchObject({
      cameraName: "canon-a",
      manufacturer: "Canon",
      usb: "not-confirmed",
      hdmi: "not-confirmed",
      wirelessVideo: "not-confirmed",
      healthStatus: "not-connected"
    });
  });
});
