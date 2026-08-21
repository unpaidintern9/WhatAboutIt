import { AlertTriangle, ArrowRight, Camera, CheckCircle2, Headphones, HelpCircle, Mic2, RotateCcw, Search, Settings, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DeviceDefaults, MicrophoneInputChannel } from "../../shared/types";
import { getDeviceAssignmentConflicts, getMicrophoneInputDisplay, microphoneInputChannelOptions, saveCameraSlot, saveMicrophoneDeviceRoute, saveMicrophoneInputChannel } from "../../shared/device-config";
import { AudioMeter, Button } from ".";
import { calculateAudioLevel, connectInputChannelSource, createStudioAudioContext, getAudioStreamDiagnostics, stopStudioMediaStream } from "../plugins/audio/studio-audio";
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
  onOpenCameraPrivacySettings?: () => void;
  onDefaultsChange: (defaults: DeviceDefaults) => void;
  onTestMicrophone: () => void;
  onPlayTestSound: () => void;
  onOpenCameraPreview: (deviceId?: string) => Promise<MediaStream>;
  onOpenMicrophoneStream: (deviceId?: string) => Promise<MediaStream>;
  onReleaseCameraPreview?: (deviceId?: string, stream?: MediaStream) => void;
  onReleaseMicrophoneStream?: (deviceId?: string, stream?: MediaStream) => void;
  onGoRecord: () => void;
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

function setupDebugEnabled() {
  try {
    return window.localStorage.getItem("waiDeviceDebug") === "1";
  } catch {
    return false;
  }
}

export function DeviceSetupWizard({
  detection,
  defaults,
  microphoneLevel,
  currentStep,
  onStepChange,
  onRefresh,
  onRequestPermission,
  onOpenCameraPrivacySettings,
  onDefaultsChange,
  onTestMicrophone,
  onPlayTestSound,
  onOpenCameraPreview,
  onOpenMicrophoneStream,
  onReleaseCameraPreview,
  onReleaseMicrophoneStream,
  onGoRecord
}: DeviceSetupWizardProps) {
  const initiallyVisibleCameraCount = defaults.cameras.camera3 ? 3 : defaults.cameras.camera2 ? 2 : 1;
  const [visibleCameraCount, setVisibleCameraCount] = useState(initiallyVisibleCameraCount);
  const [showExtraMicrophone, setShowExtraMicrophone] = useState(Boolean(defaults.microphones.extraMic));
  const readyState = getDeviceReadiness(detection, defaults);
  const assignmentConflicts = getDeviceAssignmentConflicts(defaults);
  const cameraCapacity = getCameraCapacity(detection.cameras);
  const setupItems = [
    { label: "Pick Camera 1", ready: Boolean(defaults.cameras.camera1) },
    { label: "Pick Morgan Mic", ready: Boolean(defaults.microphones.morganMic) },
    { label: "Go Record", ready: readyState === "ready" }
  ];
  const readyItemCount = setupItems.filter((item) => item.ready).length;

  function assignMicrophone(slot: (typeof microphoneSlots)[number]["key"], deviceId: string) {
    const routed = saveMicrophoneDeviceRoute(defaults, slot, deviceId);
    const selectedDevice = detection.microphones.find((device) => device.id === deviceId);
    onDefaultsChange({
      ...routed,
      microphoneDeviceLabels: { ...routed.microphoneDeviceLabels, [slot]: selectedDevice?.rawLabel ?? selectedDevice?.label }
    });
  }

  function assignInputChannel(slot: (typeof microphoneSlots)[number]["key"], channel: MicrophoneInputChannel) {
    const deviceId = defaults.microphones[slot];
    const routeInUse = microphoneSlots.some((candidate) => candidate.key !== slot
      && defaults.microphones[candidate.key] === deviceId
      && (defaults.microphoneChannels?.[candidate.key] ?? "mix") === channel);
    if (routeInUse) return;
    onDefaultsChange(saveMicrophoneInputChannel(defaults, slot, channel));
  }

  useEffect(() => {
    if (!setupDebugEnabled()) return;
    console.info("[DeviceDiscovery] Studio Setup received options", {
      permissionNeeded: detection.permissionNeeded,
      cameras: detection.cameras.map((camera) => ({ id: camera.id ? "present" : "missing", label: camera.label })),
      microphones: detection.microphones.map((microphone) => ({ id: microphone.id ? "present" : "missing", label: microphone.label })),
      speakers: detection.speakers.map((speaker) => ({ id: speaker.id ? "present" : "missing", label: speaker.label })),
      selectedCameras: defaults.cameras,
      selectedMicrophones: defaults.microphones
    });
  }, [defaults, detection]);

  return (
    <section className="device-wizard">
      <div className="wizard-intro">
        <div className={`setup-intro-status ${readyState === "ready" ? "ready" : "needs-attention"}`}>
          {readyState === "ready" ? <CheckCircle2 size={26} /> : <AlertTriangle size={26} />}
          <div>
            <p className="signature">Let's check your studio</p>
            <h2>{readyState === "ready" ? "Your studio is ready" : "Let's check your gear"}</h2>
            <p className="soft-copy">Pick sources, check the mic, then go straight to Record.</p>
          </div>
        </div>
        <div className="wizard-actions">
          <Button variant="secondary" onClick={onRefresh}>Check again</Button>
          {(detection.cameras.length === 0 || detection.cameraAccessStatus === "denied" || detection.cameraAccessStatus === "restricted") && onOpenCameraPrivacySettings ? (
            <Button variant="secondary" icon={<Settings size={18} />} onClick={onOpenCameraPrivacySettings}>Windows camera settings</Button>
          ) : null}
          {detection.permissionNeeded && (
            <Button variant="primary" onClick={onRequestPermission}>Let the studio look and listen</Button>
          )}
        </div>
      </div>

      {detection.errorMessage ? (
        <FriendlyState title="Camera and microphone check" message={detection.errorMessage} />
      ) : null}

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

      <details className="setup-guide-card">
        <summary>Setup checklist <strong>{readyItemCount} of {setupItems.length}</strong></summary>
        <div aria-label="Studio Setup guide">
          {setupItems.map((item) => (
            <span className={item.ready ? "ready" : ""} key={item.label}>
              {item.ready ? <CheckCircle2 size={16} /> : <CircleMarker />}
              {item.label}
            </span>
          ))}
        </div>
      </details>

      {currentStep === 0 && (
        <div className="wizard-panel">
          <WizardHeading title="Let's pick your cameras" message="Choose up to three cameras. Keep it simple here; the little gear has the extra knobs if you need them." />
          {detection.cameras.length === 0 ? (
            <FriendlyState title={getEmptyStateMessage("camera")} message="Plug in a camera, close other camera apps, then choose Find Cameras." />
          ) : (
            <div className="camera-card-grid">
              {cameraSlots.slice(0, visibleCameraCount).map((slot) => (
                <CameraSetupCard
                  key={slot.key}
                  label={slot.label}
                  selectedDeviceId={defaults.cameras[slot.key]}
                  devices={detection.cameras}
                  disabledDeviceIds={cameraSlots
                    .filter((candidate) => candidate.key !== slot.key)
                    .map((candidate) => defaults.cameras[candidate.key])
                    .filter((deviceId): deviceId is string => Boolean(deviceId))}
                  onChoose={(deviceId) => onDefaultsChange(saveCameraSlot(defaults, slot.key, deviceId))}
                  onRefresh={onRefresh}
                  onOpenCameraPreview={onOpenCameraPreview}
                  onReleaseCameraPreview={onReleaseCameraPreview}
                />
              ))}
            </div>
          )}
          {visibleCameraCount < cameraSlots.length ? (
            <Button variant="secondary" icon={<Camera size={18} />} onClick={() => setVisibleCameraCount((count) => Math.min(cameraSlots.length, count + 1))}>
              Add another camera (optional)
            </Button>
          ) : null}
          <div className={`camera-capacity-strip ${cameraCapacity.available >= 1 ? "ready" : "needs-attention"}`}>
            {cameraCapacity.available >= 1 ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
            <div>
              <strong>{cameraCapacity.available} camera feed{cameraCapacity.available === 1 ? "" : "s"} detected</strong>
              <span>{cameraCapacity.message}</span>
            </div>
          </div>
          {assignmentConflicts.some((conflict) => conflict.kind === "camera") ? (
            <div className="camera-find-strip needs-attention">
              <AlertTriangle size={18} />
              <span>One camera feed was assigned twice. Pick a different Windows camera for each slot.</span>
            </div>
          ) : null}
          <div className="camera-find-strip">
            <CheckCircle2 size={18} />
            <span>Each distinct Windows camera can be assigned to any camera slot.</span>
          </div>
          <div className="camera-find-strip">
            <Button variant="secondary" icon={<Search size={20} />} onClick={onRefresh}>Find Cameras</Button>
            <span>Everything stays local while the studio looks for what is connected.</span>
          </div>
        </div>
      )}

      {currentStep === 1 && (
        <div className="wizard-panel">
          <WizardHeading title="Pick your microphones" message="Choose who each mic belongs to, then say something and watch the meter move." />
          <div className={`audio-interface-strip ${detection.microphones.some((device) => device.audio?.interfaceLike) ? "ready" : "needs-attention"}`}>
            {detection.microphones.some((device) => device.audio?.interfaceLike) ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
            <div>
              <strong>Audio interface</strong>
              <span>{detection.microphones.find((device) => device.audio?.interfaceLike)?.label ?? "No USB audio interface detected"}</span>
            </div>
            <b>{detection.microphones.some((device) => device.audio?.interfaceLike) ? "Connected" : "Check USB cable"}</b>
          </div>
          {detection.microphones.length === 0 ? (
            <FriendlyState title={getEmptyStateMessage("microphone")} message="Plug in a mic, make sure it is on, then check again." />
          ) : (
            <div className="device-slot-grid">
              {microphoneSlots.filter((slot) => slot.key !== "extraMic" || showExtraMicrophone).map((slot) => (
                <DeviceSlot key={slot.key} label={slot.label}>
                  <label className="device-select input-name-control">
                    Name
                    <input
                      aria-label={`${slot.label} name`}
                      value={defaults.microphoneNames?.[slot.key] ?? (slot.key === "morganMic" ? "Morgan" : slot.key === "guestMic" ? "Guest" : "Extra")}
                      onChange={(event) => onDefaultsChange({ ...defaults, microphoneNames: { ...defaults.microphoneNames, [slot.key]: event.target.value } })}
                    />
                  </label>
                  <DeviceSelect
                    label={`Assign ${slot.label}`}
                    value={defaults.microphones[slot.key] ?? ""}
                    devices={detection.microphones}
                    emptyLabel="No mic picked yet"
                    onChange={(deviceId) => assignMicrophone(slot.key, deviceId)}
                  />
                  <InputChannelSelect
                    label={`${slot.label} interface input`}
                    value={defaults.microphoneChannels?.[slot.key] ?? "mix"}
                    ownerName={defaults.microphoneNames?.[slot.key] ?? slot.label}
                    onChange={(channel) => assignInputChannel(slot.key, channel)}
                  />
                  <SetupMicFeedback
                    deviceId={defaults.microphones[slot.key]}
                    inputChannel={defaults.microphoneChannels?.[slot.key] ?? "mix"}
                    onOpenMicrophoneStream={onOpenMicrophoneStream}
                    onReleaseMicrophoneStream={onReleaseMicrophoneStream}
                    fallbackLevel={slot.key === "morganMic" ? microphoneLevel : 0}
                  />
                </DeviceSlot>
              ))}
              {!showExtraMicrophone ? (
                <button className="optional-device-slot" type="button" onClick={() => setShowExtraMicrophone(true)}>
                  <Mic2 size={20} />
                  <strong>Add an optional third mic</strong>
                  <span>Only if this episode needs one.</span>
                </button>
              ) : null}
              <div className="device-test-card">
                <Button variant="primary" icon={<Mic2 size={20} />} onClick={onTestMicrophone}>Say something!</Button>
                <AudioMeter label="Mic check" level={microphoneLevel} />
                <p>Speak into each microphone. Each selected interface channel has its own live meter above.</p>
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

      <footer className="setup-next-action">
        <span>{readyState === "ready" ? "Camera 1 and Morgan Mic are ready." : "Pick Camera 1 and Morgan Mic to continue."}</span>
        <Button variant="primary" icon={<ArrowRight size={20} />} onClick={onGoRecord}>Go to Record</Button>
      </footer>
    </section>
  );
}

function CircleMarker() {
  return <span className="setup-step-dot" aria-hidden="true" />;
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
  disabledDeviceIds,
  onChoose,
  onRefresh,
  onOpenCameraPreview,
  onReleaseCameraPreview
}: {
  label: string;
  selectedDeviceId?: string;
  devices: StudioDevice[];
  disabledDeviceIds: string[];
  onChoose: (deviceId: string) => void;
  onRefresh: () => void;
  onOpenCameraPreview: (deviceId?: string) => Promise<MediaStream>;
  onReleaseCameraPreview?: (deviceId?: string, stream?: MediaStream) => void;
}) {
  const selectedDevice = devices.find((device) => device.id === selectedDeviceId);
  const firstDevice = devices.find((device) => !disabledDeviceIds.includes(device.id));
  const [previewStatus, setPreviewStatus] = useState<"idle" | "starting" | "live" | "ready" | "needs-attention" | "busy" | "permission">("idle");
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const status = getCameraCardStatus(selectedDevice, devices.length, previewStatus);
  const buttonLabel = selectedDevice ? "Test Camera" : firstDevice ? "Use This Camera" : "Choose Camera";

  useEffect(() => {
    let canceled = false;
    let reconnectTimer: number | undefined;

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
          if (onReleaseCameraPreview) onReleaseCameraPreview(selectedDeviceId, stream);
          else stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        stream.getVideoTracks().forEach((track) => {
          track.addEventListener("ended", () => {
            if (canceled) return;
            setPreviewStatus("starting");
            reconnectTimer = window.setTimeout(() => setPreviewAttempt((attempt) => attempt + 1), 1200);
          }, { once: true });
        });
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
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      releaseCamera();
    };
  }, [onOpenCameraPreview, onReleaseCameraPreview, previewAttempt, selectedDeviceId]);

  function releaseCamera() {
    if (streamRef.current) {
      if (onReleaseCameraPreview) onReleaseCameraPreview(selectedDeviceId, streamRef.current);
      else streamRef.current.getTracks().forEach((track) => track.stop());
    }
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
        disabledDeviceIds={disabledDeviceIds}
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
          message={/sony|imaging edge/i.test(selectedDevice?.label ?? "")
            ? "Sony: choose Movie and USB Streaming on the camera before connecting it. Use a data-capable cable directly to the computer (not a hub), turn USB Power Supply on, then watch for Live here."
            : "Close other camera apps, pick the camera again, then watch for Live in this card."}
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
  inputChannel,
  fallbackLevel,
  onOpenMicrophoneStream,
  onReleaseMicrophoneStream
}: {
  deviceId?: string;
  inputChannel: MicrophoneInputChannel;
  fallbackLevel: number;
  onOpenMicrophoneStream: (deviceId?: string) => Promise<MediaStream>;
  onReleaseMicrophoneStream?: (deviceId?: string, stream?: MediaStream) => void;
}) {
  const [level, setLevel] = useState(fallbackLevel);
  const [peak, setPeak] = useState(0);
  const [inputStatus, setInputStatus] = useState("Checking input...");

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
        if (canceled) {
          if (onReleaseMicrophoneStream) onReleaseMicrophoneStream(deviceId, stream);
          else stopStudioMediaStream(stream);
          stream = undefined;
          return;
        }
        const diagnostics = getAudioStreamDiagnostics(stream);
        audioContext = createStudioAudioContext();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        const samples = new Uint8Array(analyser.frequencyBinCount);
        const routed = connectInputChannelSource(audioContext, source, inputChannel, diagnostics.channelCount);
        routed.output.connect(analyser);
        setInputStatus(`${diagnostics.channelCount ?? "Unknown"} channel${diagnostics.channelCount === 1 ? "" : "s"} / ${diagnostics.sampleRate ?? "unknown"} Hz`);

        const tick = () => {
          if (canceled) return;
          analyser.getByteTimeDomainData(samples);
          const measured = calculateAudioLevel(samples);
          setLevel(measured.rms);
          setPeak(measured.peak);
          frame = window.requestAnimationFrame(tick);
        };

        tick();
      } catch (error) {
        setLevel(0);
        setPeak(0);
        const message = String(error);
        setInputStatus(message.includes("input channel") ? message.replace(/^Error:\s*/, "") : "Could not open this input");
      }
    }

    void startMeter();

    return () => {
      canceled = true;
      if (frame) window.cancelAnimationFrame(frame);
      if (stream && onReleaseMicrophoneStream) onReleaseMicrophoneStream(deviceId, stream);
      else stopStudioMediaStream(stream);
      void audioContext?.close();
    };
  }, [deviceId, fallbackLevel, inputChannel, onOpenMicrophoneStream, onReleaseMicrophoneStream]);

  const copy = peak >= 98 ? "CLIPPING" : level > 7 ? "ACTIVE" : level > 0 ? "CONNECTED / QUIET" : "NO SIGNAL";

  return (
    <div className={`setup-mic-feedback ${level > 12 ? "heard" : level > 0 ? "quiet" : "muted"}`} aria-live="polite">
      <AudioMeter label="Live mic level" level={level} />
      <p>{copy}</p>
      <small>{inputStatus} / Peak {peak}%</small>
    </div>
  );
}

function InputChannelSelect({
  label,
  value,
  ownerName,
  onChange
}: {
  label: string;
  value: MicrophoneInputChannel;
  ownerName: string;
  onChange: (channel: MicrophoneInputChannel) => void;
}) {
  const display = getMicrophoneInputDisplay(value);
  return (
    <label className="device-select input-channel-select" title="Choose the physical jack on a multichannel interface when its Windows driver exposes that channel to the app.">
      Physical interface jack
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as MicrophoneInputChannel)}>
        {microphoneInputChannelOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
      <span className={`physical-input-assignment ${value === "mix" ? "automatic" : "routed"}`}>
        <strong>{display.short}</strong>
        <b>{value === "mix" ? "Use for a laptop or one-mic device" : `Feeds ${ownerName || "this track"}`}</b>
      </span>
      <small>On the M-Track Duo, front jack 1 is Left and front jack 2 is Right.</small>
    </label>
  );
}

function DeviceSelect({
  label,
  value,
  devices,
  disabledDeviceIds = [],
  emptyLabel,
  onChange
}: {
  label: string;
  value: string;
  devices: { id: string; label: string }[];
  disabledDeviceIds?: string[];
  emptyLabel: string;
  onChange: (deviceId: string) => void;
}) {
  return (
    <label className="device-select">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{emptyLabel}</option>
        {devices.map((device) => (
          <option value={device.id} key={device.id} disabled={disabledDeviceIds.includes(device.id) && device.id !== value}>
            {device.label}{disabledDeviceIds.includes(device.id) && device.id !== value ? " (in use)" : ""}
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
  if (status === "busy") return "Camera is being used by another app";
  if (status === "permission") return "We need permission";
  if (status === "needs-attention") return "Needs Attention";
  if (status === "ready") return "Released";
  return "Pick a camera";
}

function getCameraCardSubcopy(device: StudioDevice | undefined, previewStatus: "idle" | "starting" | "live" | "ready" | "needs-attention" | "busy" | "permission", label: string) {
  if (!device) return "Pick a camera first";
  if (previewStatus === "live") return `${label} is showing live`;
  if (previewStatus === "busy") return "Camera is being used by another app. Close the other app, then refresh.";
  if (previewStatus === "permission") return "We need permission before this camera can go live.";
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

function getCameraCapacity(devices: StudioDevice[]) {
  const available = new Set(devices.map((device) => device.id).filter(Boolean)).size;
  const imagingEdgeFeeds = devices.filter((device) => /imaging edge/i.test(device.label)).length;
  if (imagingEdgeFeeds >= 3) {
    return { available, message: `${imagingEdgeFeeds} distinct Imaging Edge feeds are available. Camera 1, 2, and 3 will record to separate synchronized tracks.` };
  }
  if (available >= 3) {
    return { available, message: "Pick any three. Each feed will preview and record as its own synchronized camera track." };
  }
  if (imagingEdgeFeeds === 1) {
    return {
      available,
      message: "Your Imaging Edge feed is ready. Add another camera only when you want another angle; it must appear as its own Windows camera."
    };
  }
  return {
    available,
    message: available > 0
      ? "This is enough to record. Add another camera only when you want another angle."
      : "Connect Camera 1 by USB Streaming or HDMI capture, then choose Refresh Cameras."
  };
}

function getReadinessCopy(state: ReturnType<typeof getDeviceReadiness>) {
  if (state === "needs-permission") return "We need permission before the app can see your camera and microphone names.";
  if (state === "needs-camera") return "Pick at least Camera 1 so the studio knows what to use first.";
  if (state === "needs-microphone") return "Pick Morgan Mic so the studio knows where Morgan's voice comes from.";
  if (state === "needs-routing") return "One source is assigned twice. Give each camera and interface input its own track.";
  return "Your device choices are saved locally and ready for recording.";
}
