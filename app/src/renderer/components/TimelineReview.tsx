import { Clock, Lock, Pause, Play, ShieldCheck, SkipForward } from "lucide-react";
import type { TimelineDraft } from "../../shared/timeline";
import { Button } from ".";
import { formatRecordingTime } from "../services";

interface TimelineReviewProps {
  draft: TimelineDraft;
  onJumpToMarker: (timestampMs: number) => void;
}

export function TimelineReview({ draft, onJumpToMarker }: TimelineReviewProps) {
  return (
    <section className="timeline-review">
      <div className="timeline-hero">
        <div>
          <p className="signature">Markers help you find the good stuff</p>
          <h2>Review your episode</h2>
          <p className="soft-copy">Your original recording is safe. This review timeline is just a draft map.</p>
        </div>
        <div className="original-safe-badge">
          <ShieldCheck size={30} />
          <span>Your original recording is safe</span>
        </div>
      </div>

      <div className="timeline-controls">
        <Button variant="primary" icon={<Play size={20} />}>Play</Button>
        <Button variant="secondary" icon={<Pause size={20} />}>Pause</Button>
        <Button variant="secondary" icon={<SkipForward size={20} />} disabled={draft.markers.length === 0}>
          Jump to marker
        </Button>
      </div>

      <div className="visual-timeline" aria-label="Draft timeline">
        {draft.tracks.map((track) => (
          <div className={`timeline-track ${track.kind}`} key={track.id}>
            <strong>{track.label}</strong>
            <span>{track.placeholder}</span>
            <i />
          </div>
        ))}
        <div className="timeline-marker-row">
          {draft.markers.length === 0 ? (
            <span>No markers yet</span>
          ) : (
            draft.markers.map((marker) => (
              <button type="button" onClick={() => onJumpToMarker(marker.timestampMs)} key={marker.id}>
                <Clock size={14} /> {marker.label}
              </button>
            ))
          )}
        </div>
      </div>

      <section className="timeline-marker-list">
        <div className="panel-heading">
          <h3>Markers</h3>
          <Clock size={22} />
        </div>
        {draft.markers.length === 0 ? (
          <p className="empty-copy">Markers help you find the good stuff. Add them while recording, then review them here.</p>
        ) : (
          draft.markers.map((marker) => (
            <article className="marker-review-card" key={marker.id}>
              <div>
                <h4>{marker.label}</h4>
                <p>{formatRecordingTime(marker.timestampMs)}{marker.note ? ` - ${marker.note}` : ""}</p>
              </div>
              <Button variant="secondary" icon={<SkipForward size={18} />} onClick={() => onJumpToMarker(marker.timestampMs)}>
                Jump
              </Button>
            </article>
          ))
        )}
      </section>

      <section className="locked-editing-tools">
        <div>
          <h3>Editing tools are coming next</h3>
          <p className="soft-copy">Trim, Split, Delete, Auto Edit, and Export are locked for later phases.</p>
        </div>
        <div className="locked-tool-grid">
          {draft.lockedTools.map((tool) => (
            <button type="button" disabled key={tool}>
              <Lock size={16} /> {tool}
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}

