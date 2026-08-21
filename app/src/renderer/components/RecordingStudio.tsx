import { useCallback, useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Battery,
  Camera,
  CheckCircle2,
  Circle,
  Cable,
  Download,
  FileText,
  Headphones,
  LayoutGrid,
  LoaderCircle,
  Mic2,
  Pause,
  Play,
  Plus,
  Radio,
  Save,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Square,
  Type,
  User,
  VolumeX,
  Volume2
} from "lucide-react";
import type { CameraSlotKey, DeviceDefaults, MicrophoneInputChannel, MicrophoneSlotKey, RecordingPreferences } from "../../shared/types";
import { defaultRecordingPreferences } from "../../shared/types";
import { getDeviceAssignmentConflicts, getMicrophoneInputDisplay, microphoneInputChannelOptions, saveMicrophoneDeviceRoute } from "../../shared/device-config";
import type { RecordingSession, RecordingTrackSaveResult, RecordingTrackSlot } from "../../shared/recording";
import type { CameraLayout, PodcastToolsState, SoundSlot } from "../../shared/podcast-tools";
import { cameraLayouts, createLiveMarker, markerButtons } from "../../shared/podcast-tools";
import type { StudioDisplayInfo, StudioPanelId } from "../../shared/studio-workspace";
import {
  calculateAudioLevel,
  connectInputChannelSource,
  createStudioAudioContext,
  getAudioStreamDiagnostics,
  type AudioStreamDiagnostics
} from "../plugins/audio/studio-audio";
import type { DeviceDetectionResult, StudioDevice } from "../plugins/devices/types";
import type { RecordingServiceSnapshot } from "../services";
import { formatRecordingTime } from "../services";
import { Button, Tooltip } from ".";
import { StudioToolPanels } from "./StudioToolPanels";

interface RecordingStudioProps {
  defaults: DeviceDefaults;
  detection: DeviceDetectionResult;
  snapshot: RecordingServiceSnapshot;
  unfinishedSessions: RecordingSession[];
  podcastTools: PodcastToolsState;
  storageWarning?: string;
  recordingPreferences?: RecordingPreferences;
  onStart: () => Promise<RecordingServiceSnapshot | void> | RecordingServiceSnapshot | void;
  onQuickTest?: () => Promise<void> | void;
  onPause: () => Promise<void> | void;
  onResume: () => Promise<void> | void;
  onStop: () => Promise<void> | void;
  onAutoEdit: () => void;
  onExport: () => void;
  onDismissRecovery: () => void;
  onRecoverSession?: (session: RecordingSession) => Promise<void> | void;
  onOpenSessionFolder?: (session: RecordingSession) => void;
  onNext: () => void;
  onDefaultsChange: (defaults: DeviceDefaults) => void;
  onPodcastToolsChange: (state: PodcastToolsState) => void;
  onPlayTestSound: () => Promise<void> | void;
  onOpenCameraPreview: (deviceId?: string) => Promise<MediaStream>;
  onOpenMicrophoneStream: (deviceId?: string) => Promise<MediaStream>;
  onReleaseCameraPreview: (deviceId?: string, stream?: MediaStream) => void;
  onReleaseMicrophoneStream: (deviceId?: string, stream?: MediaStream) => void;
  displays?: StudioDisplayInfo[];
  poppedOutPanels?: Partial<Record<StudioPanelId, boolean>>;
  onPopOutPanel?: (panelId: StudioPanelId, displayId?: number, fullscreen?: boolean) => void;
  onReturnPanel?: (panelId: StudioPanelId) => void;
}

type CameraKey = CameraSlotKey;
type MicKey = MicrophoneSlotKey;
type StudioNoticeTone = "ready" | "needs-attention" | "recording";
type VoicePreset = "clean" | "warm" | "broadcast";
type MixerChannelControls = { gain: number; muted: boolean; solo: boolean; monitor: boolean; voicePreset: VoicePreset };
type MixerChannelState = Record<string, MixerChannelControls>;
type RecordingAction = "idle" | "starting" | "saving";
type MicSignalState = "checking" | "active" | "quiet" | "no-signal" | "clipping" | "disconnected";
type LiveInputDiagnostics = AudioStreamDiagnostics & { signal: MicSignalState; rms: number; peak: number; trackState?: MediaStreamTrackState };

const defaultMixerChannel: MixerChannelControls = {
  gain: 75,
  muted: false,
  solo: false,
  monitor: false,
  voicePreset: "warm"
};

const cameraSlots: Array<{ key: CameraKey; label: string }> = [
  { key: "camera1", label: "Camera 1" },
  { key: "camera2", label: "Camera 2" },
  { key: "camera3", label: "Camera 3" }
];

const micSlots: Array<{ key: MicKey | "soundboard" | "music"; label: string }> = [
  { key: "morganMic", label: "Morgan Mic" },
  { key: "guestMic", label: "Guest Mic" },
  { key: "extraMic", label: "Extra Mic" },
  { key: "soundboard", label: "Soundboard" },
  { key: "music", label: "Music" }
];

const routableMicSlots: Array<{ key: MicKey; label: string }> = [
  { key: "morganMic", label: "Morgan Mic" },
  { key: "guestMic", label: "Guest Mic" },
  { key: "extraMic", label: "Extra Mic" }
];

const fallbackCameraMicRoutes: Record<CameraKey, MicKey> = {
  camera1: "morganMic",
  camera2: "guestMic",
  camera3: "extraMic"
};

const voicePresets: Record<VoicePreset, { label: string; description: string }> = {
  clean: {
    label: "Clean",
    description: "Natural monitor tone for checking raw input."
  },
  warm: {
    label: "Warm Podcast",
    description: "Low-delay high-pass and light warmth in headphones."
  },
  broadcast: {
    label: "Broadcast",
    description: "Low-delay monitor tone with stronger presence."
  }
};

export function RecordingStudio({
  defaults,
  detection,
  snapshot,
  unfinishedSessions,
  podcastTools,
  storageWarning,
  recordingPreferences: recordingPreferencesProp,
  onStart,
  onQuickTest,
  onPause,
  onResume,
  onStop,
  onAutoEdit,
  onExport,
  onDismissRecovery,
  onRecoverSession,
  onOpenSessionFolder,
  onNext,
  onDefaultsChange,
  onPodcastToolsChange,
  onPlayTestSound,
  onOpenCameraPreview,
  onOpenMicrophoneStream,
  onReleaseCameraPreview,
  onReleaseMicrophoneStream,
  displays,
  poppedOutPanels,
  onPopOutPanel,
  onReturnPanel
}: RecordingStudioProps) {
  const [studioNotice, setStudioNotice] = useState<{ tone: StudioNoticeTone; message: string }>({
    tone: "ready",
    message: "Use headphones to avoid echo."
  });
  const [playingSlotId, setPlayingSlotId] = useState<string | undefined>();
  const [markerNotice, setMarkerNotice] = useState<string | undefined>();
  const [notesSavedAt, setNotesSavedAt] = useState<string>("Saved");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [layoutNotice, setLayoutNotice] = useState(false);
  const [recordingAction, setRecordingAction] = useState<RecordingAction>("idle");
  const [, setMicSignals] = useState<Partial<Record<MicKey, MicSignalState>>>({});
  const [audioDiagnostics, setAudioDiagnostics] = useState<Partial<Record<MicKey, LiveInputDiagnostics>>>({});
  const [recoverySessionId, setRecoverySessionId] = useState<string | undefined>();
  const [mixerChannels, setMixerChannels] = useState<MixerChannelState>(() =>
    Object.fromEntries(micSlots.map((slot) => [slot.key, { ...defaultMixerChannel }]))
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const markerTimerRef = useRef<number | undefined>(undefined);
  const notesTimerRef = useRef<number | undefined>(undefined);
  const autoMarkerAtRef = useRef<Partial<Record<MicKey, number>>>({});
  const warnAboutEcho = useCallback(() => {
    setStudioNotice({ tone: "needs-attention", message: "Use headphones to avoid echo." });
  }, []);

  useEffect(() => {
    return () => {
      if (markerTimerRef.current) window.clearTimeout(markerTimerRef.current);
      if (notesTimerRef.current) window.clearTimeout(notesTimerRef.current);
    };
  }, []);

  const isRecording = snapshot.status === "recording";
  const isPaused = snapshot.status === "paused";
  const isComplete = snapshot.status === "stopped";
  const hasMedia = Boolean(isComplete && snapshot.session);
  const savingLocation = snapshot.session?.folderPath ?? "Session folder appears after Record starts";
  const cameraReadyCount = cameraSlots.filter((slot) => findDevice(detection.cameras, defaults.cameras[slot.key])).length;
  const micReadyCount = ["morganMic", "guestMic", "extraMic"].filter((key) => findDevice(detection.microphones, defaults.microphones[key as MicKey])).length;
  const storageReady = !storageWarning;
  const recordingInProgress = isRecording || isPaused;
  const recordingPreferences = { ...defaultRecordingPreferences, ...recordingPreferencesProp };
  const liveMode = recordingInProgress && recordingPreferences.liveModeEnabled;
  const recordingHealthy = snapshot.status !== "error" && (!recordingInProgress || Boolean(snapshot.health?.programActive));
  const deviceAssignmentsHealthy = getDeviceAssignmentConflicts(defaults).length === 0;
  const studioReady = cameraReadyCount > 0 && storageReady && (!recordingInProgress || recordingHealthy);
  const trackStatusBySlot = Object.fromEntries(snapshot.trackStatuses.map((status) => [status.slot, status]));

  function patchTools(nextState: PodcastToolsState) {
    onPodcastToolsChange({ ...nextState, updatedAt: new Date().toISOString() });
  }

  function patchNotes(nextState: PodcastToolsState) {
    setNotesSavedAt("Saving...");
    patchTools(nextState);
    if (notesTimerRef.current) window.clearTimeout(notesTimerRef.current);
    notesTimerRef.current = window.setTimeout(() => setNotesSavedAt("Saved"), 700);
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
      note: label === "Retake"
        ? "Remove the previous take during review."
        : label === "Clipping"
          ? "Check this microphone for clipping."
          : label === "Source Dropout"
            ? "Check this source for a temporary disconnect."
            : undefined,
      recordingSessionId: snapshot.session?.id
    });
    patchTools({
      ...podcastTools,
      markers: [marker, ...podcastTools.markers],
      practiceMode: { ...podcastTools.practiceMode, markerTried: true }
    });
    setMarkerNotice(`${label} ${label.toLowerCase().includes("sponsor") ? "marker added" : "moment saved"}.`);
    if (markerTimerRef.current) window.clearTimeout(markerTimerRef.current);
    markerTimerRef.current = window.setTimeout(() => setMarkerNotice(undefined), 2400);
  }

  function updateMicSignal(slot: MicKey, signal: MicSignalState) {
    setMicSignals((current) => ({ ...current, [slot]: signal }));
    if (!isRecording || (signal !== "clipping" && signal !== "disconnected")) return;
    const now = Date.now();
    if (now - (autoMarkerAtRef.current[slot] ?? 0) < 15000) return;
    autoMarkerAtRef.current[slot] = now;
    mark(signal === "clipping" ? "Clipping" : "Source Dropout");
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

  function setMicInput(slot: MicKey, deviceId: string) {
    const selectedDevice = findDevice(detection.microphones, deviceId);
    const routed = saveMicrophoneDeviceRoute(defaults, slot, deviceId);
    const next = {
      ...routed,
      microphoneDeviceLabels: { ...routed.microphoneDeviceLabels, [slot]: selectedDevice?.rawLabel ?? selectedDevice?.label }
    };
    onDefaultsChange(next);
    if (deviceId && Object.values(next.microphones).filter((candidate) => candidate === deviceId).length > 1) {
      const deviceLabel = findDevice(detection.microphones, deviceId)?.label ?? "That interface";
      setStudioNotice({ tone: "ready", message: `${deviceLabel} inputs were assigned to separate mixer channels.` });
    }
  }

  function setMicName(slot: MicKey, name: string) {
    onDefaultsChange({
      ...defaults,
      microphoneNames: { ...defaults.microphoneNames, [slot]: name }
    });
  }

  function setMicInputChannel(slot: MicKey, channel: MicrophoneInputChannel) {
    const deviceId = defaults.microphones[slot];
    const owner = findAssignedMicSlot(defaults.microphones, defaults.microphoneChannels, deviceId, channel, slot);
    if (owner) {
      setStudioNotice({
        tone: "needs-attention",
        message: `${getMicSlotLabel(owner)} already uses that interface input. Pick another numbered input so each voice stays separate.`
      });
      return;
    }
    onDefaultsChange({
      ...defaults,
      microphoneChannels: { ...defaults.microphoneChannels, [slot]: channel }
    });
  }

  function setCameraMicRoute(slot: CameraKey, micSlot: MicKey) {
    const currentRoutes = {
      ...fallbackCameraMicRoutes,
      ...defaults.cameraMicrophones
    };
    const owner = findAssignedCameraRoute(defaults.cameraMicrophones, micSlot, slot);
    const nextRoutes = { ...currentRoutes, [slot]: micSlot };

    if (owner) {
      nextRoutes[owner] = currentRoutes[slot] ?? fallbackCameraMicRoutes[slot];
      setStudioNotice({
        tone: "ready",
        message: `${getMicSlotLabel(micSlot)} moved to ${getCameraSlotLabel(slot)}. ${getCameraSlotLabel(owner)} was reassigned so each camera has one mic.`
      });
    }

    onDefaultsChange({
      ...defaults,
      cameraMicrophones: nextRoutes
    });
  }

  function patchMixerChannel(key: string, nextState: Partial<MixerChannelState[string]>) {
    setMixerChannels((current) => ({
      ...current,
      [key]: { ...(current[key] ?? defaultMixerChannel), ...nextState }
    }));
  }

  const soloedChannels = Object.entries(mixerChannels)
    .filter(([, controls]) => controls.solo)
    .map(([key]) => key);
  const outputLabel = findDevice(detection.speakers, defaults.audioOutputId)?.label ?? "System output";

  function goAutoEdit() {
    if (!hasMedia) {
      setStudioNotice({ tone: "needs-attention", message: "Record something first, then Auto Edit can help." });
      return;
    }
    onAutoEdit();
  }

  function goExport() {
    if (isRecording || isPaused) {
      setStudioNotice({ tone: "needs-attention", message: "Stop recording first, then Export will be ready." });
      return;
    }
    if (!hasMedia) {
      setStudioNotice({ tone: "needs-attention", message: "Record something first, then Export will be ready." });
      return;
    }
    onExport();
  }

  async function startStudioRecording() {
    if (!studioReady || recordingAction !== "idle") return;
    setRecordingAction("starting");
    setStudioNotice({ tone: "recording", message: "Starting the Program recording now..." });
    try {
      const nextSnapshot = await onStart();
      if (nextSnapshot && nextSnapshot.status !== "recording") {
        setStudioNotice({ tone: "needs-attention", message: nextSnapshot.friendlyError ?? "Recording did not start. Check the highlighted source and try again." });
        return;
      }
      setStudioNotice({ tone: "recording", message: "Full episode recording is active and writing to disk." });
      if (recordingPreferences.syncCueEnabled) {
        playSyncCue();
        mark("Sync Cue");
      }
    } catch (error) {
      setStudioNotice({ tone: "needs-attention", message: error instanceof Error ? error.message : "Recording did not start. Check the highlighted source and try again." });
    } finally {
      setRecordingAction("idle");
    }
  }

  function playSyncCue() {
    try {
      const context = createStudioAudioContext(defaults.audioOutputId);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.12, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.12);
      oscillator.addEventListener("ended", () => void context.close(), { once: true });
    } catch {
      // A sync cue is optional and must never delay or interrupt recording.
    }
  }

  async function stopStudioRecording() {
    if (recordingAction !== "idle") return;
    setRecordingAction("saving");
    setStudioNotice({ tone: "recording", message: "Saving every recorded source safely..." });
    try {
      await onStop();
      setStudioNotice({ tone: "ready", message: "Recording stopped. Files are saved and verified." });
    } catch (error) {
      setStudioNotice({ tone: "needs-attention", message: error instanceof Error ? error.message : "Recording stopped, but file verification needs attention." });
    } finally {
      setRecordingAction("idle");
    }
  }

  function requestStop() {
    void stopStudioRecording();
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (recordingInProgress) requestStop();
        else if (studioReady) void startStudioRecording();
        return;
      }
      if (!recordingInProgress) return;
      if (event.code === "Space") {
        event.preventDefault();
        void (isPaused ? onResume() : onPause());
      } else if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        mark("Retake");
      } else if (/^[1-6]$/.test(event.key)) {
        const marker = markerButtons[Number(event.key) - 1];
        if (marker) mark(marker.label);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPaused, recordingInProgress, studioReady, onPause, onResume]);

  return (
    <section className={`live-studio ${liveMode ? "live-mode" : ""}`} aria-label="Live recording studio">
      {unfinishedSessions.length > 0 && (
        <RippedPaperCard className="recovery-banner">
          <AlertTriangle size={28} />
          <div>
            <h3>We found an unfinished recording</h3>
            <p>Recoverable media chunks were found. Finalize them now or inspect the session folder.</p>
          </div>
          <div className="recovery-actions">
            {unfinishedSessions.slice(0, 1).map((session) => (
              <div key={session.id}>
                <small>{session.episodeTitle} · {session.recoverableBytes ? `${Math.max(1, Math.round(session.recoverableBytes / 1024 / 1024))} MB protected` : "recovery data found"}</small>
                <RusticButton disabled={recoverySessionId === session.id} onClick={async () => { setRecoverySessionId(session.id); try { await onRecoverSession?.(session); } finally { setRecoverySessionId(undefined); } }}>{recoverySessionId === session.id ? "Recovering..." : "Recover Recording"}</RusticButton>
                <RusticButton onClick={() => onOpenSessionFolder?.(session)}>Open Folder</RusticButton>
              </div>
            ))}
            <RusticButton onClick={onDismissRecovery}>Dismiss</RusticButton>
          </div>
        </RippedPaperCard>
      )}

      <main className="live-studio-board reference-studio-board">
        <TornEdgeHeader
          title={snapshot.session?.episodeTitle ?? "Episode 047 - Real Talk. No Filter."}
          eyebrow={isRecording ? "Recording Live" : isPaused ? "Paused" : isComplete ? "Recording Complete" : "Control Room"}
          aside={
            <div className="reference-header-actions">
              <div className={`recording-timer ${isRecording ? "recording" : ""}`} aria-label="Recording timer">
                <span>{isRecording ? "Recording" : isPaused ? "Paused" : "Not Recording"}</span>
                <strong>{formatRecordingTime(snapshot.elapsedMs)}</strong>
              </div>
              <RusticButton
                className={layoutNotice ? "selected" : ""}
                onClick={() => {
                  setLayoutNotice((current) => !current);
                  setStudioNotice({ tone: "ready", message: "Layout presets are ready under the camera wall. Full layout editing comes next." });
                }}
              >
                <LayoutGrid size={16} /> View Layouts
              </RusticButton>
              <RusticButton onClick={() => setStudioNotice({ tone: "ready", message: "Studio settings live in Setup and Settings." })}>
                <Settings size={16} />
              </RusticButton>
            </div>
          }
        />

        {(snapshot.friendlyError || storageWarning || studioNotice.message) && (
          <div className={`studio-notice ${snapshot.friendlyError ? "needs-attention" : studioNotice.tone}`}>
            <strong>{snapshot.friendlyError ? "Something needs a quick check" : studioNotice.message}</strong>
            <span>{snapshot.friendlyError ?? storageWarning ?? "Live checks are ready when your gear is."}</span>
          </div>
        )}

        <section className="reference-workbench" aria-label="Studio command center">
          <div className="reference-main-column">
            <section className="camera-command-panel" aria-label="Camera previews and layouts">
              <section className="camera-strip" aria-label="Camera previews">
                {cameraSlots.map((slot) => (
                  <CameraCard
                    key={slot.key}
                    label={slot.label}
                    device={findDevice(detection.cameras, defaults.cameras[slot.key])}
                    deviceId={defaults.cameras[slot.key]}
                    isRecording={isRecording}
                    cameraSlot={slot.key}
                    micRoute={defaults.cameraMicrophones?.[slot.key] ?? fallbackCameraMicRoutes[slot.key]}
                    micRoutes={routableMicSlots}
                    assignedRoutes={defaults.cameraMicrophones}
                    trackStatus={trackStatusBySlot[slot.key]}
                    onMicRouteChange={(micSlot) => setCameraMicRoute(slot.key, micSlot)}
                    onConfigure={() =>
                      setStudioNotice({
                        tone: "ready",
                        message: `${slot.label} settings live in Studio Setup. Keep recording controls clean here.`
                      })
                    }
                    onOpenCameraPreview={onOpenCameraPreview}
                    onReleaseCameraPreview={onReleaseCameraPreview}
                  />
                ))}
              </section>

              <section className="layout-row secondary-tools" aria-label="Camera layouts">
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
              </section>
            </section>

            <section className="giant-control-row" aria-label="Recording controls">
              <StudioControlButton tone="record" disabled={!studioReady || isRecording || isPaused || recordingAction !== "idle"} onClick={() => void startStudioRecording()}>
                {recordingAction === "starting" ? <LoaderCircle className="control-spinner" size={28} /> : <Circle size={28} />} {recordingAction === "starting" ? "Starting" : "Record Full Episode"}
              </StudioControlButton>
              {isPaused ? (
                <StudioControlButton disabled={recordingAction !== "idle"} onClick={() => void onResume()}>
                  <Play size={28} /> Resume
                </StudioControlButton>
              ) : (
                <StudioControlButton disabled={!isRecording || recordingAction !== "idle"} onClick={() => void onPause()}>
                  <Pause size={28} /> Pause
                </StudioControlButton>
              )}
              <StudioControlButton disabled={(!isRecording && !isPaused) || recordingAction !== "idle"} onClick={requestStop}>
                {recordingAction === "saving" ? <LoaderCircle className="control-spinner" size={28} /> : <Square size={28} />} {recordingAction === "saving" ? "Saving" : "Stop"}
              </StudioControlButton>
              <StudioControlButton disabled={!isRecording || recordingAction !== "idle"} onClick={() => mark("Retake")}>
                <Sparkles size={28} /> Retake
              </StudioControlButton>
              <StudioControlButton onClick={goAutoEdit}>
                <Sparkles size={28} /> Auto Edit
              </StudioControlButton>
              <StudioControlButton onClick={goExport}>
                <Download size={28} /> Export
              </StudioControlButton>
              {!recordingInProgress && onQuickTest && (
                <StudioControlButton disabled={!studioReady || recordingAction !== "idle"} onClick={() => void onQuickTest()}>
                  <Play size={28} /> Run 15s Setup Test
                </StudioControlButton>
              )}
            </section>

            {recordingInProgress && snapshot.health && (
              <section className="live-source-health" aria-label="Live source recording health">
                {snapshot.health.sources.map((source) => (
                  <span className={source.active ? "ready" : "needs-attention"} key={source.target}>
                    {source.active ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                    <strong>{source.target === "program" ? "Program" : source.target}</strong>
                    <small>{source.bytesWritten > 0 ? `${(source.bytesWritten / 1024 / 1024).toFixed(1)} MB on disk` : source.message}</small>
                  </span>
                ))}
              </section>
            )}
            {recordingInProgress && <p className="live-hotkey-hint">Shortcuts: Space pause/resume · T retake · 1–6 markers · Ctrl/Cmd + Shift + R stop</p>}

            <section className="reference-console-row" aria-label="Audio, sounds, and markers">
              <section className="live-audio-deck" aria-label="Live audio feedback">
                <VintagePanel title="Microphones" icon={<Mic2 size={20} />} className="mixer-panel">
                  <div className="monitor-row">
                    <label>
                      Output
                      <select value={defaults.audioOutputId ?? ""} onChange={(event) => setOutput(event.target.value)}>
                        <option value="">System output</option>
                        {detection.speakers.map((speaker) => (
                          <option value={speaker.id} key={speaker.id}>{speaker.label}</option>
                        ))}
                      </select>
                    </label>
                    <span className="monitor-status" title="Monitoring uses a direct low-buffer software path and stays off until you choose Hear."><Headphones size={16} /> Direct software monitor</span>
                    <span className="headphone-warning" title="For true zero-delay monitoring, use the Direct Monitor control on your audio interface.">Use headphones. Hardware direct monitoring is zero-delay.</span>
                    <RusticButton title="Play a short tone through the selected output." onClick={() => void playTestSound()}>
                      <Volume2 size={16} /> Play Test Sound
                    </RusticButton>
                  </div>
                  <div className="meter-list pro-tools-mixer">
                    {micSlots.map((slot) => {
                      const deviceId = slot.key === "soundboard" || slot.key === "music" ? undefined : defaults.microphones[slot.key];
                      const label = slot.key === "soundboard" && playingSlotId ? "We hear you" : slot.key === "music" ? "Add music first" : undefined;
                      const controls = mixerChannels[slot.key] ?? defaultMixerChannel;
                      const isMicChannel = slot.key !== "soundboard" && slot.key !== "music";
                      const micKey = isMicChannel ? slot.key as MicKey : undefined;
                      const displayLabel = micKey ? defaults.microphoneNames?.[micKey] || slot.label : slot.label;
                      return (
                        <LiveMicMeter
                          key={slot.key}
                          label={displayLabel}
                          roleLabel={micKey ? getMicRoleLabel(micKey) : undefined}
                          deviceId={deviceId}
                          inputOptions={isMicChannel ? detection.microphones : []}
                          inputAssignments={defaults.microphones}
                          inputChannelAssignments={defaults.microphoneChannels}
                          micSlot={micKey}
                          selectedInputId={deviceId}
                          inputChannel={micKey ? defaults.microphoneChannels?.[micKey] ?? "mix" : "mix"}
                          outputLabel={outputLabel}
                          controls={controls}
                          monitorLabel={getMonitorLabel(slot.label)}
                          monitoring={controls.monitor && !controls.muted && (soloedChannels.length === 0 || soloedChannels.includes(slot.key))}
                          outputDeviceId={defaults.audioOutputId}
                          fallbackLevel={slot.key === "soundboard" && playingSlotId ? 72 : 0}
                          fallbackLabel={label}
                          trackStatus={trackStatusBySlot[slot.key as RecordingTrackSlot]}
                          onInputChange={micKey ? (deviceId) => setMicInput(micKey, deviceId) : undefined}
                          onInputChannelChange={micKey ? (channel) => setMicInputChannel(micKey, channel) : undefined}
                          onNameChange={micKey ? (name) => setMicName(micKey, name) : undefined}
                          onSignalChange={micKey ? (signal) => updateMicSignal(micKey, signal) : undefined}
                          onDiagnosticsChange={micKey ? (details) => setAudioDiagnostics((current) => ({ ...current, [micKey]: details })) : undefined}
                          onControlsChange={(nextState) => patchMixerChannel(slot.key, nextState)}
                          onEchoWarning={warnAboutEcho}
                          onOpenMicrophoneStream={onOpenMicrophoneStream}
                          onReleaseMicrophoneStream={onReleaseMicrophoneStream}
                        />
                      );
                    })}
                  </div>
                  <AudioDiagnostics
                    permissionNeeded={detection.permissionNeeded}
                    microphones={detection.microphones}
                    defaults={defaults}
                    diagnostics={audioDiagnostics}
                  />
                </VintagePanel>
              </section>

              <CompactSoundboard
                podcastTools={podcastTools}
                playingSlotId={playingSlotId}
                onPlaySound={(slot) => void toggleSound(slot)}
                onPatchTools={patchTools}
                onNeedsSetup={() => setStudioNotice({ tone: "needs-attention", message: "Assign sounds in the full Soundboard panel." })}
              />

              <CompactMarkers
                markers={podcastTools.markers}
                markerNotice={markerNotice}
                onMark={mark}
              />
            </section>
          </div>

          <StudioSideStack
            podcastTools={podcastTools}
            notesSavedAt={notesSavedAt}
            onPatchTools={patchTools}
            onPatchNotes={patchNotes}
          />
        </section>

        <ReadinessStrip
          cameraReadyCount={cameraReadyCount}
          micReadyCount={micReadyCount}
          storageReady={storageReady}
          recordingHealthy={recordingHealthy}
          deviceAssignmentsHealthy={deviceAssignmentsHealthy}
        />

        <section className={`studio-ready-summary ${studioReady ? "ready" : "needs-attention"}`} aria-label="Studio Ready summary">
          <strong>{studioReady ? "Studio Ready" : "Almost Ready"}</strong>
          <span>{cameraReadyCount > 0 ? "Cameras ready" : "Pick a camera first"}</span>
          <span>{micReadyCount > 0 ? "Mics ready" : "Video-only is ready; mics are optional"}</span>
          <span>{storageReady ? "Storage good" : "Storage needs attention"}</span>
          <span>{deviceAssignmentsHealthy ? "Sources separate" : "Optional source routes need attention"}</span>
          {recordingInProgress && snapshot.health && (
            <span>{snapshot.health.activeCameraTracks} cameras / {snapshot.health.activeAudioTracks} mics active</span>
          )}
          <span>{studioReady ? "Ready to record" : "Check the items above"}</span>
        </section>

        <details className="secondary-studio-tools" open={toolsOpen} onToggle={(event) => setToolsOpen(event.currentTarget.open)}>
          <summary>{toolsOpen ? "Hide studio tools" : "Show notes, markers, teleprompter, and soundboard"}</summary>
          <section className="live-studio-grid" aria-label="Studio tools">
            <StudioToolPanels
              podcastTools={podcastTools}
              displays={displays}
              poppedOutPanels={poppedOutPanels}
              playingSlotId={playingSlotId}
              markerNotice={markerNotice}
              notesSavedAt={notesSavedAt}
              elapsedMs={snapshot.elapsedMs}
              recordingStatus={snapshot.status}
              diagnosticsMessage="Main Studio continues recording while tools float."
              onPatchTools={patchTools}
              onPatchNotes={patchNotes}
              onPlaySound={(slot) => void toggleSound(slot)}
              onMark={mark}
              onPopOut={onPopOutPanel}
              onReturnToStudio={onReturnPanel}
            />
          </section>
        </details>

        <div className={`local-save-note live ${recordingAction === "saving" ? "saving" : ""}`} role="status" aria-live="polite">
          {recordingAction === "saving" ? <LoaderCircle className="control-spinner" size={20} /> : <Save size={20} />}
          <span>{recordingAction === "saving" ? "Verifying the program, each camera, each microphone, and the optional backup copy." : `${snapshot.localSaveMessage}. Disk-first protection is on. Saving location: ${savingLocation}`}</span>
        </div>

        {isComplete && (
          <RippedPaperCard className="recording-complete-card">
            <CheckCircle2 size={34} />
            <div>
              <h3>Nice work!</h3>
              <p>Your episode is safely stored. Next step: review your markers and timeline.</p>
              {snapshot.integrity && <small>{snapshot.integrity.programPlayable ? "Program verified" : "Program needs attention"} · {snapshot.integrity.savedSourceCount}/{snapshot.integrity.expectedSourceCount} separate sources verified{snapshot.integrity.backupPath ? " · second-drive backup complete" : ""}</small>}
            </div>
            <Button variant="primary" icon={<ArrowRight size={20} />} onClick={onNext}>Review Episode</Button>
          </RippedPaperCard>
        )}

        <StudioFooter
          episodeTitle={snapshot.session?.episodeTitle ?? podcastTools.episodeId ?? "Episode waiting"}
          layout={podcastTools.cameraLayout}
          markerCount={podcastTools.markers.length}
          durationMs={snapshot.elapsedMs}
          exportReady={hasMedia}
          autoEditReady={hasMedia}
        />
      </main>
    </section>
  );
}

function findDevice(devices: StudioDevice[], deviceId?: string) {
  return devices.find((device) => device.id === deviceId);
}

function getMicSlotLabel(slot: MicKey) {
  return routableMicSlots.find((item) => item.key === slot)?.label ?? slot;
}

function getCameraSlotLabel(slot: CameraKey) {
  return cameraSlots.find((item) => item.key === slot)?.label ?? slot;
}

function findAssignedMicSlot(
  assignments: Partial<Record<MicKey, string>>,
  channelAssignments: Partial<Record<MicKey, MicrophoneInputChannel>> | undefined,
  deviceId?: string,
  channel: MicrophoneInputChannel = "mix",
  exceptSlot?: MicKey
) {
  if (!deviceId) return undefined;
  return (Object.entries(assignments) as Array<[MicKey, string | undefined]>)
    .find(([slot, assignedDeviceId]) => slot !== exceptSlot
      && assignedDeviceId === deviceId
      && (channelAssignments?.[slot] ?? "mix") === channel)?.[0];
}

function findAssignedCameraRoute(assignments: Partial<Record<CameraKey, MicKey>> | undefined, micSlot: MicKey, exceptSlot?: CameraKey) {
  const routes = { ...fallbackCameraMicRoutes, ...assignments };
  return (Object.entries(routes) as Array<[CameraKey, MicKey]>)
    .find(([slot, assignedMicSlot]) => slot !== exceptSlot && assignedMicSlot === micSlot)?.[0];
}

function getMonitorLabel(label: string) {
  if (label.includes("Morgan")) return "Hear Morgan";
  if (label.includes("Guest")) return "Hear Guest";
  if (label.includes("Headset") || label.includes("Extra")) return "Hear Extra";
  return `Hear ${label}`;
}

function ReadinessStrip({
  cameraReadyCount,
  micReadyCount,
  storageReady,
  recordingHealthy,
  deviceAssignmentsHealthy
}: {
  cameraReadyCount: number;
  micReadyCount: number;
  storageReady: boolean;
  recordingHealthy: boolean;
  deviceAssignmentsHealthy: boolean;
}) {
  const items = [
    { label: cameraReadyCount > 0 ? "Cameras Ready" : "Cameras Need Attention", ready: cameraReadyCount > 0 },
    { label: micReadyCount > 0 ? "Microphones Ready" : "Microphones Need Attention", ready: micReadyCount > 0 },
    { label: storageReady ? "Storage Available" : "Storage Needs Attention", ready: storageReady },
    { label: recordingHealthy ? "Recording Healthy" : "Recording Needs Attention", ready: recordingHealthy },
    { label: deviceAssignmentsHealthy ? "Routes Separate" : "Routes Need Attention", ready: deviceAssignmentsHealthy }
  ];

  return (
    <section className="studio-readiness-strip" aria-label="Studio readiness">
      {items.map((item) => (
        <span className={item.ready ? "ready" : "needs-attention"} key={item.label}>
          {item.ready ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {item.label}
        </span>
      ))}
    </section>
  );
}

function CompactSoundboard({
  podcastTools,
  playingSlotId,
  onPlaySound,
  onPatchTools,
  onNeedsSetup
}: {
  podcastTools: PodcastToolsState;
  playingSlotId?: string;
  onPlaySound: (slot: SoundSlot) => void;
  onPatchTools: (state: PodcastToolsState) => void;
  onNeedsSetup: () => void;
}) {
  const slots = [podcastTools.soundboard.intro, podcastTools.soundboard.outro, ...podcastTools.soundboard.customSlots];

  return (
    <VintagePanel title="Sound Board" icon={<Radio size={20} />} className="compact-soundboard-panel">
      <div className="compact-sound-grid">
        {slots.slice(0, 6).map((slot) => (
          <button
            className={playingSlotId === slot.id ? "playing" : ""}
            type="button"
            onClick={() => {
              if (!slot.filePath) onNeedsSetup();
              onPlaySound(slot);
            }}
            key={slot.id}
          >
            <strong>{slot.label}</strong>
            <span>{playingSlotId === slot.id ? "Playing" : slot.filePath ? "Ready" : "Add sound"}</span>
          </button>
        ))}
      </div>
      <label className="compact-volume">
        Board volume
        <input
          type="range"
          min="0"
          max="100"
          value={podcastTools.soundboard.masterVolume}
          onChange={(event) =>
            onPatchTools({
              ...podcastTools,
              soundboard: { ...podcastTools.soundboard, masterVolume: Number(event.target.value) },
              practiceMode: { ...podcastTools.practiceMode, soundboardTried: true }
            })
          }
        />
      </label>
      <RusticButton onClick={onNeedsSetup}><Plus size={16} /> Add Sound</RusticButton>
    </VintagePanel>
  );
}

function CompactMarkers({
  markers,
  markerNotice,
  onMark
}: {
  markers: PodcastToolsState["markers"];
  markerNotice?: string;
  onMark: (label: string) => void;
}) {
  return (
    <VintagePanel title="Markers" icon={<Sparkles size={20} />} className="compact-markers-panel">
      <div className="compact-marker-actions">
        {markerButtons.slice(0, 6).map((marker) => (
          <button type="button" onClick={() => onMark(marker.label)} key={marker.label}>{marker.label}</button>
        ))}
      </div>
      {markerNotice && <p className="marker-toast live" aria-live="polite">{markerNotice}</p>}
      <div className="compact-marker-list">
        {markers.length === 0 ? (
          <span>No markers yet</span>
        ) : (
          markers.slice(0, 6).map((marker) => (
            <span key={marker.id}><strong>{marker.label}</strong>{formatRecordingTime(marker.timestampMs)}</span>
          ))
        )}
      </div>
    </VintagePanel>
  );
}

function StudioSideStack({
  podcastTools,
  notesSavedAt,
  onPatchTools,
  onPatchNotes
}: {
  podcastTools: PodcastToolsState;
  notesSavedAt: string;
  onPatchTools: (state: PodcastToolsState) => void;
  onPatchNotes: (state: PodcastToolsState) => void;
}) {
  const teleprompter = podcastTools.teleprompter;

  function patchTeleprompter(patch: Partial<typeof teleprompter>) {
    onPatchTools({
      ...podcastTools,
      teleprompter: { ...teleprompter, ...patch },
      practiceMode: { ...podcastTools.practiceMode, teleprompterTried: true }
    });
  }

  return (
    <aside className="studio-side-stack" aria-label="Episode notes and teleprompter">
      <CompactTextPanel
        title="Episode Notes"
        icon={<FileText size={18} />}
        savedState={notesSavedAt}
        value={podcastTools.guestNotes.talkingPoints}
        placeholder={"- Talk about starting over\n- Nashville experience\n- Future plans"}
        onChange={(value) =>
          onPatchNotes({
            ...podcastTools,
            guestNotes: { ...podcastTools.guestNotes, talkingPoints: value },
            practiceMode: { ...podcastTools.practiceMode, notesTried: true }
          })
        }
      />
      <CompactTextPanel
        title="Guest Notes"
        icon={<User size={18} />}
        savedState={notesSavedAt}
        value={podcastTools.guestNotes.questions}
        placeholder="Name, occupation, handle, topics..."
        onChange={(value) =>
          onPatchNotes({
            ...podcastTools,
            guestNotes: { ...podcastTools.guestNotes, questions: value },
            practiceMode: { ...podcastTools.practiceMode, notesTried: true }
          })
        }
      />
      <section className="compact-side-panel teleprompter-reference-panel">
        <div className="compact-panel-heading">
          <h3>Teleprompter</h3>
          <Type size={18} />
        </div>
        <textarea
          className="dark-mode"
          aria-label="Teleprompter"
          value={teleprompter.script}
          onChange={(event) => patchTeleprompter({ script: event.target.value })}
          style={{ fontSize: `${Math.min(36, Math.max(22, teleprompter.fontSize))}px` }}
          placeholder="Welcome back to What About It?, the show where we get real, we get deep..."
        />
        <div className="teleprompter-reference-controls">
          <RusticButton onClick={() => patchTeleprompter({ fontSize: Math.max(22, teleprompter.fontSize - 4) })}>A-</RusticButton>
          <RusticButton onClick={() => patchTeleprompter({ fontSize: Math.min(72, teleprompter.fontSize + 4) })}>A+</RusticButton>
          <label>
            Speed {teleprompter.speed}
            <input type="range" min="1" max="10" value={teleprompter.speed} onChange={(event) => patchTeleprompter({ speed: Number(event.target.value) })} />
          </label>
        </div>
      </section>
    </aside>
  );
}

function CompactTextPanel({
  title,
  icon,
  value,
  savedState,
  placeholder,
  onChange
}: {
  title: string;
  icon: ReactNode;
  value: string;
  savedState: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <section className="compact-side-panel">
      <div className="compact-panel-heading">
        <h3>{title}</h3>
        {icon}
      </div>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      <small>{savedState}</small>
    </section>
  );
}

function CameraCard({
  label,
  device,
  deviceId,
  isRecording,
  cameraSlot,
  micRoute,
  micRoutes,
  assignedRoutes,
  trackStatus,
  onMicRouteChange,
  onConfigure,
  onOpenCameraPreview,
  onReleaseCameraPreview
}: {
  label: string;
  device?: StudioDevice;
  deviceId?: string;
  isRecording: boolean;
  cameraSlot: CameraKey;
  micRoute: MicKey;
  micRoutes: Array<{ key: MicKey; label: string }>;
  assignedRoutes?: Partial<Record<CameraKey, MicKey>>;
  trackStatus?: RecordingTrackSaveResult;
  onMicRouteChange: (micSlot: MicKey) => void;
  onConfigure: () => void;
  onOpenCameraPreview: (deviceId?: string) => Promise<MediaStream>;
  onReleaseCameraPreview: (deviceId?: string, stream?: MediaStream) => void;
}) {
  const [previewState, setPreviewState] = useState<"starting" | "live" | "needs-attention" | "busy" | "permission">("starting");
  const status =
    previewState === "live" ? "Live" :
      previewState === "busy" ? "Camera is being used by another app" :
        previewState === "permission" ? "We need permission" :
          device ? "Ready" : deviceId ? "Needs Attention" : "Not Connected";
  const cardState = previewState === "live" ? "live" : device || deviceId ? "needs-attention" : "not-connected";
  const resolution = device?.camera?.maxResolution ?? "Auto";
  const fps = device?.camera?.maxFps ?? 30;
  const connection = device?.camera?.connectionType ?? "unknown";
  const battery = device?.camera?.batteryPercent;

  return (
    <RippedPaperCard className={`camera-live-card ${cardState}`}>
      <div className="camera-live-top">
        <div>
          <h3>{getCameraReferenceTitle(cameraSlot, label)}</h3>
          <span className={previewState === "live" ? "live-badge" : ""}>{status}</span>
        </div>
        <button type="button" aria-label={`${label} advanced settings`} title="Advanced settings" onClick={onConfigure}>
          <Settings size={18} />
        </button>
      </div>
      <CameraFeed
        label={label}
        deviceId={deviceId}
        onOpenCameraPreview={onOpenCameraPreview}
        onReleaseCameraPreview={onReleaseCameraPreview}
        onPreviewState={setPreviewState}
      />
      <div className="camera-identity-row">
        <p>{device?.label ?? "Pick a camera first"}</p>
        <span className={`recording-dot ${isRecording && previewState === "live" ? "on" : ""}`}>{isRecording && previewState === "live" ? "Recording" : "Standby"}</span>
      </div>
      <label className="camera-audio-route">
        Audio input
        <select
          aria-label={`${label} audio input`}
          value={micRoute}
          onChange={(event) => onMicRouteChange(event.target.value as MicKey)}
        >
          {micRoutes.map((route) => {
            const owner = findAssignedCameraRoute(assignedRoutes, route.key, cameraSlot);
            return (
              <option value={route.key} key={`${cameraSlot}-${route.key}`}>
                {owner ? `${route.label} - swap from ${getCameraSlotLabel(owner)}` : route.label}
              </option>
            );
          })}
        </select>
      </label>
      {trackStatus && <TrackSavePill status={trackStatus} />}
      <div className="camera-meta-grid">
        <small><Cable size={14} /> {connection}</small>
        <small>{resolution}</small>
        <small>{fps} fps</small>
        <small><Battery size={14} /> {battery === undefined ? "Power OK" : `${battery}%`}</small>
      </div>
    </RippedPaperCard>
  );
}

function getCameraReferenceTitle(slot: CameraKey, fallback: string) {
  if (slot === "camera1") return "CAM 1  •  MORGAN";
  if (slot === "camera2") return "CAM 2  •  GUEST";
  if (slot === "camera3") return "CAM 3  •  WIDE";
  return fallback;
}

function CameraFeed({
  label,
  deviceId,
  onOpenCameraPreview,
  onReleaseCameraPreview,
  onPreviewState
}: {
  label: string;
  deviceId?: string;
  onOpenCameraPreview: (deviceId?: string) => Promise<MediaStream>;
  onReleaseCameraPreview: (deviceId?: string, stream?: MediaStream) => void;
  onPreviewState: (state: "starting" | "live" | "needs-attention" | "busy" | "permission") => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<"starting" | "live" | "needs-attention" | "busy" | "permission">("starting");
  const [previewAttempt, setPreviewAttempt] = useState(0);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let canceled = false;
    let reconnectTimer: number | undefined;

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
        if (canceled) {
          onReleaseCameraPreview(deviceId, stream);
          return;
        }
        stream.getVideoTracks().forEach((track) => {
          track.addEventListener("ended", () => {
            if (canceled) return;
            setState("starting");
            onPreviewState("starting");
            reconnectTimer = window.setTimeout(() => setPreviewAttempt((attempt) => attempt + 1), 1200);
          }, { once: true });
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setState("live");
        onPreviewState("live");
      } catch (error) {
        const nextState = getLivePreviewIssue(error);
        setState(nextState);
        onPreviewState(nextState);
      }
    }

    void startPreview();

    return () => {
      canceled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (stream) onReleaseCameraPreview(deviceId, stream);
    };
  }, [deviceId, onOpenCameraPreview, onPreviewState, onReleaseCameraPreview, previewAttempt]);

  return (
    <div className={`live-video-frame ${state}`}>
      <video ref={videoRef} muted playsInline aria-label={`${label} live preview`} />
      {state !== "live" && (
        <div>
          <Camera size={26} />
          <strong>{getLivePreviewCopy(state, deviceId)}</strong>
        </div>
      )}
    </div>
  );
}

function getLivePreviewIssue(error: unknown): "busy" | "permission" | "needs-attention" {
  const message = String(error);
  if (message.includes("NotAllowedError") || message.includes("Permission")) return "permission";
  if (message.includes("NotReadableError") || message.includes("TrackStartError")) return "busy";
  return "needs-attention";
}

function getLivePreviewCopy(state: "starting" | "live" | "needs-attention" | "busy" | "permission", deviceId?: string) {
  if (state === "starting") return "Starting preview";
  if (!deviceId) return "Pick a camera first";
  if (state === "permission") return "We need permission";
  if (state === "busy") return "Camera is being used by another app";
  return "Needs attention";
}

function LiveMicMeter({
  label,
  roleLabel,
  deviceId,
  inputOptions,
  inputAssignments,
  inputChannelAssignments,
  micSlot,
  selectedInputId,
  inputChannel,
  outputLabel,
  controls,
  monitorLabel,
  monitoring,
  outputDeviceId,
  fallbackLevel,
  fallbackLabel,
  trackStatus,
  onInputChange,
  onInputChannelChange,
  onNameChange,
  onSignalChange,
  onDiagnosticsChange,
  onControlsChange,
  onEchoWarning,
  onOpenMicrophoneStream,
  onReleaseMicrophoneStream
}: {
  label: string;
  roleLabel?: string;
  deviceId?: string;
  inputOptions: StudioDevice[];
  inputAssignments: Partial<Record<MicKey, string>>;
  inputChannelAssignments?: Partial<Record<MicKey, MicrophoneInputChannel>>;
  micSlot?: MicKey;
  selectedInputId?: string;
  inputChannel: MicrophoneInputChannel;
  outputLabel: string;
  controls: MixerChannelControls;
  monitorLabel: string;
  monitoring: boolean;
  outputDeviceId?: string;
  fallbackLevel?: number;
  fallbackLabel?: string;
  trackStatus?: RecordingTrackSaveResult;
  onInputChange?: (deviceId: string) => void;
  onInputChannelChange?: (channel: MicrophoneInputChannel) => void;
  onNameChange?: (name: string) => void;
  onSignalChange?: (signal: MicSignalState) => void;
  onDiagnosticsChange?: (details: LiveInputDiagnostics) => void;
  onControlsChange: (nextState: Partial<MixerChannelControls>) => void;
  onEchoWarning: () => void;
  onOpenMicrophoneStream: (deviceId?: string) => Promise<MediaStream>;
  onReleaseMicrophoneStream: (deviceId?: string, stream?: MediaStream) => void;
}) {
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const controlsRef = useRef(controls);
  const outputDeviceIdRef = useRef(outputDeviceId);
  const onSignalChangeRef = useRef(onSignalChange);
  const onDiagnosticsChangeRef = useRef(onDiagnosticsChange);
  const monitorGraphRef = useRef<ActiveVoiceMonitor | undefined>(undefined);
  const monitorRequestRef = useRef(0);
  const [level, setLevel] = useState(fallbackLevel ?? 0);
  const [peakLevel, setPeakLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const [signalState, setSignalState] = useState<MicSignalState>(deviceId ? "checking" : "disconnected");
  const [routeIssue, setRouteIssue] = useState<string | undefined>();
  const [monitorIssue, setMonitorIssue] = useState<string | undefined>();
  const inputDisplay = getMicrophoneInputDisplay(inputChannel);

  controlsRef.current = controls;
  outputDeviceIdRef.current = outputDeviceId;
  onSignalChangeRef.current = onSignalChange;
  onDiagnosticsChangeRef.current = onDiagnosticsChange;

  function publishSignal(signal: MicSignalState, diagnostics?: AudioStreamDiagnostics, rms = level, peak = peakLevel, trackState?: MediaStreamTrackState) {
    setSignalState(signal);
    onSignalChangeRef.current?.(signal);
    if (diagnostics) onDiagnosticsChangeRef.current?.({ ...diagnostics, signal, rms, peak, trackState });
  }

  const stopMonitorPlayback = useCallback(() => {
    monitorRequestRef.current += 1;
    const graph = monitorGraphRef.current;
    monitorGraphRef.current = undefined;
    graph?.chain.disconnect();
    void graph?.audioContext.close();
  }, []);

  const startMonitorPlayback = useCallback(async (stream = streamRef.current) => {
    if (!stream) {
      setMonitorIssue(deviceId ? "Starting monitor..." : "Pick input first");
      return;
    }

    let pendingContext: AudioContext | undefined;
    try {
      const currentControls = controlsRef.current;
      stopMonitorPlayback();
      const requestId = monitorRequestRef.current;
      const audioContext = createStudioAudioContext(outputDeviceIdRef.current);
      pendingContext = audioContext;
      const sinkableContext = audioContext as AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };
      const source = audioContext.createMediaStreamSource(stream);

      if (outputDeviceIdRef.current && sinkableContext.setSinkId) {
        await sinkableContext.setSinkId(outputDeviceIdRef.current);
      }

      const chain = connectVoiceMonitorChain(audioContext, source, audioContext.destination, currentControls.voicePreset, currentControls.gain, inputChannel);

      if (monitorRequestRef.current !== requestId) {
        chain.disconnect();
        await audioContext.close();
        return;
      }

      monitorGraphRef.current = { audioContext, chain };
      pendingContext = undefined;
      await audioContext.resume();
      onEchoWarning();
      setMonitorIssue(undefined);
    } catch {
      void pendingContext?.close();
      stopMonitorPlayback();
      setMonitorIssue("Click again or pick headphones");
    }
  }, [deviceId, inputChannel, onEchoWarning, stopMonitorPlayback]);

  function toggleMonitor() {
    const nextMonitor = !controls.monitor;
    onControlsChange({ monitor: nextMonitor });
    if (!nextMonitor) {
      setMonitorIssue(undefined);
      stopMonitorPlayback();
    }
  }

  useEffect(() => {
    if (!deviceId || !window.AudioContext) {
      setLevel(fallbackLevel ?? 0);
      setHeard(Boolean(fallbackLevel));
      setPeakLevel(fallbackLevel ?? 0);
      publishSignal(deviceId ? "checking" : "disconnected", undefined, fallbackLevel ?? 0, fallbackLevel ?? 0);
      return undefined;
    }

    let audioContext: AudioContext | undefined;
    let stream: MediaStream | undefined;
    let frame = 0;
    let centeredMeterSource: ReturnType<typeof connectInputChannelSource> | undefined;
    let canceled = false;
    let lastSignalAt = 0;
    const startedAt = Date.now();

    async function startMeter() {
      try {
        stream = await onOpenMicrophoneStream(deviceId);
        if (canceled) {
          onReleaseMicrophoneStream(deviceId, stream);
          return;
        }
        streamRef.current = stream;
        const track = stream.getAudioTracks()[0];
        const diagnostics = getAudioStreamDiagnostics(stream);
        setRouteIssue(undefined);
        if (track && typeof track.addEventListener === "function") {
          track.addEventListener("ended", () => publishSignal("disconnected", diagnostics, 0, 0, "ended"), { once: true });
        }
        audioContext = createStudioAudioContext();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        const samples = new Uint8Array(analyser.frequencyBinCount);
        centeredMeterSource = connectInputChannelSource(audioContext, source, inputChannel, diagnostics.channelCount);
        centeredMeterSource.output.connect(analyser);

        const tick = () => {
          if (canceled) return;
          analyser.getByteTimeDomainData(samples);
          const measured = calculateAudioLevel(samples);
          const currentControls = controlsRef.current;
          const nextLevel = currentControls.muted ? 0 : Math.min(100, Math.round(measured.rms * (currentControls.gain / 75)));
          const nextPeak = currentControls.muted ? 0 : measured.peak;
          if (nextLevel > 7) lastSignalAt = Date.now();
          const nextSignal: MicSignalState = track?.readyState === "ended"
            ? "disconnected"
            : nextPeak >= 98
            ? "clipping"
            : nextLevel > 7
            ? "active"
            : Date.now() - Math.max(lastSignalAt, startedAt) < 5000
            ? "quiet"
            : "no-signal";
          setLevel(nextLevel);
          setPeakLevel(nextPeak);
          setHeard(nextLevel > 8);
          publishSignal(nextSignal, diagnostics, nextLevel, nextPeak, track?.readyState);
          frame = window.requestAnimationFrame(tick);
        };

        tick();
      } catch (error) {
        setLevel(0);
        setPeakLevel(0);
        setHeard(false);
        const message = String(error);
        setRouteIssue(message.includes("input channel") ? message.replace(/^Error:\s*/, "") : "Could not open this input. Check the cable and Retry Devices.");
        publishSignal(deviceId ? "no-signal" : "disconnected", undefined, 0, 0);
      }
    }

    void startMeter();

    return () => {
      canceled = true;
      if (frame) window.cancelAnimationFrame(frame);
      if (streamRef.current === stream) streamRef.current = undefined;
      stopMonitorPlayback();
      if (stream) onReleaseMicrophoneStream(deviceId, stream);
      centeredMeterSource?.disconnect();
      void audioContext?.close();
    };
  }, [deviceId, fallbackLevel, inputChannel, onOpenMicrophoneStream, onReleaseMicrophoneStream, stopMonitorPlayback]);

  useEffect(() => {
    if (!monitoring || controls.muted) {
      stopMonitorPlayback();
      return;
    }

    void startMonitorPlayback();
  }, [controls.muted, deviceId, inputChannel, monitoring, outputDeviceId, startMonitorPlayback, stopMonitorPlayback]);

  useEffect(() => {
    monitorGraphRef.current?.chain.update(controls.voicePreset, controls.gain);
  }, [controls.gain, controls.voicePreset]);

  const visibleLevel = controls.muted ? 0 : level;
  const copy = controls.muted
    ? "Muted"
    : routeIssue
    ? "Needs attention"
    : fallbackLabel
    ?? (signalState === "clipping" ? "CLIPPING" : signalState === "active" ? "ACTIVE" : signalState === "quiet" ? "CONNECTED / QUIET" : signalState === "no-signal" ? "NO SIGNAL" : signalState === "disconnected" ? "DISCONNECTED" : "CHECKING");

  return (
    <article className={`live-meter-card ${heard && !controls.muted ? "heard" : "quiet"}`}>
      <div className="channel-topline">
        <strong>{label}{roleLabel ? <small>{roleLabel}</small> : null}</strong>
        <span>{copy}</span>
      </div>
      {routeIssue ? <small className="input-route-warning">{routeIssue}</small> : null}
      {trackStatus && <TrackSavePill status={trackStatus} />}
      <DistressedMeter level={visibleLevel} label={label} />
      <div className="channel-console">
        {onNameChange && (
          <label className="channel-name-control" title="This name is saved with the episode and its separate audio track.">
            <span className="control-caption">Name</span>
            <input aria-label={`${roleLabel ?? label} name`} value={label} onChange={(event) => onNameChange(event.target.value)} />
          </label>
        )}
        {onInputChange && (
          <label className="channel-input-control" title="Choose which physical mic feeds this mixer channel.">
            <span className="control-caption">Input</span>
            <select aria-label={`${label} input`} value={selectedInputId ?? ""} onChange={(event) => onInputChange(event.target.value)}>
              <option value="">Pick input</option>
              {inputOptions.map((device) => {
                const owner = findAssignedMicSlot(inputAssignments, inputChannelAssignments, device.id, inputChannel, micSlot);
                return (
                  <option value={device.id} key={device.id}>
                    {owner ? `${device.label} - choose another input channel` : device.label}
                  </option>
                );
              })}
            </select>
          </label>
        )}
        {onInputChannelChange && (
          <label className="channel-route-control" title="Choose the physical input jack when the Windows audio driver exposes it.">
            <span className="control-caption">Physical Jack</span>
            <select aria-label={`${label} interface channel`} value={inputChannel} onChange={(event) => onInputChannelChange(event.target.value as MicrophoneInputChannel)}>
              {microphoneInputChannelOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
            <span className={`physical-input-assignment compact ${inputChannel === "mix" ? "automatic" : "routed"}`}>
              <strong>{inputDisplay.short}</strong>
              <b>{inputChannel === "mix" ? "Combined" : `Feeds ${label}`}</b>
            </span>
          </label>
        )}
        <label className="channel-effect-control" title="Live headphone processing for podcast voice checks. Recordings keep the high-quality mic capture.">
          <span className="control-caption">Voice Polish</span>
          <select
            aria-label={`${label} voice polish`}
            value={controls.voicePreset}
            onChange={(event) => onControlsChange({ voicePreset: event.target.value as VoicePreset })}
          >
            {(Object.entries(voicePresets) as Array<[VoicePreset, { label: string; description: string }]>).map(([preset, details]) => (
              <option value={preset} key={preset}>{details.label}</option>
            ))}
          </select>
        </label>
        <label className="channel-volume-control" title="Controls the live monitor level and meter sensitivity for this channel.">
          <span className="control-caption">Headphone level <strong>{controls.gain}%</strong></span>
          <input
            aria-label={`${label} headphone monitoring level`}
            type="range"
            min="0"
            max="100"
            value={controls.gain}
            onChange={(event) => onControlsChange({ gain: Number(event.target.value) })}
          />
        </label>
        <span className="channel-output" title={`This channel monitors through ${outputLabel}.`}>Output <strong>{outputLabel}</strong></span>
        <small className="channel-effect-copy" title="Inputs are centered in both ears. Use your interface Direct Monitor switch or mixer control for true zero-delay monitoring.">
          {voicePresets[controls.voicePreset].description}
        </small>
        <div className="channel-buttons">
          <Tooltip label="Mute: silence this channel in your headphones.">
            <button title="Mute this channel" className={controls.muted ? "selected" : ""} type="button" onClick={() => onControlsChange({ muted: !controls.muted })}>
              <VolumeX size={14} /> <span>Mute</span>
            </button>
          </Tooltip>
          <Tooltip label="Solo: focus this channel while checking levels.">
            <button title="Solo this channel" className={controls.solo ? "selected" : ""} type="button" onClick={() => onControlsChange({ solo: !controls.solo })}>
              <SlidersHorizontal size={14} /> <span>Solo</span>
            </button>
          </Tooltip>
          <Tooltip label="Hear: send this mic to your selected headphone output.">
            <button title={`${monitorLabel} through headphones`} className={controls.monitor ? "selected" : ""} type="button" onClick={toggleMonitor}>
              <Headphones size={14} /> <span>Hear</span> <strong>{controls.monitor && !controls.muted ? "On" : "Off"}</strong>
            </button>
          </Tooltip>
        </div>
        <small className={`monitor-feedback ${monitoring && !monitorIssue ? "on" : monitorIssue ? "needs-attention" : ""}`}>
          {monitorIssue ?? (monitoring ? `${monitorLabel} On -> ${outputLabel}` : `${monitorLabel} Off`)}
        </small>
        <small className={peakLevel >= 98 ? "peak hot" : "peak"}>Peak {peakLevel}%{peakLevel >= 98 ? " - CLIPPING" : ""}</small>
      </div>
    </article>
  );
}

function TrackSavePill({ status }: { status: RecordingTrackSaveResult }) {
  const label = status.status === "saved" ? "Saved" : status.status === "needs-attention" ? "Needs Attention" : "Preview only";
  return <span className={`track-save-pill ${status.status}`}>{label}</span>;
}

function AudioDiagnostics({
  permissionNeeded,
  microphones,
  defaults,
  diagnostics
}: {
  permissionNeeded: boolean;
  microphones: StudioDevice[];
  defaults: DeviceDefaults;
  diagnostics: Partial<Record<MicKey, LiveInputDiagnostics>>;
}) {
  return (
    <details className="audio-diagnostics">
      <summary>Audio Diagnostics</summary>
      <div className="audio-diagnostics-grid">
        <span><strong>Microphone permission</strong>{permissionNeeded ? "Permission needed" : "Granted"}</span>
        <span><strong>Detected audio inputs</strong>{microphones.length || "None"}</span>
        {routableMicSlots.map((slot) => {
          const device = findDevice(microphones, defaults.microphones[slot.key]);
          const details = diagnostics[slot.key];
          return (
            <section key={slot.key}>
              <h4>{defaults.microphoneNames?.[slot.key] || slot.label} - {getMicRoleLabel(slot.key)}</h4>
              <dl>
                <dt>Selected interface</dt><dd>{device?.label ?? "Not selected"}</dd>
                <dt>Windows label</dt><dd>{device?.rawLabel ?? device?.label ?? "Unavailable"}</dd>
                <dt>Device ID</dt><dd>{details?.deviceId ?? device?.id ?? "Unavailable"}</dd>
                <dt>Group ID</dt><dd>{details?.groupId ?? device?.groupId ?? "Unavailable"}</dd>
                <dt>Interface channel</dt><dd>{defaults.microphoneChannels?.[slot.key] ?? "mix"}</dd>
                <dt>Channels reported</dt><dd>{details?.channelCount ?? "Open the input to inspect"}</dd>
                <dt>Format</dt><dd>{details?.sampleRate ? `${details.sampleRate} Hz` : "Unknown"}{details?.sampleSize ? ` / ${details.sampleSize}-bit` : ""}</dd>
                <dt>Browser processing</dt><dd>Echo {formatDiagnosticFlag(details?.echoCancellation)}, Noise {formatDiagnosticFlag(details?.noiseSuppression)}, Auto gain {formatDiagnosticFlag(details?.autoGainControl)}</dd>
                <dt>Signal</dt><dd>{formatSignalState(details?.signal)} / RMS {details?.rms ?? 0}% / Peak {details?.peak ?? 0}%</dd>
              </dl>
            </section>
          );
        })}
      </div>
    </details>
  );
}

function getMicRoleLabel(slot: MicKey) {
  if (slot === "morganMic") return "Host";
  if (slot === "guestMic") return "Guest";
  return "Extra";
}

function formatDiagnosticFlag(value?: boolean) {
  return value === undefined ? "unknown" : value ? "on" : "off";
}

function formatSignalState(value?: MicSignalState) {
  if (!value) return "Checking";
  return value.replace("-", " ").toUpperCase();
}

function StudioFooter({
  episodeTitle,
  layout,
  markerCount,
  durationMs,
  exportReady,
  autoEditReady
}: {
  episodeTitle: string;
  layout: CameraLayout;
  markerCount: number;
  durationMs: number;
  exportReady: boolean;
  autoEditReady: boolean;
}) {
  return (
    <footer className="studio-command-footer" aria-label="Studio command footer">
      <span><strong>Episode</strong>{episodeTitle}</span>
      <span><strong>Layout</strong>{layout}</span>
      <span><strong>Markers</strong>{markerCount}</span>
      <span><strong>Duration</strong>{formatRecordingTime(durationMs)}</span>
      <span><strong>Export</strong>{exportReady ? "Ready" : "Waiting"}</span>
      <span><strong>Auto Edit</strong>{autoEditReady ? "Ready" : "Waiting"}</span>
    </footer>
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

function connectVoiceMonitorChain(
  audioContext: AudioContext,
  source: AudioNode,
  destination: AudioNode,
  preset: VoicePreset,
  gainValue: number,
  inputChannel: MicrophoneInputChannel
) {
  const highPass = audioContext.createBiquadFilter();
  highPass.type = "highpass";
  highPass.Q.value = 0.7;

  const warmth = audioContext.createBiquadFilter();
  warmth.type = "lowshelf";
  warmth.frequency.value = 180;

  const presence = audioContext.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 3200;
  presence.Q.value = 0.9;

  const makeup = audioContext.createGain();
  const centered = connectInputChannelSource(audioContext, source, inputChannel);

  centered.output.connect(highPass);
  highPass.connect(warmth);
  warmth.connect(presence);
  presence.connect(makeup);
  makeup.connect(destination);

  function update(nextPreset: VoicePreset, nextGainValue: number) {
    const now = audioContext.currentTime;
    highPass.frequency.setTargetAtTime(nextPreset === "clean" ? 60 : 82, now, 0.01);
    warmth.gain.setTargetAtTime(nextPreset === "warm" ? 2 : nextPreset === "broadcast" ? 1 : 0, now, 0.01);
    presence.gain.setTargetAtTime(nextPreset === "broadcast" ? 2.5 : nextPreset === "warm" ? 1.2 : 0, now, 0.01);
    makeup.gain.setTargetAtTime(Math.max(0, Math.min(1.35, nextGainValue / 82)), now, 0.01);
  }

  update(preset, gainValue);

  return {
    update,
    disconnect() {
      centered.disconnect();
      highPass.disconnect();
      warmth.disconnect();
      presence.disconnect();
      makeup.disconnect();
    }
  };
}

interface ActiveVoiceMonitor {
  audioContext: AudioContext;
  chain: ReturnType<typeof connectVoiceMonitorChain>;
}

function StudioControlButton({ tone, className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "record" }) {
  return (
    <button className={`studio-control-button ${tone ?? ""} ${className}`.trim()} type="button" {...props}>
      {children}
    </button>
  );
}
