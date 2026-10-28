import { AudioInterfaceQuickSetup } from "./AudioInterfaceQuickSetup";
import { AudioSignalDiagnostics } from "../services/audio-signal-diagnostics";
import { writeRuntimeDiagnostic } from "../services/runtime-diagnostics";
import { acquireStudioAudioContext, subscribeStudioMeter } from "../plugins/audio/shared-audio-engine";
import { recordingCaptureBytesPerSecond, type RecordingDriveCheck } from "../../shared/diagnostics";
import { getHardwareDeviceReadiness } from "../../shared/hardware-test";
import { microphoneSlots } from "../../shared/audio-tracks";
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
  Volume2,
  X
} from "lucide-react";
import type { CameraSlotKey, DeviceDefaults, MicrophoneInputChannel, MicrophoneSlotKey, RecordingPreferences } from "../../shared/types";
import { defaultRecordingPreferences } from "../../shared/types";
import { getDeviceAssignmentConflicts, getMicrophoneInputDisplay, getMicrophoneInputOptions, distinctAudioDeviceChoices, getMicrophoneRoutingIssue, microphoneRoutesOverlap, saveMicrophoneDeviceRoute } from "../../shared/device-config";
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
  episodeTitle?: string;
  defaults: DeviceDefaults;
  detection: DeviceDetectionResult;
  snapshot: RecordingServiceSnapshot;
  unfinishedSessions: RecordingSession[];
  podcastTools: PodcastToolsState;
  storageWarning?: string;
  availableBytes?: number;
  driveCheck?: RecordingDriveCheck;
  readinessMessage?: string;
  onCheckReadiness?: () => Promise<void>;
  onReconnectInputs?: () => Promise<void>;
  recordingPreferences?: RecordingPreferences;
  onStart: () => Promise<RecordingServiceSnapshot | void> | RecordingServiceSnapshot | void;
  onContinue?: () => Promise<void> | void;
  onNewEpisode?: () => Promise<void> | void;
  canContinueRecording?: boolean;
  onQuickTest?: () => Promise<void> | void;
  onResumeSession?: (session: RecordingSession) => Promise<void> | void;
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
  ...microphoneSlots,
  { key: "soundboard", label: "Soundboard" }, { key: "music", label: "Music" }
];
const routableMicSlots = microphoneSlots;

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
  episodeTitle,
  defaults,
  detection,
  snapshot,
  unfinishedSessions,
  podcastTools,
  storageWarning,
  availableBytes,
  driveCheck,
  readinessMessage,
  onCheckReadiness,
  onReconnectInputs,
  recordingPreferences: recordingPreferencesProp,
  onStart,
  onContinue,
  onNewEpisode,
  canContinueRecording,
  onQuickTest,
  onResumeSession,
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
  const [advancedAudio, setAdvancedAudio] = useState(false);
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const [recordingAction, setRecordingAction] = useState<RecordingAction>("idle");
  const [saveProgress, setSaveProgress] = useState("");
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  useEffect(() => window.studio?.onRecordingSaveProgress?.((event) => {
    if (event.episodeFolder === snapshot.session?.folderPath) setSaveProgress(`${event.message} · ${event.progress}%`);
  }), [snapshot.session?.folderPath]);

  const [micSignals, setMicSignals] = useState<Partial<Record<MicKey, MicSignalState>>>({});
  const [audioDiagnostics, setAudioDiagnostics] = useState<Partial<Record<MicKey, LiveInputDiagnostics>>>({});
  const [recoverySessionId, setRecoverySessionId] = useState<string | undefined>();
  const [mixerChannels, setMixerChannels] = useState<MixerChannelState>(() =>
    Object.fromEntries(micSlots.filter((slot) => !["mic4", "mic5", "mic6", "mic7", "mic8"].includes(slot.key) || Boolean(defaults.microphones[slot.key as MicKey])).map((slot) => [slot.key, { ...defaultMixerChannel }]))
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
  const isComplete = snapshot.status === "stopped" || Boolean(canContinueRecording && !isRecording && !isPaused);
  const hasMedia = Boolean(isComplete && snapshot.session);
  const canRetrySave = snapshot.status === "error" && Boolean(snapshot.session);
  const savingLocation = snapshot.session?.folderPath ?? "Session folder appears after Record starts";
  const cameraReadyCount = cameraSlots.filter((slot) => findDevice(detection.cameras, defaults.cameras[slot.key])).length;
  const storageReady = !storageWarning;
  const recordingInProgress = isRecording || isPaused;
  const inputChangesLocked = isRecording || recordingAction !== "idle";
  const recordingPreferences = { ...defaultRecordingPreferences, ...recordingPreferencesProp };
  const liveMode = isRecording && recordingPreferences.liveModeEnabled;
  const recordingHealthy = snapshot.status !== "error" && (!isRecording || Boolean(snapshot.health?.programActive));
  const routingIssue = getMicrophoneRoutingIssue(defaults);
  const deviceAssignmentsHealthy = getDeviceAssignmentConflicts(defaults).length === 0 && !routingIssue;
  const programMicSlot = defaults.cameraMicrophones?.camera1 ?? "morganMic";
  const programMicSignal = micSignals[programMicSlot];
  const programMicSelected = Boolean(findDevice(detection.microphones, defaults.microphones[programMicSlot]));
  const liveMicReadyCount = microphoneSlots.map(({ key }) => key).filter((key) => {
    if (!findDevice(detection.microphones, defaults.microphones[key as MicKey])) return false;
    const signal = micSignals[key as MicKey];
    return signal !== "no-signal" && signal !== "disconnected";
  }).length;
  const assignedDevices = getHardwareDeviceReadiness(defaults, [...detection.cameras.map((item) => ({ ...item, kind: "camera" as const })), ...detection.microphones.map((item) => ({ ...item, kind: "microphone" as const }))]);
  const invalidChannels = microphoneSlots.some(({ key }) => {
    const count = audioDiagnostics[key]?.channelCount;
    const channel = defaults.microphoneChannels?.[key] ?? "mix";
    return Boolean(defaults.microphones[key] && channel !== "mix" && count !== undefined && Number(channel.replace("input-", "")) > count);
  });
  const studioReady = !canRetrySave && !checkingReadiness && cameraReadyCount > 0 && storageReady && deviceAssignmentsHealthy && programMicSelected && assignedDevices.missingDeviceIds.length === 0 && !invalidChannels && (!recordingInProgress || recordingHealthy);
  const startBlockedReason = canRetrySave ? "Finish this take with Retry Save, or choose New Episode to start a separate recording."
    : checkingReadiness ? "Checking inputs and storage…"
    : !storageReady ? storageWarning
    : !deviceAssignmentsHealthy ? routingIssue ?? "Choose a separate physical input for each microphone channel."
    : assignedDevices.missingDeviceIds.length > 0 ? "An assigned camera or microphone is disconnected. Reconnect inputs or change the selection in Setup."
    : cameraReadyCount === 0 ? "Choose Camera 1 in Setup before recording."
    : !programMicSelected ? "Choose the microphone assigned to Camera 1 in Setup before recording."
    : invalidChannels ? "A selected microphone channel is unavailable. Choose a driver-visible input in Input and headphone controls."
    : undefined;
  const pendingBytes = snapshot.health?.sources.reduce((sum, source) => sum + (source.pendingBytes ?? 0), 0) ?? 0;
  const captureRate = recordingCaptureBytesPerSecond(Object.values(defaults.cameras).filter(Boolean).length, Object.values(defaults.microphones).filter(Boolean).length, defaults.captureQuality);
  const remainingMinutes = availableBytes === undefined ? undefined : Math.max(0, Math.floor((availableBytes - 2 * 1024 ** 3) / (captureRate * 3) / 60));
  const trackStatusBySlot = Object.fromEntries(snapshot.trackStatuses.map((status) => [status.slot, status]));
  const recoveryCandidates = unfinishedSessions.filter((session) => session.id !== snapshot.session?.id || snapshot.status === "idle" || snapshot.status === "error");
  const unhealthyRecordingSources = snapshot.health?.sources.filter((source) => !source.active) ?? [];
  const visibleCameraSlots = cameraSlots.filter((slot) => slot.key === "camera1" || Boolean(defaults.cameras[slot.key]));
  const visibleMicSlots = routableMicSlots.filter((slot) => slot.key === "morganMic" || Boolean(defaults.microphones[slot.key]));
  const visibleCameraLayouts = cameraLayouts.filter((layout) => {
    if (["host", "sponsor-card", "intro", "outro"].includes(layout.id)) return true;
    if (layout.id === "triple") return visibleCameraSlots.length >= 3;
    return visibleCameraSlots.length >= 2;
  });

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

  useEffect(() => {
    if (recordingInProgress || !defaults.microphones[programMicSlot] || programMicSignal !== "no-signal") return;
    setStudioNotice({
      tone: "needs-attention",
      message: `${getMicSlotLabel(programMicSlot)} has no measured signal. Speak into the selected input; check its numbered channel or use Reconnect inputs.`
    });
  }, [defaults.microphones, programMicSignal, programMicSlot, recordingInProgress]);

  useEffect(() => {
    if (!recordingInProgress) return;
    setMixerChannels((current) => {
      let changed = false;
      const next = Object.fromEntries(Object.entries(current).map(([slot, controls]) => {
        if (!controls.monitor) return [slot, controls];
        changed = true;
        return [slot, { ...controls, monitor: false }];
      }));
      return changed ? next : current;
    });
  }, [recordingInProgress]);

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
    const routed = saveMicrophoneDeviceRoute(defaults, slot, deviceId, selectedDevice?.rawLabel ?? selectedDevice?.label);
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

  async function pauseOrResume() {
    if (recordingAction !== "idle") return;
    setRecordingAction("saving");
    try {
      await (isComplete ? onContinue?.() : isPaused ? onResume() : onPause());
      setStudioNotice({ tone: "recording", message: isPaused || isComplete ? "Recording continues in this episode folder." : "Episode paused and saved. You can close the app and return later." });
    } catch (error) {
      setStudioNotice({ tone: "needs-attention", message: error instanceof Error ? error.message : "The episode needs attention before continuing." });
    } finally { setRecordingAction("idle"); }
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
      setStudioNotice({ tone: "ready", message: "Take saved. Resume adds to this episode; New Episode starts a separate folder." });
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
      const target = event.target;
      if (target instanceof Element && (target.closest('[role="dialog"][aria-modal="true"]') || target.matches("input, textarea, select, [contenteditable='true']"))) return;
      if (event.key === " " && target instanceof Element && target.closest("button, summary, a[href]")) return;
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (recordingInProgress) requestStop();
        else if (studioReady) void startStudioRecording();
        return;
      }
      if (!recordingInProgress) return;
      if (event.code === "Space") {
        event.preventDefault();
        void pauseOrResume();
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
    <section className={`live-studio ${liveMode ? "live-mode" : ""} ${advancedAudio ? "advanced-audio" : "simple-audio"}`} aria-label="Live recording studio">
      {recoveryCandidates.length > 0 && (
        <RippedPaperCard className="recovery-banner">
          <AlertTriangle size={28} />
          <div>
            <h3>Saved or interrupted episodes</h3>
            <p>Saved episodes can be resumed in the same folder. Interrupted captures can be recovered before review.</p>
          </div>
          <div className="recovery-actions">
            {recoveryCandidates.map((session) => (
              <div key={session.id}>
                <small>{session.episodeTitle} · {session.recoverableBytes ? `${Math.max(1, Math.round(session.recoverableBytes / 1024 / 1024))} MB protected` : "recovery data found"}</small>
                <RusticButton disabled={isRecording || recoverySessionId === session.id} onClick={async () => { setRecoverySessionId(session.id); try { if (session.durablePaused && session.status === "paused") await onResumeSession?.(session); else await onRecoverSession?.(session); } catch (error) { setStudioNotice({ tone: "needs-attention", message: error instanceof Error ? error.message : "This episode needs attention." }); } finally { setRecoverySessionId(undefined); } }}>{recoverySessionId === session.id ? "Opening..." : session.durablePaused && session.status === "paused" ? "Open Paused Episode" : "Recover Recording"}</RusticButton>
                <RusticButton onClick={() => onOpenSessionFolder?.(session)}>Open Folder</RusticButton>
              </div>
            ))}
            <RusticButton onClick={onDismissRecovery}>Dismiss</RusticButton>
          </div>
        </RippedPaperCard>
      )}

      <main className="live-studio-board reference-studio-board">
        <TornEdgeHeader
          title={snapshot.session?.episodeTitle ?? episodeTitle ?? "Untitled episode"}
          eyebrow={isRecording ? "Recording Live" : isPaused ? "Paused" : isComplete ? "Take Saved" : "Control Room"}
          aside={
            <div className="reference-header-actions">
              {onNewEpisode && <RusticButton disabled={recordingAction !== "idle"} onClick={async () => { setRecordingAction("saving"); try { await onNewEpisode(); } finally { setRecordingAction("idle"); } }}>New Episode</RusticButton>}
              <div className={`recording-timer ${isRecording ? "recording" : ""}`} aria-label="Recording timer">
                <span>{isRecording ? "Recording" : isPaused ? "Paused" : "Not Recording"}</span>
                <strong>{formatRecordingTime(snapshot.elapsedMs)}</strong>
              </div>
              <RusticButton
                className={layoutsOpen ? "selected" : ""}
                aria-expanded={layoutsOpen}
                onClick={() => {
                  setLayoutsOpen((current) => !current);
                  setStudioNotice({ tone: "ready", message: layoutsOpen ? "Camera layouts hidden." : "Choose a layout under the camera wall." });
                }}
              >
                <LayoutGrid size={16} /> {layoutsOpen ? "Hide Layouts" : "View Layouts"}
              </RusticButton>
              {!recordingInProgress && !isComplete && onQuickTest && (
                <RusticButton
                  className="studio-quick-test"
                  aria-label="Run 15 second setup test"
                  title="Run a short camera and microphone recording test"
                  disabled={!studioReady || recordingAction !== "idle"}
                  onClick={() => void Promise.resolve(onQuickTest()).catch((error) => setStudioNotice({ tone: "needs-attention", message: error instanceof Error ? error.message : "Setup test needs attention." }))}
                >
                  <Play size={16} /> <span>Setup Test</span>
                </RusticButton>
              )}
            </div>
          }
        />

        {(snapshot.friendlyError || storageWarning || studioNotice.message) && (
          <div className={`studio-notice ${snapshot.friendlyError ? "needs-attention" : studioNotice.tone}`}>
            <strong>{snapshot.friendlyError ? "Something needs a quick check" : studioNotice.message}</strong>
            <span>{snapshot.friendlyError ?? storageWarning ?? "Live checks are ready when your gear is."}</span>
          </div>
        )}

        <section className="recording-health-strip" aria-label="Recording readiness and live health">
          <details className="recording-check-details">
            <summary>Inputs & storage{remainingMinutes !== undefined ? ` · about ${remainingMinutes} min available` : ""}</summary>
            <p>{readinessMessage ?? "Check each assigned input before recording."}</p>
            {isRecording && <p>{(pendingBytes / 1024 / 1024).toFixed(1)} MB waiting for disk · {snapshot.health?.sources.filter((source) => !source.active).length ?? 0} sources need attention</p>}
            {driveCheck && <small>Short write test at {new Date(driveCheck.checkedAt).toLocaleTimeString()}</small>}
          </details>
          {inputChangesLocked && <span>Inputs are locked during capture. Pause before changing inputs; Resume uses your updated setup.</span>}

          {!recordingInProgress && startBlockedReason && <strong role="alert">{startBlockedReason}</strong>}
          {!inputChangesLocked && onReconnectInputs && <RusticButton onClick={async () => {
            setRecordingAction("starting");
            try { await onReconnectInputs(); }
            catch (error) { setStudioNotice({ tone: "needs-attention", message: error instanceof Error ? error.message : "Inputs could not reconnect. Check USB cables and permissions." }); }
            finally { setRecordingAction("idle"); }
          }}>Reconnect inputs</RusticButton>}
          {invalidChannels && <strong role="alert">A selected microphone input is not exposed by its driver.</strong>}
          {assignedDevices.missingDeviceIds.length > 0 && <strong role="alert">An assigned camera or microphone is disconnected.</strong>}
          {!recordingInProgress && onCheckReadiness && <RusticButton disabled={checkingReadiness || recordingAction !== "idle"} onClick={async () => { setCheckingReadiness(true); try { await onCheckReadiness(); } catch (error) { setStudioNotice({ tone: "needs-attention", message: error instanceof Error ? error.message : "Check your recording setup." }); } finally { setCheckingReadiness(false); } }}>{checkingReadiness ? "Checking inputs & drive…" : "Check inputs & drive"}</RusticButton>}
        </section>

        <section className="reference-workbench" aria-label="Studio command center">
          <div className="reference-main-column">
            <section className="camera-command-panel" aria-label="Camera previews and layouts">
              <section className="camera-strip" aria-label="Camera previews" data-camera-count={visibleCameraSlots.length}>
                {visibleCameraSlots.map((slot) => (
                  <CameraCard
                    key={slot.key}
                    label={slot.label}
                    device={findDevice(detection.cameras, defaults.cameras[slot.key])}
                    deviceId={defaults.cameras[slot.key]}
                    isRecording={isRecording}
                    inputChangesLocked={inputChangesLocked}
                    cameraSlot={slot.key}
                    micRoute={defaults.cameraMicrophones?.[slot.key] ?? fallbackCameraMicRoutes[slot.key]}
                    micRoutes={visibleMicSlots}
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

              {layoutsOpen ? <section className="layout-row secondary-tools" aria-label="Camera layouts">
                {visibleCameraLayouts.map((layout) => (
                  <RusticButton
                    className={podcastTools.cameraLayout === layout.id ? "selected" : ""}
                    key={layout.id}
                    onClick={() => selectLayout(layout.id)}
                  >
                    {layout.label}
                  </RusticButton>
                ))}
              </section> : null}
            </section>

            {isRecording && unhealthyRecordingSources.length > 0 && (
              <section className="live-source-health" aria-label="Live source recording health">
                {unhealthyRecordingSources.map((source) => (
                  <span className="needs-attention" key={source.target}>
                    <AlertTriangle size={16} />
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
                  <button className="audio-details-toggle" type="button" aria-expanded={advancedAudio} onClick={() => setAdvancedAudio(!advancedAudio)}>{advancedAudio ? "Hide advanced audio" : "Advanced audio settings"}</button>
                  <div className="monitor-row">
                    <label>
                      Output
                      <select disabled={inputChangesLocked} value={defaults.audioOutputId ?? ""} onChange={(event) => setOutput(event.target.value)}>
                        <option value="">System output</option>
                        {detection.speakers.map((speaker) => (
                          <option value={speaker.id} key={speaker.id}>{speaker.label}</option>
                        ))}
                      </select>
                    </label>
                    <span className="monitor-status" title="Software monitoring is available for setup checks and turns off during recording to prevent delayed doubling."><Headphones size={16} /> {recordingInProgress ? "Hardware monitor" : "Setup monitor"}</span>
                    <span className="headphone-warning" title="For true zero-delay monitoring, use the Direct Monitor control on your audio interface.">Use headphones. Hardware direct monitoring is zero-delay.</span>
                    <RusticButton title="Play a short tone through the selected output." onClick={() => void playTestSound()}>
                      <Volume2 size={16} /> Play Test Sound
                    </RusticButton>
                  </div>
                  <details className="record-interface-setup"><summary>Audio interface setup</summary>
                    <AudioInterfaceQuickSetup devices={detection.microphones} defaults={defaults} disabled={inputChangesLocked} onChange={onDefaultsChange} />
                  </details>
                  <div className="meter-list pro-tools-mixer">
                    {visibleMicSlots.map((slot) => {
                      const deviceId = defaults.microphones[slot.key];
                      const controls = mixerChannels[slot.key] ?? defaultMixerChannel;
                      const micKey = slot.key;
                      const displayLabel = defaults.microphoneNames?.[micKey] || slot.label;
                      return (
                        <LiveMicMeter
                          key={slot.key}
                          label={displayLabel}
                          roleLabel={getMicRoleLabel(micKey)}
                          deviceId={deviceId}
                          inputOptions={detection.microphones}
                          inputAssignments={defaults.microphones}
                          inputChannelAssignments={defaults.microphoneChannels}
                          micSlot={micKey}
                          selectedInputId={deviceId}
                          inputChannel={micKey ? defaults.microphoneChannels?.[micKey] ?? "mix" : "mix"}
                          outputLabel={outputLabel}
                          controls={controls}
                          monitorLabel={getMonitorLabel(slot.label)}
                          monitoring={controls.monitor && !controls.muted && (soloedChannels.length === 0 || soloedChannels.includes(slot.key))}
                          softwareMonitoringDisabled={recordingInProgress}
                          inputChangesLocked={inputChangesLocked}
                          outputDeviceId={defaults.audioOutputId}
                          fallbackLevel={0}
                          trackStatus={trackStatusBySlot[slot.key as RecordingTrackSlot]}
                          onInputChange={(deviceId) => setMicInput(micKey, deviceId)}
                          onInputChannelChange={(channel) => setMicInputChannel(micKey, channel)}
                          onNameChange={(name) => setMicName(micKey, name)}
                          onSignalChange={(signal) => updateMicSignal(micKey, signal)}
                          onDiagnosticsChange={(details) => setAudioDiagnostics((current) => ({ ...current, [micKey]: details }))}
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
                    slots={visibleMicSlots}
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

          <section className="giant-control-row" aria-label="Recording controls">
            <StudioControlButton
              tone="record"
              disabled={recordingInProgress || isComplete || !studioReady || recordingAction !== "idle"}
              onClick={() => void startStudioRecording()}
            >
              {recordingAction === "starting" ? <LoaderCircle className="control-spinner" size={28} /> : <Circle size={28} />}
              <span><strong>{recordingAction === "starting" ? "Starting" : "Record"}</strong><small>Start recording</small></span>
            </StudioControlButton>
            <StudioControlButton
              className="pause"
              disabled={(!recordingInProgress && !(isComplete && onContinue)) || recordingAction !== "idle"}
              onClick={() => void pauseOrResume()}
            >
              {isPaused || isComplete ? <Play size={28} /> : <Pause size={28} />}
              <span><strong>{isPaused || isComplete ? "Resume" : "Pause"}</strong><small>{isComplete ? "Continue this episode" : isPaused ? "Resume recording" : "Pause recording"}</small></span>
            </StudioControlButton>
            <StudioControlButton className="stop" disabled={(!recordingInProgress && !canRetrySave) || recordingAction !== "idle"} onClick={requestStop}>
              {recordingAction === "saving" ? <LoaderCircle className="control-spinner" size={28} /> : <Square size={28} />}
              <span><strong>{recordingAction === "saving" ? "Saving" : canRetrySave ? "Retry Save" : "Stop & Save"}</strong><small>{recordingAction === "saving" ? "Finalizing files" : canRetrySave ? "Finish this take" : "Stop recording"}</small></span>
            </StudioControlButton>
            <StudioControlButton className="auto-edit" disabled={!hasMedia || recordingAction !== "idle"} onClick={goAutoEdit}>
              <Sparkles size={28} />
              <span><strong>Auto Edit</strong><small>Smart first draft</small></span>
            </StudioControlButton>
            <StudioControlButton className="export" disabled={!hasMedia || recordingAction !== "idle"} onClick={goExport}>
              <Download size={28} />
              <span><strong>Export</strong><small>Export episode</small></span>
            </StudioControlButton>
          </section>

        </section>

        {isComplete && <p role="status" style={{ margin: "8px 0" }}>This take is saved. Resume adds more to this episode. New Episode saves this one and opens a separate episode folder.</p>}
        <ReadinessStrip
          cameraReadyCount={cameraReadyCount}
          micReadyCount={liveMicReadyCount}
          storageReady={storageReady}
          recordingHealthy={recordingHealthy}
          deviceAssignmentsHealthy={deviceAssignmentsHealthy}
          allCamerasReady={assignedDevices.cameraReady.every((ready) => ready !== false)}
          allMicrophonesReady={Object.values(assignedDevices.microphoneReady).every(Boolean) && !invalidChannels}
        />

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
          <span>{recordingAction === "saving" ? (saveProgress || "Verifying the program, each camera, each microphone, and the optional backup copy.") : `${snapshot.localSaveMessage}. Disk-first protection is on. Saving location: ${savingLocation}`}</span>
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
      && microphoneRoutesOverlap(channelAssignments?.[slot] ?? "mix", channel))?.[0];
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
  deviceAssignmentsHealthy,
  allCamerasReady,
  allMicrophonesReady
}: {
  cameraReadyCount: number;
  micReadyCount: number;
  storageReady: boolean;
  recordingHealthy: boolean;
  deviceAssignmentsHealthy: boolean;
  allCamerasReady: boolean;
  allMicrophonesReady: boolean;
}) {
  const items = [
    { label: cameraReadyCount > 0 && allCamerasReady ? "Cameras Ready" : "Cameras Need Attention", ready: cameraReadyCount > 0 && allCamerasReady },
    { label: micReadyCount > 0 && allMicrophonesReady ? "Microphones Ready" : "Microphones Need Attention", ready: micReadyCount > 0 && allMicrophonesReady },
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
  inputChangesLocked,
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
  inputChangesLocked: boolean;
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
          disabled={inputChangesLocked}
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
  const [previewHealth, setPreviewHealth] = useState<string>();

  useEffect(() => {
    let previousFrames = 0;
    let stalledSamples = 0;
    let lastPreviewLogAt = 0;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      const quality = video?.getVideoPlaybackQuality?.();
      if (!quality || !video?.srcObject) return;
      stalledSamples = quality.totalVideoFrames === previousFrames ? stalledSamples + 1 : 0;
      previousFrames = quality.totalVideoFrames;
      const track = (video.srcObject as MediaStream).getVideoTracks()[0];
      const settings = track?.getSettings?.();
      if (Date.now() - lastPreviewLogAt >= 15000) {
        lastPreviewLogAt = Date.now();
        writeRuntimeDiagnostic(stalledSamples >= 3 ? "warning" : "info", "CameraPreview", "Camera preview summary.", {
          label, deviceId, settings, totalFrames: quality.totalVideoFrames, droppedFrames: quality.droppedVideoFrames,
          stalledSeconds: stalledSamples, trackState: track?.readyState, muted: track?.muted });
      }
      if (stalledSamples >= 3) setPreviewHealth("Preview stalled — try Refresh preview");
      else if (quality.totalVideoFrames > 0) setPreviewHealth(`${settings?.width ?? "?"} × ${settings?.height ?? "?"} · ${Math.round(settings?.frameRate ?? 0)} fps · ${quality.droppedVideoFrames} preview frames skipped`);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [previewAttempt, deviceId, label]);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let canceled = false;
    let reconnectTimer: number | undefined;

    async function startPreview() {
      setPreviewHealth(undefined);
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
          // Ask Chromium to favor current frames instead of a playback buffer.
          const lowDelayVideo = videoRef.current as HTMLVideoElement & { latencyHint?: number };
          if ("latencyHint" in lowDelayVideo) lowDelayVideo.latencyHint = 0;
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
      const video = videoRef.current;
      if (video && stream && video.srcObject === stream) {
        video.pause();
        video.srcObject = null;
      }
      if (stream) onReleaseCameraPreview(deviceId, stream);
    };
  }, [deviceId, onOpenCameraPreview, onPreviewState, onReleaseCameraPreview, previewAttempt]);

  return (
    <div className={`live-video-frame ${state}`}>
      <video ref={videoRef} muted playsInline aria-label={`${label} live preview`} />
      {deviceId && <button type="button" className="refresh-camera-preview" aria-label={`Refresh ${label} preview`} title="Reconnect this on-screen preview. Recording continues." onClick={() => setPreviewAttempt((attempt) => attempt + 1)}>Refresh preview</button>}
      {state === "live" && previewHealth && <small className="preview-frame-health" title="This measures the on-screen preview, not encoded recording frames.">{previewHealth}</small>}
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
  softwareMonitoringDisabled,
  inputChangesLocked,
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
  softwareMonitoringDisabled: boolean;
  inputChangesLocked: boolean;
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
  const monitoringRef = useRef(monitoring);
  const lastPublishedSignalRef = useRef<MicSignalState | undefined>(undefined);
  const lastDiagnosticsPublishAtRef = useRef(0);
  const [level, setLevel] = useState(fallbackLevel ?? 0);
  const [peakLevel, setPeakLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const [signalState, setSignalState] = useState<MicSignalState>(deviceId ? "checking" : "disconnected");
  const [routeIssue, setRouteIssue] = useState<string | undefined>();
  const [monitorIssue, setMonitorIssue] = useState<string | undefined>();
  const inputDisplay = getMicrophoneInputDisplay(inputChannel);
  const [activeChannelCount, setActiveChannelCount] = useState<number>();
  const selectedDevice = inputOptions.find((device) => device.id === selectedInputId);
  const inputChannelOptions = getMicrophoneInputOptions(selectedDevice?.rawLabel ?? selectedDevice?.label, activeChannelCount, Object.entries(inputAssignments).some(([slot, id]) => slot !== micSlot && id === selectedInputId && Boolean(id)));
  const savedChannelAvailable = inputChannelOptions.some((option) => option.value === inputChannel);

  controlsRef.current = controls;
  outputDeviceIdRef.current = outputDeviceId;
  onSignalChangeRef.current = onSignalChange;
  onDiagnosticsChangeRef.current = onDiagnosticsChange;
  monitoringRef.current = monitoring;

  function publishSignal(signal: MicSignalState, diagnostics?: AudioStreamDiagnostics, rms = level, peak = peakLevel, trackState?: MediaStreamTrackState) {
    const signalChanged = lastPublishedSignalRef.current !== signal;
    if (signalChanged) {
      lastPublishedSignalRef.current = signal;
      setSignalState(signal);
      onSignalChangeRef.current?.(signal);
    }

    const now = Date.now();
    if (diagnostics && (signalChanged || now - lastDiagnosticsPublishAtRef.current >= 500)) {
      lastDiagnosticsPublishAtRef.current = now;
      onDiagnosticsChangeRef.current?.({ ...diagnostics, signal, rms, peak, trackState });
    }
  }

  const stopMonitorPlayback = useCallback(() => {
    monitorRequestRef.current += 1;
    const graph = monitorGraphRef.current;
    monitorGraphRef.current = undefined;
    graph?.chain.disconnect();
    graph?.release();
  }, []);

  const startMonitorPlayback = useCallback(async (stream = streamRef.current) => {
    if (!stream) {
      setMonitorIssue(deviceId ? "Starting monitor..." : "Pick input first");
      return;
    }

    let pendingLease: ReturnType<typeof acquireStudioAudioContext> | undefined;
    try {
      const currentControls = controlsRef.current;
      stopMonitorPlayback();
      const requestId = monitorRequestRef.current;
      const lease = acquireStudioAudioContext(getAudioStreamDiagnostics(stream).sampleRate, outputDeviceIdRef.current);
      const audioContext = lease.context;
      pendingLease = lease;
      const sinkableContext = audioContext as AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };
      const source = audioContext.createMediaStreamSource(stream);

      if (outputDeviceIdRef.current && sinkableContext.setSinkId) {
        await sinkableContext.setSinkId(outputDeviceIdRef.current);
      }

      const chain = connectVoiceMonitorChain(audioContext, source, audioContext.destination, currentControls.voicePreset, currentControls.gain, inputChannel);

      if (monitorRequestRef.current !== requestId) {
        chain.disconnect();
        lease.release();
        return;
      }

      monitorGraphRef.current = { audioContext, chain, release: lease.release };
      pendingLease = undefined;
      await audioContext.resume();
      onEchoWarning();
      setMonitorIssue(undefined);
    } catch {
      pendingLease?.release();
      stopMonitorPlayback();
      setMonitorIssue("Click again or pick headphones");
    }
  }, [deviceId, inputChannel, onEchoWarning, stopMonitorPlayback]);

  function toggleMonitor() {
    if (softwareMonitoringDisabled) return;
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
    let stopMeter: (() => void) | undefined;
    let meterLease: ReturnType<typeof acquireStudioAudioContext> | undefined;
    let centeredMeterSource: ReturnType<typeof connectInputChannelSource> | undefined;
    let meterSilence: GainNode | undefined;
    let canceled = false;
    let lastSignalAt = 0;
    const startedAt = Date.now();
    let meterStreamDiagnostics: AudioStreamDiagnostics | undefined;
    const meterContext = () => ({ label, micSlot, deviceId, inputChannel, measurementPoint: "selected-input-meter",
      meterTrim: inputChannel === "mix" ? 1 : 0.95, audioContextState: audioContext?.state,
      trackState: stream?.getAudioTracks()[0]?.readyState, sourceMuted: stream?.getAudioTracks()[0]?.muted,
      diagnostics: meterStreamDiagnostics,
      headphoneGainPercent: controlsRef.current.gain, headphonesMuted: controlsRef.current.muted,
      voicePreset: controlsRef.current.voicePreset, softwareHear: monitoringRef.current });
    const signalDiagnostics = new AudioSignalDiagnostics((summary) => writeRuntimeDiagnostic("info", "AudioSignal", "Audio input signal summary.", { ...meterContext(), ...summary }),
      () => performance.now(), inputChannel === "mix" ? 0.98 : 0.931);

    async function startMeter() {
      try {
        setActiveChannelCount(undefined);
        stream = await onOpenMicrophoneStream(deviceId);
        if (canceled) {
          onReleaseMicrophoneStream(deviceId, stream);
          return;
        }
        streamRef.current = stream;
        const track = stream.getAudioTracks()[0];
        const diagnostics = getAudioStreamDiagnostics(stream);
        meterStreamDiagnostics = diagnostics;
        setActiveChannelCount(diagnostics.channelCount);
        setRouteIssue(undefined);
        if (track && typeof track.addEventListener === "function") {
          track.addEventListener("ended", () => {
            publishSignal("disconnected", diagnostics, 0, 0, "ended");
            writeRuntimeDiagnostic("warning", "AudioSignal", "Microphone track ended.", meterContext());
          }, { once: true });
        }
        meterLease = acquireStudioAudioContext(diagnostics.sampleRate);
        audioContext = meterLease.context;
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        const source = audioContext.createMediaStreamSource(stream);
        const samples = new Uint8Array(analyser.fftSize);
        const preciseSamples = new Float32Array(analyser.fftSize);
        centeredMeterSource = connectInputChannelSource(audioContext, source, inputChannel, diagnostics.channelCount);
        centeredMeterSource.output.connect(analyser);
        // Keep the meter graph rendering without sending mic audio to speakers.
        meterSilence = audioContext.createGain();
        meterSilence.gain.value = 0;
        analyser.connect(meterSilence).connect(audioContext.destination);
        await audioContext.resume();
        writeRuntimeDiagnostic("info", "AudioSignal", "Microphone meter opened.", meterContext());
        if (monitoringRef.current && !controlsRef.current.muted) void startMonitorPlayback(stream);

        const tick = () => {
          if (canceled) return;
          analyser.getByteTimeDomainData(samples);
          const measured = calculateAudioLevel(samples);
          const nextLevel = measured.rms;
          const nextPeak = measured.peak;
          analyser.getFloatTimeDomainData(preciseSamples);
          signalDiagnostics.observe(preciseSamples);
          const hasSignal = preciseSamples.some((sample) => Math.abs(sample) > 0.0003);
          if (hasSignal) lastSignalAt = Date.now();
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
        };

        tick();
        stopMeter = subscribeStudioMeter(tick);
      } catch (error) {
        setLevel(0);
        setPeakLevel(0);
        setHeard(false);
        writeRuntimeDiagnostic("error", "AudioSignal", "Microphone meter failed to open.", { ...meterContext(), error });
        const message = String(error);
        setRouteIssue(message.includes("input channel") ? message.replace(/^Error:\s*/, "") : "Could not open this input. Check the cable and Retry Devices.");
        publishSignal(deviceId ? "checking" : "disconnected", meterStreamDiagnostics, 0, 0);
      }
    }

    void startMeter();

    return () => {
      canceled = true;
      stopMeter?.();
      signalDiagnostics.flush();
      if (streamRef.current === stream) streamRef.current = undefined;
      stopMonitorPlayback();
      if (stream) onReleaseMicrophoneStream(deviceId, stream);
      centeredMeterSource?.disconnect();
      meterSilence?.disconnect();
      meterLease?.release();
    };
  }, [deviceId, fallbackLevel, inputChannel, onOpenMicrophoneStream, onReleaseMicrophoneStream, startMonitorPlayback, stopMonitorPlayback]);

  useEffect(() => {
    if (softwareMonitoringDisabled || !monitoring || controls.muted) {
      stopMonitorPlayback();
      return;
    }

    void startMonitorPlayback();
  }, [controls.muted, deviceId, inputChannel, monitoring, outputDeviceId, softwareMonitoringDisabled, startMonitorPlayback, stopMonitorPlayback]);

  useEffect(() => {
    monitorGraphRef.current?.chain.update(controls.voicePreset, controls.gain);
  }, [controls.gain, controls.voicePreset]);

  const copy = routeIssue
    ? "Needs attention"
    : fallbackLabel
    ?? (signalState === "clipping" ? "CLIPPING" : signalState === "active" ? "ACTIVE" : signalState === "quiet" ? "CONNECTED / QUIET" : signalState === "no-signal" ? "NO SIGNAL" : signalState === "disconnected" ? "DISCONNECTED" : "CHECKING");

  return (
    <article className={`live-meter-card ${heard ? "heard" : "quiet"}`}>
      <div className="channel-topline">
        <strong>{label}{roleLabel ? <small>{roleLabel}</small> : null}</strong>
        <span>{copy}{controls.muted ? " / HEADPHONES MUTED" : ""}</span>
      </div>
      {routeIssue ? <small className="input-route-warning">{routeIssue}</small> : null}
      {trackStatus && <TrackSavePill status={trackStatus} />}
      <DistressedMeter level={level} label={label} />
      <div className="visible-input-routing">
        {onInputChange && (
          <label className="channel-input-control" title="Choose which physical mic feeds this mixer channel.">
            <span className="control-caption">Audio device</span>
            <select disabled={inputChangesLocked} aria-label={`${label} input`} value={selectedInputId ?? ""} onChange={(event) => onInputChange(event.target.value)}>
              <option value="">Pick input</option>
              {distinctAudioDeviceChoices(inputOptions, selectedInputId).map((device) => {
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
          <label className="channel-route-control" title="Each numbered mono input records a separate microphone track.">
            <span className="control-caption">Track input</span>
            <select disabled={inputChangesLocked} aria-label={`${label} interface channel`} value={inputChannel} onChange={(event) => onInputChannelChange(event.target.value as MicrophoneInputChannel)}>
              {!savedChannelAvailable ? <option value={inputChannel} disabled>{inputDisplay.short} · choose an available input</option> : null}
              {inputChannelOptions.map((option) => <option value={option.value} key={option.value}
                disabled={option.value !== inputChannel && Boolean(findAssignedMicSlot(inputAssignments, inputChannelAssignments, selectedInputId, option.value, micSlot))}>{option.label}</option>)}
            </select>
            <span className={`physical-input-assignment compact ${inputChannel === "mix" ? "automatic" : "routed"}`}>
              <strong>{inputDisplay.short}</strong>
              <b>{inputChannel === "mix" ? "Combined" : `Feeds ${label}`}</b>
            </span>
          </label>
        )}
      </div>
      <details className="channel-advanced"><summary>Input and headphone controls</summary><div className="channel-console">
        {onNameChange && (
          <label className="channel-name-control" title="This name is saved with the episode and its separate audio track.">
            <span className="control-caption">Name</span>
            <input disabled={inputChangesLocked} aria-label={`${roleLabel ?? label} name`} value={label} onChange={(event) => onNameChange(event.target.value)} />
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
        <label className="channel-volume-control" title="Controls this channel's headphone monitoring level. Recording level and the live input meter are unchanged.">
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
            <button disabled={softwareMonitoringDisabled} title={softwareMonitoringDisabled ? "Software monitoring is off while recording. Use the interface Direct Monitor control." : `${monitorLabel} through headphones`} className={controls.monitor ? "selected" : ""} type="button" onClick={toggleMonitor}>
              <Headphones size={14} /> <span>Hear</span> <strong>{controls.monitor && !controls.muted ? "On" : "Off"}</strong>
            </button>
          </Tooltip>
        </div>
        <small className={`monitor-feedback ${monitoring && !monitorIssue ? "on" : monitorIssue ? "needs-attention" : ""}`}>
          {softwareMonitoringDisabled ? "Hardware Direct Monitor prevents headphone echo" : monitorIssue ?? (monitoring ? `${monitorLabel} On -> ${outputLabel}` : `${monitorLabel} Off`)}
        </small>
        <small className={peakLevel >= 98 ? "peak hot" : "peak"}>Peak {peakLevel}%{peakLevel >= 98 ? " - CLIPPING" : ""}</small>
      </div></details>
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
  diagnostics,
  slots
}: {
  permissionNeeded: boolean;
  microphones: StudioDevice[];
  defaults: DeviceDefaults;
  diagnostics: Partial<Record<MicKey, LiveInputDiagnostics>>;
  slots: Array<{ key: MicKey; label: string }>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="audio-diagnostics">
      <button className="audio-diagnostics-trigger" type="button" aria-expanded={open} onClick={() => setOpen(true)}>
        <SlidersHorizontal size={14} /> Audio Diagnostics
      </button>
      {open ? (
        <section className="audio-diagnostics-dialog" role="dialog" aria-modal="false" aria-label="Audio diagnostics">
          <header>
            <div>
              <strong>Audio Diagnostics</strong>
              <small>Live device and signal details</small>
            </div>
            <Tooltip label="Close audio diagnostics">
              <button type="button" aria-label="Close audio diagnostics" onClick={() => setOpen(false)}><X size={17} /></button>
            </Tooltip>
          </header>
          <div className="audio-diagnostics-grid">
            <span><strong>Microphone permission</strong>{permissionNeeded ? "Permission needed" : "Granted"}</span>
            <span><strong>Detected audio inputs</strong>{microphones.length || "None"}</span>
            {slots.map((slot) => {
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
        </section>
      ) : null}
    </div>
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
  release: () => void;
  chain: ReturnType<typeof connectVoiceMonitorChain>;
}

function StudioControlButton({ tone, className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "record" }) {
  return (
    <button className={`studio-control-button ${tone ?? ""} ${className}`.trim()} type="button" {...props}>
      {children}
    </button>
  );
}
