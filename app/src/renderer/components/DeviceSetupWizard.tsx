import { AlertTriangle, Camera, CheckCircle2, Headphones, HelpCircle, Mic2, RotateCcw, Search, Settings, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DeviceDefaults } from "../../shared/types";
import { saveCameraSlot, saveMicrophoneSlot } from "../../shared/device-config";
import { AudioMeter, Button } from ".";
import type { DeviceDetectionResult, StudioDevice } from "../plugins/devices/types";
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
  onOpenCameraPreview: (deviceId?: string) => Promise<MediaStream>;
  onOpenMicrophoneStream: (deviceId?: string) => Promise<MediaStream>;
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
  onPlayTestSound,
  onOpenCameraPreview,
  onOpenMicrophoneStream
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
          <WizardHeading title="Let's pick your cameras" message="Choose up to three cameras. Keep it simple here; the little gear has the extra knobs if you need them." />
          {detection.cameras.length === 0 ? (
            <FriendlyState title={getEmptyStateMessage("camera")} message="Plug in a camera, close other camera apps, then choose Find Cameras." />
          ) : (
            <div className="camera-card-grid">
              {cameraSlots.map((slot) => (
                <CameraSetupCard
                  key={slot.key}
                  label={slot.label}
                  selectedDeviceId={defaults.cameras[slot.key]}
                  devices={detection.cameras}
                  onChoose={(deviceId) => onDefaultsChange(saveCameraSlot(defaults, slot.key, deviceId))}
                  onRefresh={onRefresh}
                  onOpenCameraPreview={onOpenCameraPreview}
                />
              ))}
            </div>
          )}
          <div className="camera-find-strip">
            <Button variant="secondary" icon={<Search size={20} />} onClick={onRefresh}>Find Cameras</Button>
            <span>Everything stays local while the studio looks for what is connected.</span>
          </div>
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
                <SetupMicFeedback deviceId={defaults.microphones.morganMic} onOpenMicrophoneStream={onOpenMicrophoneStream} fallbackLevel={microphoneLevel} />
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

function CameraSetupCard({
  label,
  selectedDeviceId,
  devices,
  onChoose,
  onRefresh,
  onOpenCameraPreview
}: {
  label: string;
  selectedDeviceId?: string;
  devices: StudioDevice[];
  onChoose: (deviceId: string) => void;
  onRefresh: () => void;
  onOpenCameraPreview: (deviceId?: string) => Promise<MediaStream>;
}) {
  const selectedDevice = devices.find((device) => device.id === selectedDeviceId);
  const firstDevice = devices[0];
  const [previewStatus, setPreviewStatus] = useState<"idle" | "starting" | "live" | "ready" | "needs-attention" | "busy" | "permission">("idle");
  const [helpOpen, setHelpOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const status = getCameraCardStatus(selectedDevice, devices.length, previewStatus);
  const buttonLabel = selectedDevice ? "Test Camera" : firstDevice ? "Use This Camera" : "Choose Camera";

  useEffect(() => {
    let canceled = false;

    async function startPreview() {
      releaseCamera();
      if (!selectedDeviceId) {
        setPreviewStatus("idle");
        return;
      }

      setPreviewStatus("starting");
      try {
        const stream = await onOpenCameraPreview(selectedDeviceId);
        if (canceled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setPreviewStatus("live");
      } catch (error) {
        setPreviewStatus(getPreviewErrorState(error));
      }
    }

    void startPreview();

    return () => {
      canceled = true;
      releaseCamera();
    };
  }, [onOpenCameraPreview, selectedDeviceId]);

  function releaseCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = undefined;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function releaseCameraToReady() {
    releaseCamera();
    setPreviewStatus(selectedDevice ? "ready" : "idle");
  }

  return (
    <article className={`camera-setup-card ${status.className}`}>
      <div className="camera-card-topline">
        <h4>{label}</h4>
        <details className="camera-gear-menu">
          <summary aria-label={`${label} advanced settings`}>
            <Settings size={18} />
          </summary>
          <div className="camera-gear-panel">
            <span>Connection type: {formatConnectionType(selectedDevice?.camera?.connectionType)}</span>
            <span>Resolution: {selectedDevice?.camera?.maxResolution ?? "Auto"}</span>
            <span>FPS: {selectedDevice?.camera?.maxFps ?? "Auto"}</span>
            <span>Preferred camera: {selectedDevice?.camera?.preferred ? "Yes" : "Not set"}</span>
            <span>Auto reconnect: {selectedDevice?.camera?.autoReconnect === false ? "Off" : "On"}</span>
            <span>Signal: {formatSignal(selectedDevice?.camera?.signal)}</span>
            <span>Battery: {formatBattery(selectedDevice?.camera?.batteryPercent)}</span>
            <button type="button" onClick={() => onChoose("")}>Forget camera</button>
          </div>
        </details>
      </div>
      <div className={`setup-live-preview ${previewStatus}`}>
        <video ref={videoRef} muted playsInline aria-label={`${label} setup live preview`} />
        {previewStatus !== "live" && (
          <div>
            {previewStatus === "busy" || previewStatus === "permission" ? <AlertTriangle size={24} /> : <Camera size={24} />}
            <strong>{getPreviewStatusCopy(previewStatus)}</strong>
          </div>
        )}
      </div>
      <div className="camera-card-status">
        <strong>{status.text}</strong>
        <span>{getCameraCardSubcopy(selectedDevice, previewStatus, label)}</span>
      </div>
      <p className="camera-name">{selectedDevice?.label ?? "No camera picked yet"}</p>
      <DeviceSelect
        label="Choose Camera"
        value={selectedDeviceId ?? ""}
        devices={devices}
        emptyLabel="Choose Camera"
        onChange={onChoose}
      />
      <div className="camera-button-row">
        <Button variant={selectedDevice ? "secondary" : "primary"} icon={<Camera size={20} />} onClick={() => onChoose(selectedDeviceId ?? firstDevice?.id ?? "")}>
          {buttonLabel}
        </Button>
        <Button variant="secondary" icon={<RotateCcw size={18} />} onClick={onRefresh}>Refresh Cameras</Button>
        <Button variant="secondary" icon={<X size={18} />} onClick={releaseCameraToReady}>Release Camera</Button>
        <Button variant="secondary" icon={<HelpCircle size={18} />} onClick={() => setHelpOpen((current) => !current)}>Open Camera Help</Button>
      </div>
      {helpOpen && (
        <FriendlyState
          title="Camera help"
          message="Close other camera apps, pick the camera again, then watch for Live in this card."
        />
      )}
      <div className="camera-signal-line">
        <span>Signal: {formatSignal(selectedDevice?.camera?.signal)}</span>
        {selectedDevice?.camera?.batteryPercent !== undefined && <span>Battery: {formatBattery(selectedDevice.camera.batteryPercent)}</span>}
      </div>
    </article>
  );
}

function SetupMicFeedback({
  deviceId,
  fallbackLevel,
  onOpenMicrophoneStream
}: {
  deviceId?: string;
  fallbackLevel: number;
  onOpenMicrophoneStream: (deviceId?: string) => Promise<MediaStream>;
}) {
  const [level, setLevel] = useState(fallbackLevel);

  useEffect(() => {
    if (!deviceId || !window.AudioContext) {
      setLevel(fallbackLevel);
      return undefined;
    }

    let canceled = false;
    let frame = 0;
    let audioContext: AudioContext | undefined;
    let stream: MediaStream | undefined;

    async function startMeter() {
      try {
        stream = await onOpenMicrophoneStream(deviceId);
        audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        const samples = new Uint8Array(analyser.frequencyBinCount);
        source.connect(analyser);

        const tick = () => {
          if (canceled) return;
          analyser.getByteTimeDomainData(samples);
          const volume = samples.reduce((total, sample) => total + Math.abs(sample - 128), 0) / Math.max(samples.length, 1);
          setLevel(Math.min(100, Math.round(volume * 4)));
          frame = window.requestAnimationFrame(tick);
        };

        tick();
      } catch {
        setLevel(0);
      }
    }

    void startMeter();

    return () => {
      canceled = true;
      if (frame) window.cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      void audioContext?.close();
    };
  }, [deviceId, fallbackLevel, onOpenMicrophoneStream]);

  const copy = level > 12 ? "We hear you" : level > 0 ? "Try speaking closer" : "We can't hear you yet";

  return (
    <div className={`setup-mic-feedback ${level > 12 ? "heard" : level > 0 ? "quiet" : "muted"}`} aria-live="polite">
      <AudioMeter label="Live mic level" level={level} />
      <p>{copy}</p>
    </div>
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

function getCameraCardStatus(device: StudioDevice | undefined, availableCount: number, previewStatus: "idle" | "starting" | "live" | "ready" | "needs-attention" | "busy" | "permission") {
  if (!device) return { text: availableCount > 0 ? "Needs attention" : "Not connected", className: "needs-attention" };
  if (previewStatus === "live") return { text: "Live", className: "ready live" };
  if (previewStatus === "busy") return { text: "Used by another app", className: "needs-attention" };
  if (previewStatus === "permission") return { text: "Permission needed", className: "needs-attention" };
  if (previewStatus === "needs-attention") return { text: "Needs attention", className: "needs-attention" };
  if (device.camera?.signal === "lost") return { text: "Needs attention", className: "needs-attention" };
  return { text: "Ready", className: "ready" };
}

function getPreviewErrorState(error: unknown): "needs-attention" | "busy" | "permission" {
  const message = String(error);
  if (message.includes("NotReadableError") || message.includes("TrackStartError")) return "busy";
  if (message.includes("NotAllowedError") || message.includes("Permission")) return "permission";
  return "needs-attention";
}

function getPreviewStatusCopy(status: "idle" | "starting" | "live" | "ready" | "needs-attention" | "busy" | "permission") {
  if (status === "starting") return "Starting live preview";
  if (status === "busy") return "Used by another app";
  if (status === "permission") return "Permission needed";
  if (status === "needs-attention") return "Needs Attention";
  if (status === "ready") return "Released";
  return "Pick a camera";
}

function getCameraCardSubcopy(device: StudioDevice | undefined, previewStatus: "idle" | "starting" | "live" | "ready" | "needs-attention" | "busy" | "permission", label: string) {
  if (!device) return "Pick a camera when you are ready";
  if (previewStatus === "live") return `${label} is showing live`;
  if (previewStatus === "busy") return "Close other camera apps, then refresh.";
  if (previewStatus === "permission") return "Allow camera access, then refresh.";
  if (previewStatus === "ready") return `${label} is released`;
  return `${label} is ready`;
}

function formatConnectionType(value?: StudioDevice["camera"] extends infer CameraMeta ? CameraMeta extends { connectionType: infer Type } ? Type : never : never) {
  if (value === "built-in") return "Built-in";
  if (value === "usb") return "Plugged in";
  if (value === "capture-card") return "Capture card";
  if (value === "wireless") return "Wireless";
  return "Auto";
}

function formatSignal(signal?: StudioDevice["camera"] extends infer CameraMeta ? CameraMeta extends { signal: infer Signal } ? Signal : never : never) {
  if (signal === "good") return "Good";
  if (signal === "weak") return "Weak";
  if (signal === "lost") return "Lost";
  return "Good";
}

function formatBattery(percent?: number) {
  return percent === undefined ? "Not available" : `${percent}%`;
}

function getReadinessCopy(state: ReturnType<typeof getDeviceReadiness>) {
  if (state === "needs-permission") return "We need permission before the app can see your camera and microphone names.";
  if (state === "needs-camera") return "Pick at least Camera 1 so the studio knows what to use first.";
  if (state === "needs-microphone") return "Pick Morgan Mic so the studio knows where Morgan's voice comes from.";
  return "Your device choices are saved locally. Recording still comes in the next phase.";
}
