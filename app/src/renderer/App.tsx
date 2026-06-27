import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Brush,
  Camera,
  Clapperboard,
  Circle,
  FolderOpen,
  Headphones,
  Mic2,
  MonitorPlay,
  Plus,
  Settings,
  Sparkles,
  Wand2
} from "lucide-react";
import type { DeviceDefaults, EpisodeMetadata, StudioSettings } from "../shared/types";
import type { RecordingSession } from "../shared/recording";
import { defaultDeviceDefaults, withDeviceDefaults } from "../shared/device-config";
import { Button, CameraPreview, DeviceSetupWizard, RecordingStudio } from "./components";
import { browserDevicePlugin } from "./plugins/devices/browser-device-plugin";
import { BrowserMediaRecorderPlugin } from "./plugins/recording/browser-media-recorder-plugin";
import type { DeviceDetectionResult } from "./plugins/devices/types";
import { DeviceService, RecordingService, type RecordingServiceSnapshot } from "./services";
import { applyTheme, builtInThemes, findTheme } from "./theme/themes";
import "./styles.css";

type View = "home" | "new-episode" | "device-setup" | "recording" | "settings" | "learn" | "practice" | "theme-editor";

const fallbackSettings: StudioSettings = {
  activeThemeId: "what-about-it",
  defaultEpisodeFolderName: "episodes",
  practiceModeEnabled: false,
  deviceDefaults: defaultDeviceDefaults
};

const emptyDetection: DeviceDetectionResult = {
  cameras: [],
  microphones: [],
  speakers: [],
  permissionNeeded: false
};

const idleRecordingSnapshot: RecordingServiceSnapshot = {
  status: "idle",
  elapsedMs: 0,
  localSaveMessage: "Everything is saving locally"
};

export default function App() {
  const [view, setView] = useState<View>("home");
  const [episodes, setEpisodes] = useState<EpisodeMetadata[]>([]);
  const [settings, setSettings] = useState<StudioSettings>(fallbackSettings);
  const [deviceDetection, setDeviceDetection] = useState<DeviceDetectionResult>(emptyDetection);
  const [recordingSnapshot, setRecordingSnapshot] = useState<RecordingServiceSnapshot>(idleRecordingSnapshot);
  const [unfinishedSessions, setUnfinishedSessions] = useState<RecordingSession[]>([]);
  const [wizardStep, setWizardStep] = useState(0);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [title, setTitle] = useState("");
  const [guestName, setGuestName] = useState("");
  const [description, setDescription] = useState("");
  const activeTheme = useMemo(() => findTheme(settings.activeThemeId), [settings.activeThemeId]);
  const deviceService = useMemo(() => new DeviceService(browserDevicePlugin), []);
  const recordingService = useMemo(() => new RecordingService(new BrowserMediaRecorderPlugin()), []);

  useEffect(() => {
    applyTheme(activeTheme);
  }, [activeTheme]);

  useEffect(() => {
    void window.studio.getSettings().then((nextSettings) => setSettings(withDeviceDefaults(nextSettings)));
    void refreshEpisodes();
    void refreshDevices();
    void refreshUnfinishedSessions();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRecordingSnapshot(recordingService.getSnapshot());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [recordingService]);

  async function refreshEpisodes() {
    setEpisodes(await window.studio.listEpisodes());
  }

  async function createEpisode() {
    const episode = await window.studio.createEpisode({ title, guestName, description });
    setTitle("");
    setGuestName("");
    setDescription("");
    setEpisodes([episode, ...episodes]);
    setView("home");
  }

  async function changeTheme(themeId: string) {
    const nextSettings = { ...settings, activeThemeId: themeId };
    setSettings(nextSettings);
    await window.studio.saveSettings(nextSettings);
  }

  async function refreshDevices() {
    setDeviceDetection(await deviceService.detectDevices());
  }

  async function requestStudioPermissions() {
    setDeviceDetection(await deviceService.requestStudioPermissions());
  }

  async function saveDeviceDefaults(deviceDefaults: DeviceDefaults) {
    const nextSettings = withDeviceDefaults({ ...settings, deviceDefaults });
    setSettings(nextSettings);
    await window.studio.saveSettings(nextSettings);
  }

  async function testMicrophone() {
    const level = await deviceService.sampleMicrophoneLevel(settings.deviceDefaults.microphones.morganMic);
    setMicrophoneLevel(level);
  }

  async function playTestSound() {
    await deviceService.playTestSound(settings.deviceDefaults.audioOutputId);
  }

  async function refreshUnfinishedSessions() {
    setUnfinishedSessions(await window.studio.listUnfinishedRecordingSessions());
  }

  async function startRecording(practice = false) {
    setRecordingSnapshot(await recordingService.start(settings.deviceDefaults, practice));
  }

  async function pauseRecording() {
    setRecordingSnapshot(await recordingService.pause());
  }

  async function resumeRecording() {
    setRecordingSnapshot(await recordingService.resume());
  }

  async function stopRecording() {
    setRecordingSnapshot(await recordingService.stop());
    await refreshUnfinishedSessions();
  }

  return (
    <main className="studio-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-badge">WAI</div>
          <div>
            <p className="eyebrow">Offline studio</p>
            <h1>{activeTheme.branding.logoText}</h1>
          </div>
        </div>

        <nav className="nav-stack" aria-label="Studio sections">
          <button className={view === "home" ? "active" : ""} onClick={() => setView("home")}>
            <MonitorPlay size={20} /> Home
          </button>
          <button className={view === "new-episode" ? "active" : ""} onClick={() => setView("new-episode")}>
            <Plus size={20} /> New Episode
          </button>
          <button className={view === "device-setup" ? "active" : ""} onClick={() => setView("device-setup")}>
            <Camera size={20} /> Studio Setup
          </button>
          <button className={view === "recording" ? "active" : ""} onClick={() => setView("recording")}>
            <Circle size={20} /> Record
          </button>
          <button className={view === "theme-editor" ? "active" : ""} onClick={() => setView("theme-editor")}>
            <Brush size={20} /> Theme Editor
          </button>
          <button className={view === "learn" ? "active" : ""} onClick={() => setView("learn")}>
            <BookOpen size={20} /> Learn Studio
          </button>
          <button className={view === "practice" ? "active" : ""} onClick={() => setView("practice")}>
            <Clapperboard size={20} /> Practice Mode
          </button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
            <Settings size={20} /> Settings
          </button>
        </nav>

        <div className="phase-note">
          <Sparkles size={18} />
          Phase 3 recording foundation. Auto Edit and timeline stay locked.
        </div>
      </aside>

      <section className="workspace">
        {view === "home" && <HomeView episodes={episodes} onNewEpisode={() => setView("new-episode")} />}
        {view === "new-episode" && (
          <NewEpisodeView
            title={title}
            guestName={guestName}
            description={description}
            setTitle={setTitle}
            setGuestName={setGuestName}
            setDescription={setDescription}
            createEpisode={createEpisode}
          />
        )}
        {view === "device-setup" && (
          <DeviceSetupWizard
            detection={deviceDetection}
            defaults={settings.deviceDefaults}
            microphoneLevel={microphoneLevel}
            currentStep={wizardStep}
            onStepChange={setWizardStep}
            onRefresh={() => void refreshDevices()}
            onRequestPermission={() => void requestStudioPermissions()}
            onDefaultsChange={(defaults) => void saveDeviceDefaults(defaults)}
            onTestMicrophone={() => void testMicrophone()}
            onPlayTestSound={() => void playTestSound()}
          />
        )}
        {view === "recording" && (
          <RecordingStudio
            defaults={settings.deviceDefaults}
            snapshot={recordingSnapshot}
            unfinishedSessions={unfinishedSessions}
            storageWarning={undefined}
            onStart={() => void startRecording(false)}
            onPause={() => void pauseRecording()}
            onResume={() => void resumeRecording()}
            onStop={() => void stopRecording()}
            onPractice={() => void startRecording(true)}
            onDismissRecovery={() => setUnfinishedSessions([])}
          />
        )}
        {view === "theme-editor" && (
          <ThemeEditorView activeThemeId={settings.activeThemeId} changeTheme={changeTheme} />
        )}
        {view === "learn" && <LearnStudioView />}
        {view === "practice" && <PracticeModeView />}
        {view === "settings" && <SettingsView settings={settings} activeThemeName={activeTheme.name} />}
      </section>
    </main>
  );
}

function HomeView({ episodes, onNewEpisode }: { episodes: EpisodeMetadata[]; onNewEpisode: () => void }) {
  return (
    <div className="view-stack">
      <section className="hero-panel">
        <div>
          <p className="signature">Morgan's offline podcast room</p>
          <h2>Ready when you are.</h2>
          <p className="hero-copy">
            Start a new episode, keep everything local, and let the heavy media tools stay behind the curtain.
          </p>
          <Button variant="primary" icon={<Plus size={24} />} onClick={onNewEpisode}>New Episode</Button>
        </div>
        <CameraPreviewWall />
      </section>

      <section className="split-row">
        <div className="panel">
          <div className="panel-heading">
            <h3>Recent Episodes</h3>
            <FolderOpen size={22} />
          </div>
          {episodes.length === 0 ? (
            <p className="empty-copy">No local episodes yet. Make the first one and this list will fill itself in.</p>
          ) : (
            <div className="episode-list">
              {episodes.map((episode) => (
                <article className="episode-card" key={episode.id}>
                  <div>
                    <h4>{episode.title}</h4>
                    <p>{episode.guestName || "Solo episode"} - {new Date(episode.createdAt).toLocaleDateString()}</p>
                  </div>
                  <span>{episode.status}</span>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="panel locked-panel">
          <div className="panel-heading">
            <h3>Coming Later</h3>
            <Wand2 size={22} />
          </div>
          <div className="locked-tools">
            <span><Camera size={18} /> Studio Setup is ready</span>
            <span><Mic2 size={18} /> Mic check is ready</span>
            <span><Circle size={18} /> Recording foundation is ready</span>
          </div>
          <p>Use Record for a local program recording. Auto Edit and timeline tools stay locked for later phases.</p>
        </div>
      </section>
    </div>
  );
}

function NewEpisodeView(props: {
  title: string;
  guestName: string;
  description: string;
  setTitle: (value: string) => void;
  setGuestName: (value: string) => void;
  setDescription: (value: string) => void;
  createEpisode: () => Promise<void>;
}) {
  return (
    <section className="form-panel">
      <p className="signature">Let's get this one on the books</p>
      <h2>New Episode</h2>
      <label>
        Episode title
        <input value={props.title} onChange={(event) => props.setTitle(event.target.value)} placeholder="What are we calling this one?" />
      </label>
      <label>
        Guest name
        <input value={props.guestName} onChange={(event) => props.setGuestName(event.target.value)} placeholder="Optional" />
      </label>
      <label>
        Notes
        <textarea value={props.description} onChange={(event) => props.setDescription(event.target.value)} placeholder="Big idea, segment notes, or anything Morgan wants handy." />
      </label>
      <Button variant="primary" icon={<Plus size={22} />} disabled={!props.title.trim()} onClick={() => void props.createEpisode()}>
        Create Local Episode
      </Button>
    </section>
  );
}

function ThemeEditorView({ activeThemeId, changeTheme }: { activeThemeId: string; changeTheme: (themeId: string) => Promise<void> }) {
  return (
    <section className="view-stack">
      <div className="panel">
        <p className="signature">Make the whole room yours</p>
        <h2>Theme Editor</h2>
        <p className="soft-copy">
          Phase 1 ships the theme engine and built-in themes. Custom create, export, import, and share controls are staged here for the full editor.
        </p>
        <div className="theme-grid">
          {builtInThemes.map((theme) => (
            <button
              className={`theme-tile ${activeThemeId === theme.id ? "selected" : ""}`}
              key={theme.id}
              onClick={() => void changeTheme(theme.id)}
              style={{
                background: `linear-gradient(135deg, ${theme.colors.cards}, ${theme.colors.surface})`,
                color: theme.colors.text,
                borderColor: theme.colors.accent
              }}
            >
              <span style={{ background: theme.colors.primary }} />
              <strong>{theme.name}</strong>
              <small>{theme.description}</small>
            </button>
          ))}
        </div>
        <div className="editor-actions" aria-label="Future custom theme actions">
          <button disabled>Create custom theme</button>
          <button disabled>Export theme</button>
          <button disabled>Import theme</button>
          <button disabled>Share theme</button>
        </div>
      </div>
    </section>
  );
}

function SettingsView({ settings, activeThemeName }: { settings: StudioSettings; activeThemeName: string }) {
  return (
    <section className="panel settings-panel">
      <p className="signature">Local by default</p>
      <h2>Settings</h2>
      <dl>
        <div><dt>Active theme</dt><dd>{activeThemeName}</dd></div>
        <div><dt>Episode folder</dt><dd>{settings.defaultEpisodeFolderName}</dd></div>
        <div><dt>Practice Mode</dt><dd>{settings.practiceModeEnabled ? "On" : "Off"}</dd></div>
        <div><dt>Camera 1</dt><dd>{settings.deviceDefaults.cameras.camera1 ? "Saved" : "Not picked yet"}</dd></div>
        <div><dt>Morgan Mic</dt><dd>{settings.deviceDefaults.microphones.morganMic ? "Saved" : "Not picked yet"}</dd></div>
        <div><dt>Storage</dt><dd>Local Documents folder</dd></div>
      </dl>
    </section>
  );
}

function LearnStudioView() {
  const lessons = [
    "How to connect a camera",
    "How to connect a microphone",
    "How to use headphones",
    "What to do if your camera does not show up",
    "What to do if your mic is too quiet",
    "How to record your first episode",
    "What happens when you press Record",
    "Why files are saved locally",
    "What to do if recording stops",
    "How recovery works"
  ];

  return (
    <section className="panel learning-panel">
      <p className="signature">Little lessons, right in the studio</p>
      <h2>Learn Studio</h2>
      <p className="soft-copy">Offline help is ready for device setup. No internet, no tech lecture, just the next helpful step.</p>
      <div className="lesson-grid">
        {lessons.map((lesson) => (
          <article className="lesson-card" key={lesson}>
            <BookOpen size={22} />
            <h3>{lesson}</h3>
            <p>{getLessonCopy(lesson)}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function PracticeModeView() {
  return (
    <section className="panel practice-panel">
      <p className="signature">Try it without touching real gear</p>
      <h2>Practice Mode</h2>
      <p className="soft-copy">
        Walk through a safe fake setup with branded placeholders. No fake people photos and no real media files.
      </p>
      <div className="practice-steps">
        <span><Circle size={20} /> Press Practice on the Record screen</span>
        <span><Mic2 size={20} /> Practice pause and resume</span>
        <span><Headphones size={20} /> Learn that everything saves locally</span>
        <span><Clapperboard size={20} /> Try the recovery message without risking real media</span>
      </div>
    </section>
  );
}

function getLessonCopy(lesson: string) {
  if (lesson.includes("camera does not")) return "Try a different port, close other video apps, then run Studio Setup again.";
  if (lesson.includes("first episode")) return "Pick devices first, press Record, pause if you need a breath, then Stop when you are done.";
  if (lesson.includes("press Record")) return "The app creates a local session folder and starts saving the program recording.";
  if (lesson.includes("saved locally")) return "Recordings stay on this computer inside the episode folder.";
  if (lesson.includes("recording stops")) return "Open the app again and look for the unfinished recording recovery message.";
  if (lesson.includes("recovery")) return "Recovery points you back to the local session folder and never deletes raw recordings.";
  if (lesson.includes("mic is too quiet")) return "Move the mic closer, check the gain knob, and use Say something! to watch the meter.";
  if (lesson.includes("camera")) return "Plug the camera in first, then choose it for Camera 1, Camera 2, or Camera 3.";
  if (lesson.includes("microphone")) return "Pick Morgan Mic first so the app knows which voice matters most.";
  return "Use headphones during recording so the microphones do not hear the show audio.";
}

function CameraPreviewWall() {
  return (
    <div className="preview-wall" aria-label="Branded empty camera preview placeholders">
      {["Camera 1", "Camera 2", "Camera 3"].map((label) => (
        <CameraPreview label={label} key={label} />
      ))}
    </div>
  );
}
