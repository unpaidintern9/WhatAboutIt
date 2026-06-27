import { AlertTriangle, Camera, Circle, Mic2, Pause, Play, RotateCcw, Save, Square } from "lucide-react";
import type { DeviceDefaults } from "../../shared/types";
import type { RecordingSession } from "../../shared/recording";
import { AudioMeter, Button, CameraPreview } from ".";
import type { RecordingServiceSnapshot } from "../services";
import { formatRecordingTime } from "../services";

interface RecordingStudioProps {
  defaults: DeviceDefaults;
  snapshot: RecordingServiceSnapshot;
  unfinishedSessions: RecordingSession[];
  storageWarning?: string;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onPractice: () => void;
  onDismissRecovery: () => void;
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
  storageWarning,
  onStart,
  onPause,
  onResume,
  onStop,
  onPractice,
  onDismissRecovery
}: RecordingStudioProps) {
  const isRecording = snapshot.status === "recording";
  const isPaused = snapshot.status === "paused";

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
          <p className="signature">Everything is saving locally</p>
          <h2>Recording Room</h2>
          <p className="soft-copy">
            Record the program track with your selected studio setup. OBS and media details stay behind the curtain.
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
        <Button variant="secondary" icon={<RotateCcw size={22} />} onClick={onPractice}>
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
            <h3>Camera status</h3>
            <Camera size={22} />
          </div>
          <div className="device-slot-grid">
            {cameraSlots.map(([key, label]) => (
              <article className="device-slot" key={key}>
                <h4>{label}</h4>
                <CameraPreview label={label} />
                <p>{defaults.cameras[key] ? "Ready for program setup" : "Not picked yet"}</p>
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
    </section>
  );
}

