import { useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Activity, FileText, Maximize2, MonitorUp, Pause, Play, Radio, Search, Sparkles, Volume2 } from "lucide-react";
import type { LiveMarker, PodcastToolsState, SoundSlot } from "../../shared/podcast-tools";
import { markerButtons } from "../../shared/podcast-tools";
import type { StudioDisplayInfo, StudioPanelId } from "../../shared/studio-workspace";
import { studioPanelLabels } from "../../shared/studio-workspace";
import { formatRecordingTime } from "../services";

interface StudioToolPanelProps {
  podcastTools: PodcastToolsState;
  displays?: StudioDisplayInfo[];
  poppedOutPanels?: Partial<Record<StudioPanelId, boolean>>;
  playingSlotId?: string;
  markerNotice?: string;
  notesSavedAt?: string;
  elapsedMs?: number;
  recordingStatus?: string;
  diagnosticsMessage?: string;
  onPatchTools: (nextState: PodcastToolsState) => void;
  onPatchNotes?: (nextState: PodcastToolsState) => void;
  onPlaySound?: (slot: SoundSlot) => void;
  onMark?: (label: string) => void;
  onPopOut?: (panelId: StudioPanelId, displayId?: number, fullscreen?: boolean) => void;
  onReturnToStudio?: (panelId: StudioPanelId) => void;
}

export function StudioToolPanels(props: StudioToolPanelProps) {
  return (
    <>
      <SoundboardPanel {...props} />
      <MarkerListPanel {...props} />
      <EpisodeNotesPanel {...props} />
      <GuestNotesPanel {...props} />
      <TeleprompterPanel {...props} />
      <StudioDiagnosticsPanel {...props} />
    </>
  );
}

export function StudioPopOutPanel({ panelId, ...props }: StudioToolPanelProps & { panelId: StudioPanelId }) {
  return (
    <main className="popout-studio-window">
      <header className="popout-titlebar">
        <div>
          <p className="signature">What About It? Studio</p>
          <h1>{studioPanelLabels[panelId]}</h1>
        </div>
        <RusticButton onClick={() => props.onReturnToStudio?.(panelId)}>Return to Studio</RusticButton>
      </header>
      <section className="popout-panel-frame">
        {panelId === "teleprompter" && <TeleprompterPanel {...props} popout />}
        {panelId === "soundboard" && <SoundboardPanel {...props} popout />}
        {panelId === "guest-notes" && <GuestNotesPanel {...props} popout />}
        {panelId === "episode-notes" && <EpisodeNotesPanel {...props} popout />}
        {panelId === "marker-list" && <MarkerListPanel {...props} popout />}
        {panelId === "studio-diagnostics" && <StudioDiagnosticsPanel {...props} popout />}
      </section>
    </main>
  );
}

function PanelChrome({
  panelId,
  icon,
  children,
  className = "",
  displays = [],
  poppedOut,
  popout,
  onPopOut,
  onReturnToStudio
}: {
  panelId: StudioPanelId;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
  displays?: StudioDisplayInfo[];
  poppedOut?: boolean;
  popout?: boolean;
  onPopOut?: (panelId: StudioPanelId, displayId?: number, fullscreen?: boolean) => void;
  onReturnToStudio?: (panelId: StudioPanelId) => void;
}) {
  const secondaryDisplays = displays.filter((display) => !display.primary);
  return (
    <section className={`vintage-panel ${className} ${popout ? "popout-active-panel" : ""}`.trim()}>
      <div className="vintage-panel-heading">
        <h3>{studioPanelLabels[panelId]}</h3>
        {icon}
      </div>
      <div className="popout-actions">
        {popout ? (
          <RusticButton onClick={() => onReturnToStudio?.(panelId)}>Return to Studio</RusticButton>
        ) : (
          <>
            <RusticButton disabled={poppedOut} onClick={() => onPopOut?.(panelId)}>
              <MonitorUp size={16} /> {poppedOut ? "Popped Out" : "Pop Out"}
            </RusticButton>
            {poppedOut && <RusticButton onClick={() => onReturnToStudio?.(panelId)}>Return to Studio</RusticButton>}
            {secondaryDisplays.map((display, index) => (
              <RusticButton key={display.id} onClick={() => onPopOut?.(panelId, display.id)}>
                Move {studioPanelLabels[panelId]} to Monitor {index + 2}
              </RusticButton>
            ))}
          </>
        )}
      </div>
      {children}
    </section>
  );
}

function TeleprompterPanel(props: StudioToolPanelProps & { popout?: boolean }) {
  const [mirror, setMirror] = useState(false);
  const [hidden, setHidden] = useState(false);
  const teleprompter = props.podcastTools.teleprompter;
  const scrollingTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => {
    if (scrollingTimerRef.current) window.clearInterval(scrollingTimerRef.current);
  }, []);

  function patchTeleprompter(patch: Partial<typeof teleprompter>) {
    props.onPatchTools({
      ...props.podcastTools,
      teleprompter: { ...teleprompter, ...patch },
      practiceMode: { ...props.podcastTools.practiceMode, teleprompterTried: true }
    });
  }

  return (
    <PanelChrome
      panelId="teleprompter"
      icon={<FileText size={20} />}
      className="teleprompter-panel"
      displays={props.displays}
      poppedOut={props.poppedOutPanels?.teleprompter}
      popout={props.popout}
      onPopOut={props.onPopOut}
      onReturnToStudio={props.onReturnToStudio}
    >
      <div className="teleprompter-actions">
        <RusticButton className={teleprompter.isScrolling ? "selected" : ""} onClick={() => patchTeleprompter({ isScrolling: !teleprompter.isScrolling })}>
          {teleprompter.isScrolling ? <Pause size={16} /> : <Play size={16} />}
          {teleprompter.isScrolling ? "Remote pause" : "Remote resume"}
        </RusticButton>
        <RusticButton className={teleprompter.mode === "dark" ? "selected" : ""} onClick={() => patchTeleprompter({ mode: teleprompter.mode === "dark" ? "light" : "dark" })}>
          Dark mode
        </RusticButton>
        <RusticButton className={mirror ? "selected" : ""} onClick={() => setMirror((current) => !current)}>Mirror mode</RusticButton>
        <RusticButton onClick={() => props.onPopOut?.("teleprompter", undefined, true)}>
          <Maximize2 size={16} /> Fullscreen
        </RusticButton>
        <RusticButton onClick={() => setHidden((current) => !current)}>{hidden ? "Show" : "Hide"}</RusticButton>
        <span>{teleprompter.isScrolling ? "Scrolling" : "Ready"}</span>
      </div>
      <div className="teleprompter-controls">
        <label>
          Font
          <input type="range" min="22" max="72" value={teleprompter.fontSize} onChange={(event) => patchTeleprompter({ fontSize: Number(event.target.value) })} />
        </label>
        <label>
          Scroll speed
          <input type="range" min="1" max="10" value={teleprompter.speed} onChange={(event) => patchTeleprompter({ speed: Number(event.target.value) })} />
        </label>
      </div>
      {!hidden && (
        <textarea
          className={`${props.popout ? "popout-teleprompter" : ""} ${mirror ? "mirror-mode" : ""} ${teleprompter.mode === "dark" ? "dark-mode" : ""}`.trim()}
          style={{ fontSize: `${teleprompter.fontSize}px` }}
          aria-label="Teleprompter"
          value={teleprompter.script}
          onChange={(event) => patchTeleprompter({ script: event.target.value })}
          placeholder="Drop Morgan's script here."
        />
      )}
    </PanelChrome>
  );
}

function SoundboardPanel(props: StudioToolPanelProps & { popout?: boolean }) {
  const [search, setSearch] = useState("");
  const slots = [props.podcastTools.soundboard.intro, props.podcastTools.soundboard.outro, ...props.podcastTools.soundboard.customSlots].filter((slot) =>
    slot.label.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <PanelChrome panelId="soundboard" icon={<Radio size={20} />} className="soundboard-panel" displays={props.displays} poppedOut={props.poppedOutPanels?.soundboard} popout={props.popout} onPopOut={props.onPopOut} onReturnToStudio={props.onReturnToStudio}>
      <div className="soundboard-toolbar">
        <label>
          <Search size={16} /> Search
          <input value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <span>Intro</span>
        <span>Outro</span>
        <span>Custom</span>
      </div>
      <div className={`soundboard-grid live ${props.popout ? "touch" : ""}`}>
        {slots.map((slot, index) => (
          <button className={props.playingSlotId === slot.id ? "playing" : ""} type="button" onClick={() => props.onPlaySound?.(slot)} key={slot.id}>
            <strong>{slot.label}</strong>
            <span>{slot.filePath ? "Local sound ready" : "Add a sound"}</span>
            <i className="sound-wave" aria-hidden="true"><b /><b /><b /><b /><b /></i>
            <small>{props.playingSlotId === slot.id ? "Playing now" : `Hotkey ${index + 1}`}</small>
          </button>
        ))}
      </div>
      <label>
        <Volume2 size={16} /> Volume
        <input
          type="range"
          min="0"
          max="100"
          value={props.podcastTools.soundboard.masterVolume}
          onChange={(event) =>
            props.onPatchTools({
              ...props.podcastTools,
              soundboard: { ...props.podcastTools.soundboard, masterVolume: Number(event.target.value) },
              practiceMode: { ...props.podcastTools.practiceMode, soundboardTried: true }
            })
          }
        />
      </label>
    </PanelChrome>
  );
}

function MarkerListPanel(props: StudioToolPanelProps & { popout?: boolean }) {
  return (
    <PanelChrome panelId="marker-list" icon={<Sparkles size={20} />} className="markers-panel" displays={props.displays} poppedOut={props.poppedOutPanels?.["marker-list"]} popout={props.popout} onPopOut={props.onPopOut} onReturnToStudio={props.onReturnToStudio}>
      <div className="marker-button-grid live">
        {markerButtons.map((marker) => (
          <RusticButton onClick={() => props.onMark?.(marker.label)} key={marker.label}>{marker.label}</RusticButton>
        ))}
      </div>
      {props.markerNotice && <p className="marker-toast live" aria-live="polite">{props.markerNotice}</p>}
      <div className="marker-list live">
        {props.podcastTools.markers.length === 0 ? (
          <p>No moments marked yet.</p>
        ) : (
          props.podcastTools.markers.slice(0, 8).map((marker: LiveMarker) => (
            <span key={marker.id}>{marker.label} at {formatRecordingTime(marker.timestampMs)}</span>
          ))
        )}
      </div>
    </PanelChrome>
  );
}

function EpisodeNotesPanel(props: StudioToolPanelProps & { popout?: boolean }) {
  return (
    <PanelChrome panelId="episode-notes" icon={<FileText size={20} />} className="notes-panel" displays={props.displays} poppedOut={props.poppedOutPanels?.["episode-notes"]} popout={props.popout} onPopOut={props.onPopOut} onReturnToStudio={props.onReturnToStudio}>
      <NoteBox
        label="Episode notes"
        savedState={props.notesSavedAt ?? "Saved"}
        value={props.podcastTools.guestNotes.talkingPoints}
        onChange={(value) => props.onPatchNotes?.({ ...props.podcastTools, guestNotes: { ...props.podcastTools.guestNotes, talkingPoints: value } })}
      />
    </PanelChrome>
  );
}

function GuestNotesPanel(props: StudioToolPanelProps & { popout?: boolean }) {
  return (
    <PanelChrome panelId="guest-notes" icon={<FileText size={20} />} className="guest-panel" displays={props.displays} poppedOut={props.poppedOutPanels?.["guest-notes"]} popout={props.popout} onPopOut={props.onPopOut} onReturnToStudio={props.onReturnToStudio}>
      <NoteBox
        label="Guest notes"
        savedState={props.notesSavedAt ?? "Saved"}
        value={props.podcastTools.guestNotes.questions}
        onChange={(value) =>
          props.onPatchNotes?.({
            ...props.podcastTools,
            guestNotes: { ...props.podcastTools.guestNotes, questions: value },
            practiceMode: { ...props.podcastTools.practiceMode, notesTried: true }
          })
        }
      />
    </PanelChrome>
  );
}

function StudioDiagnosticsPanel(props: StudioToolPanelProps & { popout?: boolean }) {
  return (
    <PanelChrome panelId="studio-diagnostics" icon={<Activity size={20} />} className="diagnostics-panel" displays={props.displays} poppedOut={props.poppedOutPanels?.["studio-diagnostics"]} popout={props.popout} onPopOut={props.onPopOut} onReturnToStudio={props.onReturnToStudio}>
      <div className="diagnostics-list">
        <span><strong>Recording</strong>{props.recordingStatus ?? "idle"}</span>
        <span><strong>Elapsed</strong>{formatRecordingTime(props.elapsedMs ?? 0)}</span>
        <span><strong>Markers</strong>{props.podcastTools.markers.length}</span>
        <span><strong>Workspace</strong>{props.diagnosticsMessage ?? "Window positions restore on launch."}</span>
      </div>
    </PanelChrome>
  );
}

function NoteBox({ label, value, savedState, onChange }: { label: string; value: string; savedState: string; onChange: (value: string) => void }) {
  return (
    <label>
      <span className="note-label-row">{label}<small>{savedState}</small></span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function RusticButton({ className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`rustic-button ${className}`.trim()} type="button" {...props}>{children}</button>;
}
