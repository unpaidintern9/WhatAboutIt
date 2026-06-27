import { Camera, CheckCircle2, Headphones, Mic2, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { DeviceDefaults } from "../../shared/types";
import { saveCameraSlot, saveMicrophoneSlot } from "../../shared/device-config";
import { AudioMeter, Button, CameraPreview } from ".";
import type { DeviceDetectionResult } from "../plugins/devices/types";
import { findDeviceLabel, getDeviceReadiness, getEmptyStateMessage } from "../services";

interface DeviceSetupWizardProps {
  detection: DeviceDetectionResult;
  defaults: DeviceDefaults;
  microphoneLevel: number;
  currentStep: number;
  onStepChange: (step: number) => void;
  onRefresh: () => void;
  onRequestPermission: () => void;
  onDefaultsChange: (defaults: DeviceDefaults) => void;
  onTestMicrophone: () => void;
  onPlayTestSound: () => void;
}

const steps = [
  { title: "Camera setup", icon: Camera },
  { title: "Microphone setup", icon: Mic2 },
  { title: "Headphone check", icon: Headphones },
  { title: "Ready check", icon: ShieldCheck }
];

const cameraSlots = [
  { key: "camera1", label: "Camera 1" },
  { key: "camera2", label: "Camera 2" },
  { key: "camera3", label: "Camera 3" }
] as const;

const microphoneSlots = [
  { key: "morganMic", label: "Morgan Mic" },
  { key: "guestMic", label: "Guest Mic" },
  { key: "extraMic", label: "Extra Mic" }
] as const;

export function DeviceSetupWizard({
  detection,
  defaults,
  microphoneLevel,
  currentStep,
  onStepChange,
  onRefresh,
  onRequestPermission,
  onDefaultsChange,
  onTestMicrophone,
  onPlayTestSound
}: DeviceSetupWizardProps) {
  const readyState = getDeviceReadiness(detection, defaults);

  return (
    <section className="device-wizard">
      <div className="wizard-intro">
        <p className="signature">Let's check your studio</p>
        <h2>Studio Setup</h2>
        <p className="soft-copy">
          We will make sure your cameras, mics, and headphones are easy to pick before recording day.
        </p>
        <div className="wizard-actions">
          <Button variant="secondary" onClick={onRefresh}>Check again</Button>
          {detection.permissionNeeded && (
            <Button variant="primary" onClick={onRequestPermission}>Let the studio look and listen</Button>
          )}
        </div>
      </div>

      <nav className="wizard-steps" aria-label="Device setup steps">
        {steps.map((step, index) => {
          const StepIcon = step.icon;
          return (
            <button
              className={currentStep === index ? "active" : ""}
              key={step.title}
              onClick={() => onStepChange(index)}
              type="button"
            >
              <StepIcon size={20} />
              <span>Step {index + 1}</span>
              {step.title}
            </button>
          );
        })}
      </nav>

      {currentStep === 0 && (
        <div className="wizard-panel">
          <WizardHeading title="Pick your cameras" message="Use up to three camera slots. Live preview comes later; these boxes stay photo-free and safe." />
          {detection.cameras.length === 0 ? (
            <FriendlyState title={getEmptyStateMessage("camera")} message="Plug in a camera, close other camera apps, then check again." />
          ) : (
            <div className="device-slot-grid">
              {cameraSlots.map((slot) => (
                <DeviceSlot key={slot.key} label={slot.label}>
                  <CameraPreview label={slot.label} />
                  <DeviceSelect
                    label={`Assign ${slot.label}`}
                    value={defaults.cameras[slot.key] ?? ""}
                    devices={detection.cameras}
                    emptyLabel="Leave this camera off"
                    onChange={(deviceId) => onDefaultsChange(saveCameraSlot(defaults, slot.key, deviceId))}
                  />
                </DeviceSlot>
              ))}
            </div>
          )}
        </div>
      )}

      {currentStep === 1 && (
        <div className="wizard-panel">
          <WizardHeading title="Pick your microphones" message="Choose who each mic belongs to, then say something and watch the meter move." />
          {detection.microphones.length === 0 ? (
            <FriendlyState title={getEmptyStateMessage("microphone")} message="Plug in a mic, make sure it is on, then check again." />
          ) : (
            <div className="device-slot-grid">
              {microphoneSlots.map((slot) => (
                <DeviceSlot key={slot.key} label={slot.label}>
                  <DeviceSelect
                    label={`Assign ${slot.label}`}
                    value={defaults.microphones[slot.key] ?? ""}
                    devices={detection.microphones}
                    emptyLabel="No mic picked yet"
                    onChange={(deviceId) => onDefaultsChange(saveMicrophoneSlot(defaults, slot.key, deviceId))}
                  />
                </DeviceSlot>
              ))}
              <div className="device-test-card">
                <Button variant="primary" icon={<Mic2 size={20} />} onClick={onTestMicrophone}>Say something!</Button>
                <AudioMeter label="Mic check" level={microphoneLevel} />
                {microphoneLevel === 0 && <p>{getEmptyStateMessage("quiet")}</p>}
              </div>
            </div>
          )}
        </div>
      )}

      {currentStep === 2 && (
        <div className="wizard-panel">
          <WizardHeading title="Check your headphones" message="Pick your listening device if your computer shares that list with us, then play a quick sound." />
          <DeviceSelect
            label="Headphones or speakers"
            value={defaults.audioOutputId ?? ""}
            devices={detection.speakers}
            emptyLabel={detection.speakers.length > 0 ? "Use system default" : "System default"}
            onChange={(deviceId) => onDefaultsChange({ ...defaults, audioOutputId: deviceId || undefined })}
          />
          {detection.speakers.length === 0 && (
            <FriendlyState title="Using your system sound" message="Some computers do not share the speaker list. That is okay; the test sound will use your current output." />
          )}
          <Button variant="primary" icon={<Headphones size={20} />} onClick={onPlayTestSound}>Play Test Sound</Button>
        </div>
      )}

      {currentStep === 3 && (
        <div className="wizard-panel ready-panel">
          <WizardHeading title="Ready-to-record check" message="This does not start recording. It only checks whether your setup choices are saved." />
          <div className="readiness-card">
            <CheckCircle2 size={36} />
            <div>
              <h3>{readyState === "ready" ? getEmptyStateMessage("ready") : "Almost there"}</h3>
              <p>{getReadinessCopy(readyState)}</p>
            </div>
          </div>
          <div className="saved-device-list">
            <span>Camera 1: {findDeviceLabel(detection.cameras, defaults.cameras.camera1)}</span>
            <span>Morgan Mic: {findDeviceLabel(detection.microphones, defaults.microphones.morganMic)}</span>
            <span>Headphones: {findDeviceLabel(detection.speakers, defaults.audioOutputId) || "System default"}</span>
          </div>
        </div>
      )}
    </section>
  );
}

function WizardHeading({ title, message }: { title: string; message: string }) {
  return (
    <div className="wizard-heading">
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  );
}

function DeviceSlot({ label, children }: { label: string; children: ReactNode }) {
  return (
    <article className="device-slot">
      <h4>{label}</h4>
      {children}
    </article>
  );
}

function DeviceSelect({
  label,
  value,
  devices,
  emptyLabel,
  onChange
}: {
  label: string;
  value: string;
  devices: { id: string; label: string }[];
  emptyLabel: string;
  onChange: (deviceId: string) => void;
}) {
  return (
    <label className="device-select">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{emptyLabel}</option>
        {devices.map((device) => (
          <option value={device.id} key={device.id}>
            {device.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FriendlyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="friendly-state">
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}

function getReadinessCopy(state: ReturnType<typeof getDeviceReadiness>) {
  if (state === "needs-permission") return "We need permission before the app can see your camera and microphone names.";
  if (state === "needs-camera") return "Pick at least Camera 1 so the studio knows what to use first.";
  if (state === "needs-microphone") return "Pick Morgan Mic so the studio knows where Morgan's voice comes from.";
  return "Your device choices are saved locally. Recording still comes in the next phase.";
}
