import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultDeviceDefaults } from "../../shared/device-config";
import { DeviceSetupWizard } from "./DeviceSetupWizard";

const baseProps = {
  defaults: defaultDeviceDefaults,
  microphoneLevel: 0,
  currentStep: 0,
  onStepChange: vi.fn(),
  onRefresh: vi.fn(),
  onRequestPermission: vi.fn(),
  onDefaultsChange: vi.fn(),
  onTestMicrophone: vi.fn(),
  onPlayTestSound: vi.fn(),
  onOpenCameraPreview: vi.fn(),
  onOpenMicrophoneStream: vi.fn()
};

describe("DeviceSetupWizard", () => {
  it("renders a friendly camera empty state", () => {
    const markup = renderToStaticMarkup(
      <DeviceSetupWizard
        {...baseProps}
        detection={{ cameras: [], microphones: [], speakers: [], permissionNeeded: false }}
      />
    );

    expect(markup).toContain("No camera found");
    expect(markup).toContain("Plug in a camera");
    expect(markup).toContain("Find Cameras");
  });

  it("renders simple camera cards when cameras exist", () => {
    const markup = renderToStaticMarkup(
      <DeviceSetupWizard
        {...baseProps}
        detection={{
          cameras: [{ id: "camera-a", label: "Studio Camera", kind: "camera" }],
          microphones: [],
          speakers: [],
          permissionNeeded: false
        }}
      />
    );

    expect(markup).toContain("Camera 1");
    expect(markup).toContain("Studio Camera");
    expect(markup).toContain("Use This Camera");
    expect(markup).toContain("Refresh Cameras");
    expect(markup).toContain("Release Camera");
    expect(markup).toContain("Open Camera Help");
    expect(markup).toContain("Needs attention");
    expect(markup).toContain("Connection type");
    expect(markup).not.toContain("driver stack");
    expect(markup).not.toContain("backend provider");
  });

  it("shows ready status for a selected camera", () => {
    const markup = renderToStaticMarkup(
      <DeviceSetupWizard
        {...baseProps}
        defaults={{ cameras: { camera1: "camera-a" }, microphones: {} }}
        detection={{
          cameras: [{ id: "camera-a", label: "Studio Camera", kind: "camera", camera: { connectionType: "usb", signal: "good" } }],
          microphones: [],
          speakers: [],
          permissionNeeded: false
        }}
      />
    );

    expect(markup).toContain("Ready");
    expect(markup).toContain("Camera 1 is ready");
    expect(markup).toContain("Signal: Good");
    expect(markup).toContain("Test Camera");
    expect(markup).toContain("Camera 1 setup live preview");
  });

  it("renders microphone, headphone, and ready steps", () => {
    const detection = {
      cameras: [{ id: "camera-a", label: "Studio Camera", kind: "camera" as const }],
      microphones: [{ id: "mic-a", label: "Morgan Mic", kind: "microphone" as const }],
      speakers: [{ id: "speaker-a", label: "Studio Headphones", kind: "speaker" as const }],
      permissionNeeded: false
    };

    const microphoneMarkup = renderToStaticMarkup(
      <DeviceSetupWizard {...baseProps} currentStep={1} detection={detection} />
    );
    const headphoneMarkup = renderToStaticMarkup(
      <DeviceSetupWizard {...baseProps} currentStep={2} detection={detection} />
    );
    const readyMarkup = renderToStaticMarkup(
      <DeviceSetupWizard
        {...baseProps}
        currentStep={3}
        detection={detection}
        defaults={{ cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" }, audioOutputId: "speaker-a" }}
      />
    );

    expect(microphoneMarkup).toContain("Morgan Mic");
    expect(microphoneMarkup).toContain("Say something!");
    expect(microphoneMarkup).toContain("We can&#x27;t hear you yet");
    expect(headphoneMarkup).toContain("Play Test Sound");
    expect(readyMarkup).toContain("Everything looks good");
  });

  it("renders permission and busy camera preview language without technical terms", () => {
    const permissionMarkup = renderToStaticMarkup(
      <DeviceSetupWizard
        {...baseProps}
        detection={{ cameras: [], microphones: [], speakers: [], permissionNeeded: true }}
      />
    );

    expect(permissionMarkup).toContain("Let the studio look and listen");
    expect(permissionMarkup).not.toContain("NotAllowedError");
    expect(permissionMarkup).not.toContain("MediaStream");
  });
});
