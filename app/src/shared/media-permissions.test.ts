import { describe, expect, it } from "vitest";
import { cameraAccessMessage, isStudioMediaPermission } from "./media-permissions";

describe("media permissions", () => {
  it("allows only Electron media permission checks", () => {
    expect(isStudioMediaPermission("media")).toBe(true);
    expect(isStudioMediaPermission("geolocation")).toBe(false);
    expect(isStudioMediaPermission("notifications")).toBe(false);
  });

  it("gives an exact Windows privacy recovery when camera access is blocked", () => {
    expect(cameraAccessMessage("denied", 0)).toContain("Let desktop apps access your camera");
    expect(cameraAccessMessage("restricted", 0)).toContain("fully restart");
  });

  it("separates an empty Windows device list from a privacy denial", () => {
    expect(cameraAccessMessage("granted", 0)).toContain("Device Manager > Cameras");
    expect(cameraAccessMessage("granted", 1)).toBeUndefined();
  });
});
