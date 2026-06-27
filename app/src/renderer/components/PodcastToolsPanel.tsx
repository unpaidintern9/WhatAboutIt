import type { ReactNode } from "react";
import {
  BadgeDollarSign,
  BookOpen,
  Camera,
  Clapperboard,
  Flame,
  Laugh,
  Megaphone,
  Pause,
  Play,
  Square,
  Star,
  StickyNote,
  Volume2
} from "lucide-react";
import type { CameraLayout, PodcastToolsState, SoundSlot } from "../../shared/podcast-tools";
import { cameraLayouts, createLiveMarker, markerButtons } from "../../shared/podcast-tools";
import { Button } from ".";
import type { RecordingServiceSnapshot } from "../services";
import { formatRecordingTime } from "../services";

interface PodcastToolsPanelProps {
  state: PodcastToolsState;
  snapshot: RecordingServiceSnapshot;
  onChange: (state: PodcastToolsState) => void;
  onPopOutTeleprompter: () => void;
}

const markerIcons = {
  laugh: Laugh,
  flame: Flame,
  clapperboard: Clapperboard,
  "badge-dollar-sign": BadgeDollarSign,
  "badge-x": Square,
  star: Star
};

export function PodcastToolsPanel({ state, snapshot, onChange, onPopOutTeleprompter }: PodcastToolsPanelProps) {
  function patch(nextState: PodcastToolsState) {
    onChange({ ...nextState, updatedAt: new Date().toISOString() });
  }

  function mark(label: string) {
    const marker = createLiveMarker({
      label,
      timestampMs: snapshot.elapsedMs,
      recordingSessionId: snapshot.session?.id
    });
    patch({
      ...state,
      markers: [marker, ...state.markers],
      practiceMode: { ...state.practiceMode, markerTried: true }
    });
  }

  function selectLayout(layout: CameraLayout) {
    patch({
      ...state,
      cameraLayout: layout,
      practiceMode: { ...state.practiceMode, layoutTried: true }
    });
  }

  function playSlot(slotId: string) {
    patch({
      ...state,
      soundboard: {
        ...state.soundboard,
        playingSlotId: state.soundboard.playingSlotId === slotId ? undefined : slotId
      },
      practiceMode: { ...state.practiceMode, soundboardTried: true }
    });
  }

  return (
    <section className="podcast-tools" aria-label="Podcast tools">
      <CollapsibleTool title="Teleprompter" icon={<BookOpen size={20} />} defaultOpen>
        <div className={`teleprompter-card ${state.teleprompter.mode}`}>
          <textarea
            aria-label="Teleprompter script"
            value={state.teleprompter.script}
            onChange={(event) =>
              patch({
                ...state,
                teleprompter: { ...state.teleprompter, script: event.target.value },
                practiceMode: { ...state.practiceMode, teleprompterTried: true }
              })
            }
            placeholder="Drop Morgan's script here. Keep it punchy."
            style={{ fontSize: `${state.teleprompter.fontSize}px` }}
          />
          <textarea
            aria-label="Sponsor script"
            value={state.teleprompter.sponsorScript}
            onChange={(event) => patch({ ...state, teleprompter: { ...state.teleprompter, sponsorScript: event.target.value } })}
            placeholder="Sponsor read script, if this episode has one."
          />
        </div>
        <div className="tool-control-row">
          <Button
            variant="primary"
            icon={state.teleprompter.isScrolling ? <Pause size={18} /> : <Play size={18} />}
            onClick={() => patch({ ...state, teleprompter: { ...state.teleprompter, isScrolling: !state.teleprompter.isScrolling } })}
          >
            {state.teleprompter.isScrolling ? "Pause Scroll" : "Start Scroll"}
          </Button>
          <Button variant="secondary" onClick={onPopOutTeleprompter}>Pop Out</Button>
          <label>
            Speed
            <input
              type="range"
              min="1"
              max="8"
              value={state.teleprompter.speed}
              onChange={(event) => patch({ ...state, teleprompter: { ...state.teleprompter, speed: Number(event.target.value) } })}
            />
          </label>
          <label>
            Font
            <input
              type="range"
              min="22"
              max="56"
              value={state.teleprompter.fontSize}
              onChange={(event) => patch({ ...state, teleprompter: { ...state.teleprompter, fontSize: Number(event.target.value) } })}
            />
          </label>
          <Button
            variant="secondary"
            onClick={() => patch({ ...state, teleprompter: { ...state.teleprompter, mode: state.teleprompter.mode === "dark" ? "light" : "dark" } })}
          >
            {state.teleprompter.mode === "dark" ? "Light Mode" : "Dark Mode"}
          </Button>
        </div>
      </CollapsibleTool>

      <CollapsibleTool title="Guest Notes" icon={<StickyNote size={20} />}>
        <div className="notes-grid">
          <NoteBox label="Questions" value={state.guestNotes.questions} onChange={(value) => patch({ ...state, guestNotes: { ...state.guestNotes, questions: value }, practiceMode: { ...state.practiceMode, notesTried: true } })} />
          <NoteBox label="Talking points" value={state.guestNotes.talkingPoints} onChange={(value) => patch({ ...state, guestNotes: { ...state.guestNotes, talkingPoints: value } })} />
          <NoteBox label="Research notes" value={state.guestNotes.researchNotes} onChange={(value) => patch({ ...state, guestNotes: { ...state.guestNotes, researchNotes: value } })} />
          <NoteBox label="Links" value={state.guestNotes.links} onChange={(value) => patch({ ...state, guestNotes: { ...state.guestNotes, links: value } })} />
          <NoteBox label="Don't forget" value={state.guestNotes.dontForget} onChange={(value) => patch({ ...state, guestNotes: { ...state.guestNotes, dontForget: value } })} />
        </div>
      </CollapsibleTool>

      <CollapsibleTool title="Sponsor Notes" icon={<BadgeDollarSign size={20} />}>
        <div className="notes-grid">
          <NoteBox label="Sponsor name" value={state.sponsorNotes.sponsorName} onChange={(value) => patch({ ...state, sponsorNotes: { ...state.sponsorNotes, sponsorName: value } })} />
          <NoteBox label="Read script" value={state.sponsorNotes.readScript} onChange={(value) => patch({ ...state, sponsorNotes: { ...state.sponsorNotes, readScript: value } })} />
          <NoteBox label="Talking points" value={state.sponsorNotes.talkingPoints} onChange={(value) => patch({ ...state, sponsorNotes: { ...state.sponsorNotes, talkingPoints: value } })} />
          <NoteBox label="Required disclaimer" value={state.sponsorNotes.requiredDisclaimer} onChange={(value) => patch({ ...state, sponsorNotes: { ...state.sponsorNotes, requiredDisclaimer: value } })} />
        </div>
        <Button variant="primary" icon={<BadgeDollarSign size={20} />} onClick={() => mark("Sponsor")}>Mark Sponsor Moment</Button>
      </CollapsibleTool>

      <CollapsibleTool title="Soundboard" icon={<Volume2 size={20} />}>
        <div className="soundboard-grid">
          <SoundButton slot={state.soundboard.intro} playingSlotId={state.soundboard.playingSlotId} onPlay={playSlot} />
          <SoundButton slot={state.soundboard.outro} playingSlotId={state.soundboard.playingSlotId} onPlay={playSlot} />
          {state.soundboard.customSlots.map((slot) => (
            <SoundButton slot={slot} playingSlotId={state.soundboard.playingSlotId} onPlay={playSlot} key={slot.id} />
          ))}
        </div>
        <label>
          Volume
          <input
            type="range"
            min="0"
            max="100"
            value={state.soundboard.masterVolume}
            onChange={(event) => patch({ ...state, soundboard: { ...state.soundboard, masterVolume: Number(event.target.value) } })}
          />
        </label>
        <p className="soft-copy">Local audio files only. No cloud sound library.</p>
      </CollapsibleTool>

      <CollapsibleTool title="Live Markers" icon={<Megaphone size={20} />} defaultOpen>
        <div className="marker-button-grid">
          {markerButtons.map((marker) => {
            const MarkerIcon = markerIcons[marker.icon];
            return (
              <Button variant="secondary" icon={<MarkerIcon size={18} />} onClick={() => mark(marker.label)} key={marker.label}>
                {marker.emoji} {marker.label}
              </Button>
            );
          })}
        </div>
        <div className="marker-list">
          {state.markers.length === 0 ? (
            <p className="soft-copy">No moments marked yet. Tap a marker when something happens.</p>
          ) : (
            state.markers.slice(0, 5).map((marker) => (
              <span key={marker.id}>{marker.label} at {formatRecordingTime(marker.timestampMs)}</span>
            ))
          )}
        </div>
      </CollapsibleTool>

      <CollapsibleTool title="Camera Layouts" icon={<Camera size={20} />} defaultOpen>
        <div className="layout-button-grid">
          {cameraLayouts.map((layout) => (
            <button className={state.cameraLayout === layout.id ? "active" : ""} type="button" onClick={() => selectLayout(layout.id)} key={layout.id}>
              {layout.label}
            </button>
          ))}
        </div>
      </CollapsibleTool>
    </section>
  );
}

function CollapsibleTool({ title, icon, children, defaultOpen = false }: { title: string; icon: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="tool-section" open={defaultOpen}>
      <summary>
        <span>{icon}{title}</span>
        <small>Open / close</small>
      </summary>
      <div className="tool-section-body">{children}</div>
    </details>
  );
}

function NoteBox({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={`Add ${label.toLowerCase()} here.`} />
    </label>
  );
}

function SoundButton({ slot, playingSlotId, onPlay }: { slot: SoundSlot; playingSlotId?: string; onPlay: (slotId: string) => void }) {
  const isPlaying = playingSlotId === slot.id;
  return (
    <button className={isPlaying ? "playing" : ""} type="button" onClick={() => onPlay(slot.id)}>
      <strong>{slot.label}</strong>
      <span>{slot.filePath ? "Local file ready" : "Add local file later"}</span>
      <small>{isPlaying ? "Stop" : "Play"}</small>
    </button>
  );
}
