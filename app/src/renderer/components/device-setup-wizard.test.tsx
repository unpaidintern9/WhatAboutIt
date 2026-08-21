import { act } from "react";
import { createRoot } from "react-dom/client";
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
  onOpenMicrophoneStream: vi.fn(),
  onGoRecord: vi.fn()
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
    expect(markup).toContain("Pick Camera 1");
    expect(markup).toContain("Pick Morgan Mic");
    expect(markup).toContain("Go to Record");
    expect(markup).toContain("Use This Camera");
    expect(markup).toContain("Refresh Cameras");
    expect(markup).toContain("Release Camera");
    expect(markup).toContain("Open Camera Help");
    expect(markup).toContain("Needs attention");
    expect(markup).toContain("Connection type");
    expect(markup).not.toContain("driver stack");
    expect(markup).not.toContain("backend provider");
  });

  it("keeps available cameras visible when a saved camera is missing", () => {
    const markup = renderToStaticMarkup(
      <DeviceSetupWizard
        {...baseProps}
        defaults={{ cameras: { camera1: "missing-camera" }, microphones: {} }}
        detection={{
          cameras: [{ id: "sony-camera", label: "Sony Camera (Imaging Edge)", kind: "camera" }],
          microphones: [],
          speakers: [],
          permissionNeeded: false
        }}
      />
    );

    expect(markup).toContain("Sony Camera (Imaging Edge)");
    expect(markup).toContain("Needs attention");
    expect(markup).toContain("Use This Camera");
  });

  it("keeps Sony camera options visible in Studio Setup", () => {
    const markup = renderToStaticMarkup(
      <DeviceSetupWizard
        {...baseProps}
        detection={{
          cameras: [
            { id: "sony-camera", label: "Sony Camera (Imaging Edge)", kind: "camera" },
            { id: "integrated-camera", label: "Integrated Camera (13d3:540a)", kind: "camera" }
          ],
          microphones: [],
          speakers: [],
          permissionNeeded: false
        }}
      />
    );

    expect(markup).toContain("Sony Camera (Imaging Edge)");
    expect(markup).toContain("Integrated Camera (13d3:540a)");
    expect(markup).toContain("2 of 3 simultaneous camera feeds detected");
    expect(markup).toContain("Windows exposes only 1 Imaging Edge feed");
    expect(markup).toContain("USB Streaming or separate HDMI capture devices");
  });

  it("reports three unique Windows camera feeds as simultaneously available", () => {
    const markup = renderToStaticMarkup(
      <DeviceSetupWizard
        {...baseProps}
        detection={{
          cameras: [
            { id: "sony-one", label: "Sony Alpha 1", kind: "camera" },
            { id: "sony-two", label: "Sony Alpha 2", kind: "camera" },
            { id: "sony-three", label: "Sony Alpha 3", kind: "camera" }
          ],
          microphones: [],
          speakers: [],
          permissionNeeded: false
        }}
      />
    );

    expect(markup).toContain("3 of 3 simultaneous camera feeds detected");
    expect(markup).toContain("Pick any three");
    expect(markup).toContain("Each distinct Windows camera can be assigned to any camera slot");
  });

  it("renders unlabeled camera fallback options before permission", () => {
    const markup = renderToStaticMarkup(
      <DeviceSetupWizard
        {...baseProps}
        detection={{
          cameras: [{ id: "hidden-camera", label: "Camera 1", kind: "camera" }],
          microphones: [],
          speakers: [],
          permissionNeeded: true
        }}
      />
    );

    expect(markup).toContain("Camera 1");
    expect(markup).toContain("Let the studio look and listen");
  });

  it("renders refreshed camera options from updated detection", () => {
    const before = renderToStaticMarkup(
      <DeviceSetupWizard
        {...baseProps}
        detection={{ cameras: [], microphones: [], speakers: [], permissionNeeded: false }}
      />
    );
    const after = renderToStaticMarkup(
      <DeviceSetupWizard
        {...baseProps}
        detection={{
          cameras: [{ id: "integrated-camera", label: "Integrated Camera", kind: "camera" }],
          microphones: [],
          speakers: [],
          permissionNeeded: false
        }}
      />
    );

    expect(before).toContain("No camera found");
    expect(after).toContain("Integrated Camera");
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
    expect(microphoneMarkup).toContain("NO SIGNAL");
    expect(microphoneMarkup).toContain("Automatic / combined input");
    expect(microphoneMarkup).toContain("Physical Input 1 (left channel)");
    expect(microphoneMarkup).toContain("Physical Input 2 (right channel)");
    expect(microphoneMarkup).toContain("Input 16");
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

  it("opens Windows camera privacy settings when every camera is blocked", () => {
    const onOpenCameraPrivacySettings = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <DeviceSetupWizard
          {...baseProps}
          onOpenCameraPrivacySettings={onOpenCameraPrivacySettings}
          detection={{
            cameras: [],
            microphones: [],
            speakers: [],
            permissionNeeded: true,
            cameraAccessStatus: "denied"
          }}
        />
      );
    });

    const settingsButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Windows camera settings"));
    expect(settingsButton).toBeTruthy();

    act(() => {
      settingsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenCameraPrivacySettings).toHaveBeenCalledTimes(1);
  });

  it("calls Go to Record from the primary setup action", () => {
    const onGoRecord = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <DeviceSetupWizard
          {...baseProps}
          onGoRecord={onGoRecord}
          detection={{ cameras: [], microphones: [], speakers: [], permissionNeeded: false }}
        />
      );
    });

    const goRecord = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Go to Record"));
    expect(goRecord).toBeTruthy();

    act(() => {
      goRecord?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onGoRecord).toHaveBeenCalledTimes(1);
  });
});
