import { useCallback, useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  Circle,
  Download,
  FileText,
  Gauge,
  Headphones,
  Mic2,
  Pause,
  Play,
  Radio,
  Save,
  Settings,
  Sparkles,
  Square,
  Volume2
} from "lucide-react";
import type { DeviceDefaults } from "../../shared/types";
import type { RecordingSession } from "../../shared/recording";
import type { CameraLayout, PodcastToolsState, SoundSlot } from "../../shared/podcast-tools";
import { cameraLayouts, createLiveMarker, markerButtons } from "../../shared/podcast-tools";
import type { DeviceDetectionResult, StudioDevice } from "../plugins/devices/types";
import type { RecordingServiceSnapshot } from "../services";
import { formatRecordingTime } from "../services";
import { Button } from ".";

interface RecordingStudioProps {
  defaults: DeviceDefaults;
  detection: DeviceDetectionResult;
  snapshot: RecordingServiceSnapshot;
  unfinishedSessions: RecordingSession[];
  podcastTools: PodcastToolsState;
  storageWarning?: string;
  onStart: () => Promise<void> | void;
  onPause: () => Promise<void> | void;
  onResume: () => Promise<void> | void;
  onStop: () => Promise<void> | void;
  onAutoEdit: () => void;
  onExport: () => void;
  onDismissRecovery: () => void;
  onNext: () => void;
  onDefaultsChange: (defaults: DeviceDefaults) => void;
  onPodcastToolsChange: (state: PodcastToolsState) => void;
  onPlayTestSound: () => Promise<void> | void;
  onOpenCameraPreview: (deviceId?: string) => Promise<MediaStream>;
  onOpenMicrophoneStream: (deviceId?: string) => Promise<MediaStream>;
}

type CameraKey = keyof DeviceDefaults["cameras"];
type MicKey = keyof DeviceDefaults["microphones"];
type StudioNoticeTone = "ready" | "needs-attention" | "recording";

const cameraSlots: Array<{ key: CameraKey; label: string }> = [
  { key: "camera1", label: "Camera 1" },
  { key: "camera2", label: "Camera 2" },
  { key: "camera3", label: "Camera 3" }
];

const micSlots: Array<{ key: MicKey | "soundboard" | "music"; label: string }> = [
  { key: "morganMic", label: "Morgan Mic" },
  { key: "guestMic", label: "Guest Mic" },
  { key: "extraMic", label: "Headset Mic" },
  { key: "soundboard", label: "Soundboard" },
  { key: "music", label: "Music" }
];

export function RecordingStudio({
  defaults,
  detection,
  snapshot,
  unfinishedSessions,
  podcastTools,
  storageWarning,
  onStart,
  onPause,
  onResume,
  onStop,
  onAutoEdit,
  onExport,
  onDismissRecovery,
  onNext,
  onDefaultsChange,
  onPodcastToolsChange,
  onPlayTestSound,
  onOpenCameraPreview,
  onOpenMicrophoneStream
}: RecordingStudioProps) {
  const [monitorOn, setMonitorOn] = useState(false);
  const [studioNotice, setStudioNotice] = useState<{ tone: StudioNoticeTone; message: string }>({
    tone: "ready",
    message: "Use headphones so the mic doesn't echo."
  });
  const [playingSlotId, setPlayingSlotId] = useState<string | undefined>();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const warnAboutEcho = useCallback(() => {
    setStudioNotice({ tone: "needs-attention", message: "Use headphones so the mic doesn't echo." });
  }, []);

  const isRecording = snapshot.status === "recording";
  const isPaused = snapshot.status === "paused";
  const isComplete = snapshot.status === "stopped";
  const hasMedia = Boolean(isComplete || snapshot.session);
  const savingLocation = snapshot.session?.folderPath ?? "Session folder appears after Record starts";

  function patchTools(nextState: PodcastToolsState) {
    onPodcastToolsChange({ ...nextState, updatedAt: new Date().toISOString() });
  }

  function selectLayout(layout: CameraLayout) {
    patchTools({
      ...podcastTools,
      cameraLayout: layout,
      practiceMode: { ...podcastTools.practiceMode, layoutTried: true }
    });
  }

  function mark(label: string) {
    const marker = createLiveMarker({
      label,
      timestampMs: snapshot.elapsedMs,
      recordingSessionId: snapshot.session?.id
    });
    patchTools({
      ...podcastTools,
      markers: [marker, ...podcastTools.markers],
      practiceMode: { ...podcastTools.practiceMode, markerTried: true }
    });
  }

  async function playTestSound() {
    await onPlayTestSound();
    setStudioNotice({ tone: "ready", message: "Test sound played. Pick headphones if you didn't hear it." });
  }

  async function toggleSound(slot: SoundSlot) {
    audioRef.current?.pause();
    audioRef.current = null;

    if (playingSlotId === slot.id) {
      setPlayingSlotId(undefined);
      return;
    }

    if (!slot.filePath) {
      setStudioNotice({ tone: "needs-attention", message: "Add a sound first." });
      setPlayingSlotId(undefined);
      return;
    }

    try {
      const audio = new Audio(slot.filePath);
      audio.volume = Math.max(0, Math.min(1, podcastTools.soundboard.masterVolume / 100));
      audio.onended = () => setPlayingSlotId(undefined);
      audioRef.current = audio;
      setPlayingSlotId(slot.id);
      await audio.play();
    } catch {
      setStudioNotice({ tone: "needs-attention", message: "That sound needs setup before it can play." });
      setPlayingSlotId(undefined);
    }
  }

  function setOutput(deviceId: string) {
    onDefaultsChange({ ...defaults, audioOutputId: deviceId || undefined });
  }

  function goAutoEdit() {
    if (!hasMedia) {
      setStudioNotice({ tone: "needs-attention", message: "Record something first, then Auto Edit can help." });
      return;
    }
    onAutoEdit();
  }

  function goExport() {
    if (!hasMedia) {
      setStudioNotice({ tone: "needs-attention", message: "Record something first, then Export will be ready." });
      return;
    }
    onExport();
  }

  return (
    <section className="live-studio" aria-label="Live recording studio">
      {unfinishedSessions.length > 0 && (
        <RippedPaperCard className="recovery-banner">
          <AlertTriangle size={28} />
          <div>
            <h3>We found an unfinished recording</h3>
            <p>Your raw files stay right where they are. Open the session folder before recording again.</p>
          </div>
          <RusticButton onClick={onDismissRecovery}>Got it</RusticButton>
        </RippedPaperCard>
      )}

      <aside className="live-studio-rail">
        <div className="live-logo-card">
          <span>What About It?</span>
          <strong>Studio</strong>
        </div>
        <StudioStatusBadge snapshot={snapshot} />
        <div className="live-rail-meter">
          <Gauge size={20} />
          <span>{podcastTools.cameraLayout}</span>
        </div>
      </aside>

      <main className="live-studio-board">
        <TornEdgeHeader
          title="Live Recording Studio"
          eyebrow={isRecording ? "Recording Live" : isPaused ? "Paused" : isComplete ? "Recording Complete" : "Control Room"}
          aside={
            <div className="recording-timer" aria-label="Recording timer">
              <span>{snapshot.status}</span>
              <strong>{formatRecordingTime(snapshot.elapsedMs)}</strong>
            </div>
          }
        />

        {(snapshot.friendlyError || storageWarning || studioNotice.message) && (
          <div className={`studio-notice ${snapshot.friendlyError ? "needs-attention" : studioNotice.tone}`}>
            <strong>{snapshot.friendlyError ? "Something needs a quick check" : studioNotice.message}</strong>
            <span>{snapshot.friendlyError ?? storageWarning ?? "Live checks are ready when your gear is."}</span>
          </div>
        )}

        <section className="camera-strip" aria-label="Camera previews">
          {cameraSlots.map((slot) => (
            <CameraCard
              key={slot.key}
              label={slot.label}
              device={findDevice(detection.cameras, defaults.cameras[slot.key])}
              deviceId={defaults.cameras[slot.key]}
              onOpenCameraPreview={onOpenCameraPreview}
            />
          ))}
        </section>

        <section className="layout-row" aria-label="Camera layouts">
          {cameraLayouts.map((layout) => (
            <RusticButton
              className={podcastTools.cameraLayout === layout.id ? "selected" : ""}
              key={layout.id}
              onClick={() => selectLayout(layout.id)}
            >
              {layout.label}
            </RusticButton>
          ))}
          <RusticButton onClick={() => selectLayout("sponsor-card")}>Topic Card</RusticButton>
          <RusticButton onClick={() => setStudioNotice({ tone: "needs-attention", message: "Advanced camera settings are ready after device setup." })}>
            <Settings size={16} /> Gear
          </RusticButton>
        </section>

        <section className="live-studio-grid">
          <VintagePanel title="Microphone Mixer" icon={<Mic2 size={20} />} className="mixer-panel">
            <div className="monitor-row">
              <RusticButton className={monitorOn ? "selected" : ""} onClick={() => setMonitorOn((current) => !current)}>
                <Headphones size={16} /> {monitorOn ? "Monitor On" : "Monitor Off"}
              </RusticButton>
              <RusticButton onClick={() => void playTestSound()}>
                <Volume2 size={16} /> Play Test Sound
              </RusticButton>
              <label>
                Output
                <select value={defaults.audioOutputId ?? ""} onChange={(event) => setOutput(event.target.value)}>
                  <option value="">System output</option>
                  {detection.speakers.map((speaker) => (
                    <option value={speaker.id} key={speaker.id}>{speaker.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="studio-warning">Use headphones so the mic doesn't echo.</p>
            <div className="meter-list">
              {micSlots.map((slot) => {
                const deviceId = slot.key === "soundboard" || slot.key === "music" ? undefined : defaults.microphones[slot.key];
                const label = slot.key === "soundboard" && playingSlotId ? "We hear you" : slot.key === "music" ? "Add music first" : undefined;
                return (
                  <LiveMicMeter
                    key={slot.key}
                    label={slot.label}
                    deviceId={deviceId}
                    monitoring={monitorOn && slot.key === "morganMic"}
                    outputDeviceId={defaults.audioOutputId}
                    fallbackLevel={slot.key === "soundboard" && playingSlotId ? 72 : 0}
                    fallbackLabel={label}
                    onEchoWarning={warnAboutEcho}
                    onOpenMicrophoneStream={onOpenMicrophoneStream}
                  />
                );
              })}
            </div>
          </VintagePanel>

          <VintagePanel title="Soundboard" icon={<Radio size={20} />} className="soundboard-panel">
            <div className="soundboard-grid live">
              {[podcastTools.soundboard.intro, podcastTools.soundboard.outro, ...podcastTools.soundboard.customSlots].map((slot) => (
                <button className={playingSlotId === slot.id ? "playing" : ""} type="button" onClick={() => void toggleSound(slot)} key={slot.id}>
                  <strong>{slot.label}</strong>
                  <span>{slot.filePath ? "Local file ready" : "Add a sound first"}</span>
                  <small>{playingSlotId === slot.id ? "Stop" : "Play"}</small>
                </button>
              ))}
            </div>
            <label>
              Volume
              <input
                type="range"
                min="0"
                max="100"
                value={podcastTools.soundboard.masterVolume}
                onChange={(event) =>
                  patchTools({
                    ...podcastTools,
                    soundboard: { ...podcastTools.soundboard, masterVolume: Number(event.target.value) },
                    practiceMode: { ...podcastTools.practiceMode, soundboardTried: true }
                  })
                }
              />
            </label>
          </VintagePanel>

          <VintagePanel title="Markers" icon={<Sparkles size={20} />} className="markers-panel">
            <div className="marker-button-grid live">
              {markerButtons.map((marker) => (
                <RusticButton onClick={() => mark(marker.label)} key={marker.label}>{marker.label}</RusticButton>
              ))}
            </div>
            <div className="marker-list live">
              {podcastTools.markers.length === 0 ? (
                <p>No moments marked yet.</p>
              ) : (
                podcastTools.markers.slice(0, 6).map((marker) => (
                  <span key={marker.id}>{marker.label} at {formatRecordingTime(marker.timestampMs)}</span>
                ))
              )}
            </div>
          </VintagePanel>

          <VintagePanel title="Episode Notes" icon={<FileText size={20} />} className="notes-panel">
            <NoteBox
              label="Episode notes"
              value={podcastTools.guestNotes.talkingPoints}
              onChange={(value) => patchTools({ ...podcastTools, guestNotes: { ...podcastTools.guestNotes, talkingPoints: value } })}
            />
          </VintagePanel>

          <VintagePanel title="Guest Notes" icon={<FileText size={20} />} className="guest-panel">
            <NoteBox
              label="Guest notes"
              value={podcastTools.guestNotes.questions}
              onChange={(value) =>
                patchTools({
                  ...podcastTools,
                  guestNotes: { ...podcastTools.guestNotes, questions: value },
                  practiceMode: { ...podcastTools.practiceMode, notesTried: true }
                })
              }
            />
          </VintagePanel>

          <VintagePanel title="Teleprompter" icon={<FileText size={20} />} className="teleprompter-panel">
            <textarea
              aria-label="Teleprompter"
              value={podcastTools.teleprompter.script}
              onChange={(event) =>
                patchTools({
                  ...podcastTools,
                  teleprompter: { ...podcastTools.teleprompter, script: event.target.value },
                  practiceMode: { ...podcastTools.practiceMode, teleprompterTried: true }
                })
              }
              placeholder="Drop Morgan's script here."
            />
          </VintagePanel>
        </section>

        <section className="giant-control-row" aria-label="Recording controls">
          <StudioControlButton tone="record" disabled={isRecording || isPaused} onClick={() => void onStart()}>
            <Circle size={28} /> Record
          </StudioControlButton>
          <StudioControlButton disabled={!isRecording} onClick={() => void onPause()}>
            <Pause size={28} /> Pause
          </StudioControlButton>
          <StudioControlButton disabled={!isRecording && !isPaused} onClick={() => void onStop()}>
            <Square size={28} /> Stop
          </StudioControlButton>
          <StudioControlButton disabled={!isPaused} onClick={() => void onResume()}>
            <Play size={28} /> Resume
          </StudioControlButton>
          <StudioControlButton onClick={goAutoEdit}>
            <Sparkles size={28} /> Auto Edit
          </StudioControlButton>
          <StudioControlButton onClick={goExport}>
            <Download size={28} /> Export
          </StudioControlButton>
        </section>

        <div className="local-save-note live">
          <Save size={20} />
          <span>{isRecording ? "Everything is saving safely" : snapshot.localSaveMessage}. Saving location: {savingLocation}</span>
        </div>

        {isComplete && (
          <RippedPaperCard className="recording-complete-card">
            <CheckCircle2 size={34} />
            <div>
              <h3>Nice work!</h3>
              <p>Your episode is safely stored. Next step: review your markers and timeline.</p>
            </div>
            <Button variant="primary" icon={<ArrowRight size={20} />} onClick={onNext}>Review Episode</Button>
          </RippedPaperCard>
        )}
      </main>
    </section>
  );
}

function findDevice(devices: StudioDevice[], deviceId?: string) {
  return devices.find((device) => device.id === deviceId);
}

function CameraCard({
  label,
  device,
  deviceId,
  onOpenCameraPreview
}: {
  label: string;
  device?: StudioDevice;
  deviceId?: string;
  onOpenCameraPreview: (deviceId?: string) => Promise<MediaStream>;
}) {
  const [previewState, setPreviewState] = useState<"starting" | "live" | "needs-attention">("starting");
  const status = previewState === "live" ? "Live" : device ? "Ready" : deviceId ? "Needs Attention" : "Not Connected";
  const cardState = previewState === "live" ? "live" : device || deviceId ? "needs-attention" : "not-connected";
  const detail = device?.camera ? `${device.camera.maxResolution ?? "Auto"} / ${device.camera.maxFps ?? 30} fps` : "Pick this camera in Studio Setup";

  return (
    <RippedPaperCard className={`camera-live-card ${cardState}`}>
      <div className="camera-live-top">
        <div>
          <h3>{label}</h3>
          <span>{status}</span>
        </div>
        <button type="button" aria-label={`${label} advanced settings`} title="Advanced settings">
          <Settings size={18} />
        </button>
      </div>
      <CameraFeed label={label} deviceId={deviceId} onOpenCameraPreview={onOpenCameraPreview} onPreviewState={setPreviewState} />
      <p>{device?.label ?? "Camera needs attention"}</p>
      <small>{detail}</small>
    </RippedPaperCard>
  );
}

function CameraFeed({
  label,
  deviceId,
  onOpenCameraPreview,
  onPreviewState
}: {
  label: string;
  deviceId?: string;
  onOpenCameraPreview: (deviceId?: string) => Promise<MediaStream>;
  onPreviewState: (state: "starting" | "live" | "needs-attention") => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<"starting" | "live" | "needs-attention">("starting");

  useEffect(() => {
    let stream: MediaStream | undefined;
    let canceled = false;

    async function startPreview() {
      if (!deviceId) {
        setState("needs-attention");
        onPreviewState("needs-attention");
        return;
      }

      try {
        setState("starting");
        onPreviewState("starting");
        stream = await onOpenCameraPreview(deviceId);
        if (canceled) return;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setState("live");
        onPreviewState("live");
      } catch {
        setState("needs-attention");
        onPreviewState("needs-attention");
      }
    }

    void startPreview();

    return () => {
      canceled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [deviceId, onOpenCameraPreview, onPreviewState]);

  return (
    <div className={`live-video-frame ${state}`}>
      <video ref={videoRef} muted playsInline aria-label={`${label} live preview`} />
      {state !== "live" && (
        <div>
          <Camera size={26} />
          <strong>{state === "starting" ? "Starting preview" : "Needs Attention"}</strong>
        </div>
      )}
    </div>
  );
}

function LiveMicMeter({
  label,
  deviceId,
  monitoring,
  outputDeviceId,
  fallbackLevel,
  fallbackLabel,
  onEchoWarning,
  onOpenMicrophoneStream
}: {
  label: string;
  deviceId?: string;
  monitoring: boolean;
  outputDeviceId?: string;
  fallbackLevel?: number;
  fallbackLabel?: string;
  onEchoWarning: () => void;
  onOpenMicrophoneStream: (deviceId?: string) => Promise<MediaStream>;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [level, setLevel] = useState(fallbackLevel ?? 0);
  const [heard, setHeard] = useState(false);

  useEffect(() => {
    if (!deviceId || !window.AudioContext) {
      setLevel(fallbackLevel ?? 0);
      setHeard(Boolean(fallbackLevel));
      return undefined;
    }

    let audioContext: AudioContext | undefined;
    let stream: MediaStream | undefined;
    let frame = 0;
    let canceled = false;

    async function startMeter() {
      try {
        stream = await onOpenMicrophoneStream(deviceId);
        audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        const samples = new Uint8Array(analyser.frequencyBinCount);
        source.connect(analyser);

        if (monitoring && audioRef.current) {
          audioRef.current.srcObject = stream;
          const sinkableAudio = audioRef.current as HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> };
          if (outputDeviceId && sinkableAudio.setSinkId) await sinkableAudio.setSinkId(outputDeviceId);
          onEchoWarning();
          await audioRef.current.play();
        }

        const tick = () => {
          if (canceled) return;
          analyser.getByteTimeDomainData(samples);
          const volume = samples.reduce((total, sample) => total + Math.abs(sample - 128), 0) / Math.max(samples.length, 1);
          const nextLevel = Math.min(100, Math.round(volume * 4));
          setLevel(nextLevel);
          setHeard(nextLevel > 8);
          frame = window.requestAnimationFrame(tick);
        };

        tick();
      } catch {
        setLevel(0);
        setHeard(false);
      }
    }

    void startMeter();

    return () => {
      canceled = true;
      if (frame) window.cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      void audioContext?.close();
    };
  }, [deviceId, fallbackLevel, monitoring, onEchoWarning, onOpenMicrophoneStream, outputDeviceId]);

  const copy = fallbackLabel ?? (heard ? "We hear you" : "We can't hear you yet");

  return (
    <article className={`live-meter-card ${heard ? "heard" : "quiet"}`}>
      <div>
        <strong>{label}</strong>
        <span>{copy}</span>
      </div>
      <DistressedMeter level={level} label={label} />
      <audio ref={audioRef} muted={!monitoring} />
    </article>
  );
}

function NoteBox({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function StudioStatusBadge({ snapshot }: { snapshot: RecordingServiceSnapshot }) {
  const label = snapshot.status === "recording" ? "Recording Live" : snapshot.status === "paused" ? "Paused" : "Standby";
  return (
    <div className={`studio-status-badge ${snapshot.status}`}>
      <span>{label}</span>
      <strong>{formatRecordingTime(snapshot.elapsedMs)}</strong>
    </div>
  );
}

function RippedPaperCard({ className = "", children }: { className?: string; children: ReactNode }) {
  return <article className={`ripped-paper-card ${className}`.trim()}>{children}</article>;
}

function RusticButton({ className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`rustic-button ${className}`.trim()} type="button" {...props}>{children}</button>;
}

function VintagePanel({ title, icon, className = "", children }: { title: string; icon: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`vintage-panel ${className}`.trim()}>
      <div className="vintage-panel-heading">
        <h3>{title}</h3>
        {icon}
      </div>
      {children}
    </section>
  );
}

function TornEdgeHeader({ title, eyebrow, aside }: { title: string; eyebrow: string; aside: ReactNode }) {
  return (
    <header className="torn-edge-header">
      <div>
        <p className="signature">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {aside}
    </header>
  );
}

function DistressedMeter({ level, label }: { level: number; label: string }) {
  const safeLevel = Math.max(0, Math.min(100, level));
  return (
    <div className="distressed-meter" aria-label={`${label} audio level ${safeLevel}%`}>
      <i style={{ inlineSize: `${safeLevel}%` }} />
    </div>
  );
}

function StudioControlButton({ tone, className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "record" }) {
  return (
    <button className={`studio-control-button ${tone ?? ""} ${className}`.trim()} type="button" {...props}>
      {children}
    </button>
  );
}
