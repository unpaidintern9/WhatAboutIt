import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BookOpen,
  Brush,
  Camera,
  Clapperboard,
  FolderOpen,
  Mic2,
  MonitorPlay,
  Plus,
  Settings,
  Sparkles,
  Wand2
} from "lucide-react";
import type { EpisodeMetadata, StudioSettings } from "../shared/types";
import { applyTheme, builtInThemes, findTheme } from "./theme/themes";
import "./styles.css";

type View = "home" | "new-episode" | "settings" | "learn" | "practice" | "theme-editor";

const fallbackSettings: StudioSettings = {
  activeThemeId: "what-about-it",
  defaultEpisodeFolderName: "episodes",
  practiceModeEnabled: false
};

export default function App() {
  const [view, setView] = useState<View>("home");
  const [episodes, setEpisodes] = useState<EpisodeMetadata[]>([]);
  const [settings, setSettings] = useState<StudioSettings>(fallbackSettings);
  const [title, setTitle] = useState("");
  const [guestName, setGuestName] = useState("");
  const [description, setDescription] = useState("");
  const activeTheme = useMemo(() => findTheme(settings.activeThemeId), [settings.activeThemeId]);

  useEffect(() => {
    applyTheme(activeTheme);
  }, [activeTheme]);

  useEffect(() => {
    void window.studio.getSettings().then(setSettings);
    void refreshEpisodes();
  }, []);

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
          Phase 1 shell. Devices and recording stay locked until later phases.
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
        {view === "theme-editor" && (
          <ThemeEditorView activeThemeId={settings.activeThemeId} changeTheme={changeTheme} />
        )}
        {view === "learn" && <PlaceholderView icon={<BookOpen />} title="Learn Studio" message="Offline lessons are getting their boots on. This will become the friendly guide for setup, recording, reviewing, and exporting." />}
        {view === "practice" && <PlaceholderView icon={<Clapperboard />} title="Practice Mode" message="A no-pressure rehearsal space is planned here. For Phase 1, it is intentionally a placeholder." />}
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
          <button className="primary-action" onClick={onNewEpisode}>
            <Plus size={24} /> New Episode
          </button>
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
                    <p>{episode.guestName || "Solo episode"} · {new Date(episode.createdAt).toLocaleDateString()}</p>
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
            <span><Camera size={18} /> Camera setup</span>
            <span><Mic2 size={18} /> Mic setup</span>
            <span><Wand2 size={18} /> Auto Edit</span>
          </div>
          <p>These stay as placeholders in Phase 1. No Phase 2 device work is active yet.</p>
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
      <button className="primary-action" disabled={!props.title.trim()} onClick={() => void props.createEpisode()}>
        <Plus size={22} /> Create Local Episode
      </button>
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
        <div><dt>Storage</dt><dd>Local Documents folder</dd></div>
      </dl>
    </section>
  );
}

function PlaceholderView({ icon, title, message }: { icon: ReactNode; title: string; message: string }) {
  return (
    <section className="placeholder-panel">
      <div className="placeholder-icon">{icon}</div>
      <p className="signature">Coming in a later pass</p>
      <h2>{title}</h2>
      <p>{message}</p>
    </section>
  );
}

function CameraPreviewWall() {
  return (
    <div className="preview-wall" aria-label="Branded empty camera preview placeholders">
      {["Camera 1", "Camera 2", "Camera 3"].map((label) => (
        <div className="camera-box" key={label}>
          <Camera size={26} />
          <span>{label}</span>
          <small>Preview comes in Phase 2</small>
        </div>
      ))}
    </div>
  );
}
