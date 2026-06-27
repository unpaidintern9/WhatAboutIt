import { Clock, Download, History, Lock, Pause, Play, RotateCcw, Save, Scissors, ShieldCheck, SkipForward, Sparkles, Split, Trash2, Undo2, Redo2 } from "lucide-react";
import type { TimelineDraft } from "../../shared/timeline";
import { applyTimelineEdit, redoTimelineEdit, restoreOriginalTimeline, selectTimelinePoint, undoTimelineEdit } from "../../shared/timeline";
import { Button } from ".";
import { formatRecordingTime } from "../services";

interface TimelineReviewProps {
  draft: TimelineDraft;
  onDraftChange: (draft: TimelineDraft) => void;
  onSaveDraft: () => void;
  onExport: () => void;
  onAutoEdit: () => void;
}

export function TimelineReview({ draft, onDraftChange, onSaveDraft, onExport, onAutoEdit }: TimelineReviewProps) {
  const selectedTimestamp = draft.selection?.timestampMs ?? 0;

  function choosePoint(timestampMs: number, markerId?: string) {
    onDraftChange(selectTimelinePoint(draft, { timestampMs, markerId, source: markerId ? "marker" : "timeline" }));
  }

  function applyEdit(type: Parameters<typeof applyTimelineEdit>[1]) {
    onDraftChange(applyTimelineEdit(draft, type));
  }

  return (
    <section className="timeline-review">
      <div className="timeline-hero">
        <div>
          <p className="signature">Markers help you find the good stuff</p>
          <h2>Review your episode</h2>
          <p className="soft-copy">We'll create a polished first draft while keeping your original recording completely safe.</p>
        </div>
        <div className="original-safe-badge">
          <ShieldCheck size={30} />
          <span>Your original recording is still safe.</span>
        </div>
      </div>

      <div className="timeline-controls">
        <Button variant="primary" icon={<Sparkles size={20} />} onClick={onAutoEdit}>
          Auto Edit
        </Button>
        <Button variant="secondary" icon={<Play size={20} />}>Play</Button>
        <Button variant="secondary" icon={<Pause size={20} />}>Pause</Button>
        <Button variant="secondary" icon={<SkipForward size={20} />} disabled={draft.markers.length === 0}>
          Jump to marker
        </Button>
        <Button variant="secondary" icon={<Save size={18} />} onClick={onSaveDraft}>
          Save draft
        </Button>
        <Button variant="secondary" icon={<Download size={20} />} onClick={onExport}>
          Export
        </Button>
      </div>

      <div className="visual-timeline" aria-label="Draft timeline">
        <div className="timeline-selection-summary">
          <Clock size={18} />
          <span>Selected spot: {formatRecordingTime(selectedTimestamp)}</span>
          <em>{draft.hasUnsavedChanges ? "Auto-saving your draft" : "Draft saved locally"}</em>
        </div>
        {draft.tracks.map((track) => (
          <button
            type="button"
            className={`timeline-track ${track.kind} ${draft.selection?.source === "timeline" ? "selected" : ""}`}
            onClick={() => choosePoint(Math.max(0, Math.floor(draft.durationMs / 2)))}
            key={track.id}
          >
            <strong>{track.label}</strong>
            <span>{track.placeholder}</span>
            <i />
          </button>
        ))}
        <div className="timeline-marker-row">
          {draft.markers.length === 0 ? (
            <span>No markers yet</span>
          ) : (
            draft.markers.map((marker) => (
              <button type="button" onClick={() => choosePoint(marker.timestampMs, marker.id)} key={marker.id}>
                <Clock size={14} /> {marker.label}
              </button>
            ))
          )}
        </div>
      </div>

      <section className="draft-editing-tools">
        <div>
          <p className="signature">Safe edits, no worries</p>
          <h3>Make a simple draft edit</h3>
          <p className="soft-copy">Pick a spot on the timeline or jump to a marker, then choose what should happen there.</p>
        </div>
        <div className="edit-button-grid" aria-label="Draft editing controls">
          <Button variant="primary" icon={<Scissors size={18} />} onClick={() => applyEdit("trim-before")}>Trim before here</Button>
          <Button variant="secondary" icon={<Split size={18} />} onClick={() => applyEdit("split")}>Split here</Button>
          <Button variant="secondary" icon={<Trash2 size={18} />} onClick={() => applyEdit("delete-section")}>Cut this section</Button>
          <Button variant="secondary" icon={<Undo2 size={18} />} disabled={draft.editLog.length === 0} onClick={() => onDraftChange(undoTimelineEdit(draft))}>Undo</Button>
          <Button variant="secondary" icon={<Redo2 size={18} />} disabled={draft.undoneEditLog.length === 0} onClick={() => onDraftChange(redoTimelineEdit(draft))}>Redo</Button>
          <Button variant="secondary" icon={<RotateCcw size={18} />} onClick={() => onDraftChange(restoreOriginalTimeline(draft))}>Restore original</Button>
        </div>
        <div className="draft-safe-copy">
          <ShieldCheck size={20} />
          <span>Your original recording is still safe.</span>
          <span>This only changes the draft.</span>
          <span>You can undo this anytime.</span>
        </div>
      </section>

      <section className="edit-history-panel">
        <div className="panel-heading">
          <h3>Edit history</h3>
          <History size={22} />
        </div>
        <p className="soft-copy">Draft version {draft.version}. Every change is written to Session/draft-timeline.json.</p>
        {draft.editLog.length === 0 ? (
          <p className="empty-copy">No edits yet. Your draft is waiting, nice and tidy.</p>
        ) : (
          <ol className="edit-history-list">
            {draft.editLog.map((edit) => (
              <li key={edit.id}>
                <strong>{edit.label}</strong>
                <span>{formatRecordingTime(edit.timestampMs)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

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
              <Button variant="secondary" icon={<SkipForward size={18} />} onClick={() => choosePoint(marker.timestampMs, marker.id)}>
                Jump
              </Button>
            </article>
          ))
        )}
      </section>

      {draft.lockedTools.length > 0 && (
        <section className="locked-editing-tools">
          <div>
            <h3>Big finishing tools are coming next</h3>
            <p className="soft-copy">Anything locked here is staged for a later phase.</p>
          </div>
          <div className="locked-tool-grid">
            {draft.lockedTools.map((tool) => (
              <button type="button" disabled key={tool}>
                <Lock size={16} /> {tool}
              </button>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
