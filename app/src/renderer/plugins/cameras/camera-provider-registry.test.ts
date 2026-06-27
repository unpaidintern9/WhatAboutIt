import { describe, expect, it } from "vitest";
import { cameraProviders, getCameraProvider } from "./camera-provider-registry";

describe("camera provider registry", () => {
  it("registers local and wireless camera providers behind the UI", () => {
    expect(cameraProviders.map((provider) => provider.id)).toContain("local-browser-cameras");
    expect(cameraProviders.map((provider) => provider.id)).toContain("wireless-camera-foundation");
    expect(getCameraProvider("wireless-camera-foundation")?.capabilities.wirelessDiscovery).toBe(true);
  });
});
