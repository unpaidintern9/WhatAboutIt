import { describe, expect, it } from "vitest";
import {
  createCameraConnectionState,
  createStudioReadinessReport,
  createSonyCapabilityAudit,
  createSonyConnectionMatrix,
  createUniversalCameraCapabilities,
  getCameraAdvancedSettings,
  getOrderedCameraAssignments,
  preferHealthyCameraConnections,
  saveCameraAdvancedSettings,
  supportedCameraEcosystems,
  wirelessVideoRecommendations
} from "./camera-config";

describe("camera configuration", () => {
  it("preserves stable Camera 1, Camera 2, Camera 3 ordering", () => {
    const assignments = getOrderedCameraAssignments({
      cameras: { camera3: "sony-c", camera1: "sony-a", camera2: "sony-b" },
      microphones: {}
    });

    expect(assignments.map((assignment) => assignment.label)).toEqual(["Camera 1", "Camera 2", "Camera 3"]);
    expect(assignments.map((assignment) => assignment.deviceId)).toEqual(["sony-a", "sony-b", "sony-c"]);
  });

  it("saves and loads gear settings per camera", () => {
    const defaults = saveCameraAdvancedSettings(
      { cameras: { camera1: "sony-a" }, microphones: {} },
      "sony-a",
      { connectionType: "wireless", resolution: "1080p", fps: 30, autoReconnect: true }
    );

    expect(getCameraAdvancedSettings(defaults, "sony-a")).toMatchObject({
      connectionType: "wireless",
      resolution: "1080p",
      fps: 30,
      autoReconnect: true
    });
  });

  it("keeps wireless video unconfirmed unless actual support is known", () => {
    const capability = createSonyCapabilityAudit({ model: "Sony model pending", bluetoothControl: "supported" });

    expect(capability.wifiVideo).toBe("not-confirmed");
    expect(wirelessVideoRecommendations(capability).map((item) => item.label)).toContain(
      "This camera may only support Bluetooth control, not wireless video"
    );
  });

  it("builds the Sony connection matrix without pretending Bluetooth is video", () => {
    const matrix = createSonyConnectionMatrix(
      createSonyCapabilityAudit({ model: "Sony A", usbWebcam: "supported", bluetoothControl: "supported" })
    );

    expect(matrix.find((item) => item.method === "usb-webcam")?.status).toBe("supported");
    expect(matrix.find((item) => item.method === "wifi-video")?.status).toBe("not-confirmed");
    expect(matrix.find((item) => item.method === "bluetooth-control")?.recommendation).toBe(
      "This camera may only support Bluetooth control, not wireless video"
    );
  });

  it("reports reconnect, signal, and battery states in friendly terms", () => {
    expect(createCameraConnectionState({ cameraId: "sony-a", connected: true, signal: "weak" })).toMatchObject({
      userStatus: "Signal weak",
      canRecord: true
    });
    expect(createCameraConnectionState({ cameraId: "sony-a", connected: true, batteryPercent: 10 })).toMatchObject({
      userStatus: "Battery low",
      canRecord: true
    });
    expect(createCameraConnectionState({ cameraId: "sony-a", connected: false })).toMatchObject({
      userStatus: "Not connected",
      canRecord: false
    });
  });

  it("supports creator camera ecosystems without brand-specific UI logic", () => {
    expect(supportedCameraEcosystems).toEqual(
      expect.arrayContaining(["Sony", "Canon", "Nikon", "Panasonic", "Fujifilm", "GoPro", "DJI", "Blackmagic", "USB webcam", "HDMI capture", "Network camera", "Future provider"])
    );
    const camera = createUniversalCameraCapabilities({ cameraName: "Creator Cam", manufacturer: "Canon", usb: "available" });

    expect(camera.wirelessVideo).toBe("not-confirmed");
    expect(camera.battery).toBe("unavailable");
    expect(camera.manufacturer).toBe("Canon");
  });

  it("prefers healthy connections before recording", () => {
    const sorted = preferHealthyCameraConnections([
      createUniversalCameraCapabilities({ cameraName: "Weak", healthStatus: "signal-weak" }),
      createUniversalCameraCapabilities({ cameraName: "Ready", healthStatus: "ready" }),
      createUniversalCameraCapabilities({ cameraName: "Missing", healthStatus: "not-connected" })
    ]);

    expect(sorted.map((camera) => camera.cameraName)).toEqual(["Ready", "Weak", "Missing"]);
  });

  it("creates friendly studio readiness reports", () => {
    const report = createStudioReadinessReport({
      cameraAssignments: getOrderedCameraAssignments({ cameras: { camera1: "ready-cam", camera2: "low-battery" }, microphones: {} }),
      cameraStates: {
        "ready-cam": createCameraConnectionState({ cameraId: "ready-cam", connected: true }),
        "low-battery": createCameraConnectionState({ cameraId: "low-battery", connected: true, batteryPercent: 8 })
      },
      mics: [
        { label: "Morgan Mic", ready: true },
        { label: "Guest Mic", ready: false }
      ],
      storageAvailable: true
    });

    expect(report.headline).toBe("Needs Attention");
    expect(report.items.map((item) => item.message)).toContain("Camera 1 Ready");
    expect(report.items.map((item) => item.message)).toContain("Camera 2 Battery Low");
    expect(report.items.map((item) => item.message)).toContain("Guest Mic Needs Attention");
    expect(report.items.map((item) => item.message)).toContain("Storage Available");
  });
});
