import { AlertTriangle, ArrowRight, Camera, CheckCircle2, Circle, Mic2, Pause, Play, RotateCcw, Save, Square } from "lucide-react";
import type { DeviceDefaults } from "../../shared/types";
import type { RecordingSession } from "../../shared/recording";
import type { PodcastToolsState } from "../../shared/podcast-tools";
import { AudioMeter, Button, CameraPreview, PodcastToolsPanel } from ".";
import type { RecordingServiceSnapshot } from "../services";
import { formatRecordingTime } from "../services";

interface RecordingStudioProps {
  defaults: DeviceDefaults;
  snapshot: RecordingServiceSnapshot;
  unfinishedSessions: RecordingSession[];
  podcastTools: PodcastToolsState;
  storageWarning?: string;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onPractice: () => void;
  onDismissRecovery: () => void;
  onNext: () => void;
  onPodcastToolsChange: (state: PodcastToolsState) => void;
  onPopOutTeleprompter: () => void;
}

const cameraSlots = [
  ["camera1", "Camera 1"],
  ["camera2", "Camera 2"],
  ["camera3", "Camera 3"]
] as const;

const micSlots = [
  ["morganMic", "Morgan Mic"],
  ["guestMic", "Guest Mic"],
  ["extraMic", "Extra Mic"]
] as const;

export function RecordingStudio({
  defaults,
  snapshot,
  unfinishedSessions,
  podcastTools,
  storageWarning,
  onStart,
  onPause,
  onResume,
  onStop,
  onPractice,
  onDismissRecovery,
  onNext,
  onPodcastToolsChange,
  onPopOutTeleprompter
}: RecordingStudioProps) {
  const isRecording = snapshot.status === "recording";
  const isPaused = snapshot.status === "paused";
  const isComplete = snapshot.status === "stopped";

  return (
    <section className="recording-studio">
      {unfinishedSessions.length > 0 && (
        <div className="recovery-banner">
          <AlertTriangle size={28} />
          <div>
            <h3>We found an unfinished recording</h3>
            <p>Your raw files stay right where they are. Open the session folder before recording again.</p>
          </div>
          <Button variant="secondary" onClick={onDismissRecovery}>Got it</Button>
        </div>
      )}

      <div className="recording-hero">
        <div>
          <p className="signature">{isComplete ? "Recording Complete" : isRecording ? "Recording Started" : "Everything is saving locally"}</p>
          <h2>{isComplete ? "Recording Complete" : "Recording Room"}</h2>
          <p className="soft-copy">
            {isComplete
              ? "Nice work. Your episode is safely stored on this computer."
              : isRecording
              ? "Relax. Everything is saving safely to your computer."
              : "Record with your selected studio setup. The heavy lifting stays tucked away so you can focus on the show."}
          </p>
        </div>
        <div className="recording-timer" aria-label="Recording timer">
          <span>{snapshot.status}</span>
          <strong>{formatRecordingTime(snapshot.elapsedMs)}</strong>
        </div>
      </div>

      {snapshot.friendlyError && (
        <div className="friendly-state">
          <strong>Something needs a quick check</strong>
          <p>{snapshot.friendlyError}</p>
        </div>
      )}

      {storageWarning && (
        <div className="friendly-state">
          <strong>Storage space warning</strong>
          <p>{storageWarning}</p>
        </div>
      )}

      {isComplete && (
        <div className="recording-complete-card">
          <CheckCircle2 size={34} />
          <div>
            <h3>Nice work!</h3>
            <p>Your episode is safely stored. Next step: review your markers and timeline.</p>
          </div>
          <Button variant="primary" icon={<ArrowRight size={20} />} onClick={onNext}>Review Episode</Button>
        </div>
      )}

      <div className="recording-controls">
        <Button variant="primary" icon={<Circle size={22} />} disabled={isRecording || isPaused} onClick={onStart}>
          Record
        </Button>
        <Button variant="secondary" icon={<Pause size={22} />} disabled={!isRecording} onClick={onPause}>
          Pause
        </Button>
        <Button variant="secondary" icon={<Play size={22} />} disabled={!isPaused} onClick={onResume}>
          Resume
        </Button>
        <Button variant="secondary" icon={<Square size={22} />} disabled={!isRecording && !isPaused} onClick={onStop}>
          Stop
        </Button>
        <Button variant="secondary" icon={<RotateCcw size={22} />} disabled={isRecording || isPaused} onClick={onPractice}>
          Practice
        </Button>
      </div>

      <div className="local-save-note">
        <Save size={20} />
        <span>{snapshot.localSaveMessage}. Raw recordings are never deleted automatically.</span>
      </div>

      <div className="recording-status-grid">
        <div className="panel">
          <div className="panel-heading">
            <h3>Preview area</h3>
            <Camera size={22} />
          </div>
          <div className="device-slot-grid">
            {cameraSlots.map(([key, label]) => (
              <article className="device-slot" key={key}>
                <h4>{label}</h4>
                <CameraPreview label={label} />
                <p>{defaults.cameras[key] ? "Ready" : "Not picked yet"}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h3>Mic status</h3>
            <Mic2 size={22} />
          </div>
          <div className="mic-status-list">
            {micSlots.map(([key, label]) => (
              <article className="mic-status-card" key={key}>
                <h4>{label}</h4>
                <p>{defaults.microphones[key] ? "Ready" : "Not picked yet"}</p>
                <AudioMeter label={label} level={defaults.microphones[key] ? 24 : 0} />
              </article>
            ))}
          </div>
        </div>
      </div>

      <PodcastToolsPanel
        state={podcastTools}
        snapshot={snapshot}
        onChange={onPodcastToolsChange}
        onPopOutTeleprompter={onPopOutTeleprompter}
      />
    </section>
  );
}
