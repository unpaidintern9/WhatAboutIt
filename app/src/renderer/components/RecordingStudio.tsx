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
import type { CameraSlotKey, DeviceDefaults, MicrophoneSlotKey } from "../../shared/types";
import type { RecordingSession, RecordingTrackSaveResult, RecordingTrackSlot } from "../../shared/recording";
import type { CameraLayout, PodcastToolsState, SoundSlot } from "../../shared/podcast-tools";
import { cameraLayouts, createLiveMarker, markerButtons } from "../../shared/podcast-tools";
import type { StudioDisplayInfo, StudioPanelId } from "../../shared/studio-workspace";
import type { DeviceDetectionResult, StudioDevice } from "../plugins/devices/types";
import type { RecordingServiceSnapshot } from "../services";
import { formatRecordingTime } from "../services";
import { Button } from ".";
import { StudioToolPanels } from "./StudioToolPanels";

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
type MixerChannelState = Record<string, { gain: number; muted: boolean; solo: boolean; monitor: boolean }>;

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
  const [mixerChannels, setMixerChannels] = useState<MixerChannelState>(() =>
    Object.fromEntries(micSlots.map((slot) => [slot.key, { gain: 75, muted: false, solo: false, monitor: false }]))
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const markerTimerRef = useRef<number | undefined>(undefined);
  const notesTimerRef = useRef<number | undefined>(undefined);
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
  const hasMedia = Boolean(isComplete || snapshot.session);
  const savingLocation = snapshot.session?.folderPath ?? "Session folder appears after Record starts";
  const cameraReadyCount = cameraSlots.filter((slot) => findDevice(detection.cameras, defaults.cameras[slot.key])).length;
  const micReadyCount = ["morganMic", "guestMic", "extraMic"].filter((key) => findDevice(detection.microphones, defaults.microphones[key as MicKey])).length;
  const storageReady = !storageWarning;
  const recordingHealthy = !snapshot.friendlyError && snapshot.status !== "error";
  const studioReady = cameraReadyCount > 0 && micReadyCount > 0 && storageReady && recordingHealthy;
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
    onDefaultsChange({
      ...defaults,
      microphones: {
        ...defaults.microphones,
        [slot]: deviceId || undefined
      }
    });
  }

  function setCameraMicRoute(slot: CameraKey, micSlot: MicKey) {
    onDefaultsChange({
      ...defaults,
      cameraMicrophones: {
        ...fallbackCameraMicRoutes,
        ...defaults.cameraMicrophones,
        [slot]: micSlot
      }
    });
  }

  function patchMixerChannel(key: string, nextState: Partial<MixerChannelState[string]>) {
    setMixerChannels((current) => ({
      ...current,
      [key]: { ...(current[key] ?? { gain: 75, muted: false, solo: false, monitor: false }), ...nextState }
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

      <main className="live-studio-board reference-studio-board">
        <TornEdgeHeader
          title={snapshot.session?.episodeTitle ?? "Episode 047  •  Real Talk. No Filter."}
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
                    <span className="monitor-status"><Headphones size={16} /> Monitoring starts Off</span>
                    <span className="headphone-warning">Use headphones to avoid echo.</span>
                    <RusticButton onClick={() => void playTestSound()}>
                      <Volume2 size={16} /> Play Test Sound
                    </RusticButton>
                  </div>
                  <div className="meter-list pro-tools-mixer">
                    {micSlots.map((slot) => {
                      const deviceId = slot.key === "soundboard" || slot.key === "music" ? undefined : defaults.microphones[slot.key];
                      const label = slot.key === "soundboard" && playingSlotId ? "We hear you" : slot.key === "music" ? "Add music first" : undefined;
                      const controls = mixerChannels[slot.key] ?? { gain: 75, muted: false, solo: false, monitor: false };
                      const isMicChannel = slot.key !== "soundboard" && slot.key !== "music";
                      const micKey = isMicChannel ? slot.key as MicKey : undefined;
                      return (
                        <LiveMicMeter
                          key={slot.key}
                          label={slot.label}
                          deviceId={deviceId}
                          inputOptions={isMicChannel ? detection.microphones : []}
                          selectedInputId={deviceId}
                          outputLabel={outputLabel}
                          controls={controls}
                          monitorLabel={getMonitorLabel(slot.label)}
                          monitoring={controls.monitor && !controls.muted && (soloedChannels.length === 0 || soloedChannels.includes(slot.key))}
                          outputDeviceId={defaults.audioOutputId}
                          fallbackLevel={slot.key === "soundboard" && playingSlotId ? 72 : 0}
                          fallbackLabel={label}
                          trackStatus={trackStatusBySlot[slot.key as RecordingTrackSlot]}
                          onInputChange={micKey ? (deviceId) => setMicInput(micKey, deviceId) : undefined}
                          onControlsChange={(nextState) => patchMixerChannel(slot.key, nextState)}
                          onEchoWarning={warnAboutEcho}
                          onOpenMicrophoneStream={onOpenMicrophoneStream}
                          onReleaseMicrophoneStream={onReleaseMicrophoneStream}
                        />
                      );
                    })}
                  </div>
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
        />

        <section className={`studio-ready-summary ${studioReady ? "ready" : "needs-attention"}`} aria-label="Studio Ready summary">
          <strong>{studioReady ? "Studio Ready" : "Almost Ready"}</strong>
          <span>{cameraReadyCount > 0 ? "Cameras ready" : "Pick a camera first"}</span>
          <span>{micReadyCount > 0 ? "Mics ready" : "Pick Morgan Mic"}</span>
          <span>{storageReady ? "Storage good" : "Storage needs attention"}</span>
          <span>{studioReady ? "Ready to record" : "Check the items above"}</span>
        </section>

        <section className="giant-control-row" aria-label="Recording controls">
          <StudioControlButton tone="record" disabled={isRecording || isPaused} onClick={() => void onStart()}>
            <Circle size={28} /> Record
          </StudioControlButton>
          {isPaused ? (
            <StudioControlButton onClick={() => void onResume()}>
              <Play size={28} /> Resume
            </StudioControlButton>
          ) : (
            <StudioControlButton disabled={!isRecording} onClick={() => void onPause()}>
              <Pause size={28} /> Pause
            </StudioControlButton>
          )}
          <StudioControlButton disabled={!isRecording && !isPaused} onClick={() => void onStop()}>
            <Square size={28} /> Stop
          </StudioControlButton>
          <StudioControlButton onClick={goAutoEdit}>
            <Sparkles size={28} /> Auto Edit
          </StudioControlButton>
          <StudioControlButton onClick={goExport}>
            <Download size={28} /> Export
          </StudioControlButton>
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

        <div className="local-save-note live">
          <Save size={20} />
          <span>{isRecording ? "Recording. Saving. Auto Save on." : snapshot.localSaveMessage}. Saving location: {savingLocation}</span>
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
  recordingHealthy
}: {
  cameraReadyCount: number;
  micReadyCount: number;
  storageReady: boolean;
  recordingHealthy: boolean;
}) {
  const items = [
    { label: cameraReadyCount > 0 ? "Cameras Ready" : "Cameras Need Attention", ready: cameraReadyCount > 0 },
    { label: micReadyCount > 0 ? "Microphones Ready" : "Microphones Need Attention", ready: micReadyCount > 0 },
    { label: storageReady ? "Storage Available" : "Storage Needs Attention", ready: storageReady },
    { label: recordingHealthy ? "Recording Healthy" : "Recording Needs Attention", ready: recordingHealthy }
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
          {micRoutes.map((route) => (
            <option value={route.key} key={`${cameraSlot}-${route.key}`}>{route.label}</option>
          ))}
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
        if (canceled) {
          onReleaseCameraPreview(deviceId, stream);
          return;
        }
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
      if (stream) onReleaseCameraPreview(deviceId, stream);
    };
  }, [deviceId, onOpenCameraPreview, onPreviewState, onReleaseCameraPreview]);

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
  return "busy";
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
  deviceId,
  inputOptions,
  selectedInputId,
  outputLabel,
  controls,
  monitorLabel,
  monitoring,
  outputDeviceId,
  fallbackLevel,
  fallbackLabel,
  trackStatus,
  onInputChange,
  onControlsChange,
  onEchoWarning,
  onOpenMicrophoneStream,
  onReleaseMicrophoneStream
}: {
  label: string;
  deviceId?: string;
  inputOptions: StudioDevice[];
  selectedInputId?: string;
  outputLabel: string;
  controls: { gain: number; muted: boolean; solo: boolean; monitor: boolean };
  monitorLabel: string;
  monitoring: boolean;
  outputDeviceId?: string;
  fallbackLevel?: number;
  fallbackLabel?: string;
  trackStatus?: RecordingTrackSaveResult;
  onInputChange?: (deviceId: string) => void;
  onControlsChange: (nextState: Partial<{ gain: number; muted: boolean; solo: boolean; monitor: boolean }>) => void;
  onEchoWarning: () => void;
  onOpenMicrophoneStream: (deviceId?: string) => Promise<MediaStream>;
  onReleaseMicrophoneStream: (deviceId?: string, stream?: MediaStream) => void;
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
        if (canceled) {
          onReleaseMicrophoneStream(deviceId, stream);
          return;
        }
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
          const nextLevel = controls.muted ? 0 : Math.min(100, Math.round(volume * 4 * (controls.gain / 75)));
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
      if (stream) onReleaseMicrophoneStream(deviceId, stream);
      void audioContext?.close();
    };
  }, [controls.gain, controls.muted, deviceId, fallbackLevel, monitoring, onEchoWarning, onOpenMicrophoneStream, onReleaseMicrophoneStream, outputDeviceId]);

  const visibleLevel = controls.muted ? 0 : level;
  const copy = controls.muted ? "Muted" : fallbackLabel ?? (heard ? "Healthy" : "We can't hear you yet");

  return (
    <article className={`live-meter-card ${heard && !controls.muted ? "heard" : "quiet"}`}>
      <div className="channel-topline">
        <strong>{label}</strong>
        <span>{copy}</span>
      </div>
      {trackStatus && <TrackSavePill status={trackStatus} />}
      <DistressedMeter level={visibleLevel} label={label} />
      <div className="channel-console">
        {onInputChange && (
          <label>
            Input
            <select aria-label={`${label} input`} value={selectedInputId ?? ""} onChange={(event) => onInputChange(event.target.value)}>
              <option value="">Pick input</option>
              {inputOptions.map((device) => (
                <option value={device.id} key={device.id}>{device.label}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          Volume
          <input
            aria-label={`${label} gain`}
            type="range"
            min="0"
            max="100"
            value={controls.gain}
            onChange={(event) => onControlsChange({ gain: Number(event.target.value) })}
          />
        </label>
        <span className="channel-output">Output <strong>{outputLabel}</strong></span>
        <div className="channel-buttons">
          <button className={controls.muted ? "selected" : ""} type="button" onClick={() => onControlsChange({ muted: !controls.muted })}>
            <VolumeX size={14} /> Mute
          </button>
          <button className={controls.solo ? "selected" : ""} type="button" onClick={() => onControlsChange({ solo: !controls.solo })}>
            <SlidersHorizontal size={14} /> Solo
          </button>
          <button className={controls.monitor ? "selected" : ""} type="button" onClick={() => onControlsChange({ monitor: !controls.monitor })}>
            <Headphones size={14} /> {monitorLabel} <strong>{controls.monitor && !controls.muted ? "On" : "Off"}</strong>
          </button>
        </div>
        <small className={visibleLevel > 82 ? "peak hot" : "peak"}>Peak {visibleLevel}%</small>
      </div>
      <audio ref={audioRef} muted={!monitoring} />
    </article>
  );
}

function TrackSavePill({ status }: { status: RecordingTrackSaveResult }) {
  const label = status.status === "saved" ? "Saved" : status.status === "needs-attention" ? "Needs Attention" : "Preview only";
  return <span className={`track-save-pill ${status.status}`}>{label}</span>;
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

function StudioControlButton({ tone, className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "record" }) {
  return (
    <button className={`studio-control-button ${tone ?? ""} ${className}`.trim()} type="button" {...props}>
      {children}
    </button>
  );
}
