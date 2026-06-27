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
  onPlayTestSound: vi.fn()
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
  });

  it("renders assigned camera slots when cameras exist", () => {
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
    expect(markup).toContain("Preview comes in Phase 2");
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
    expect(headphoneMarkup).toContain("Play Test Sound");
    expect(readyMarkup).toContain("Everything looks good");
  });
});
