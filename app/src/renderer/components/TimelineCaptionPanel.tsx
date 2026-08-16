import { memo, useRef, useState, type ChangeEvent } from "react";
import { Captions, FileUp, Plus, Sparkles, Trash2 } from "lucide-react";
import { autoTimeTranscript, parseTimedCaptionDocument } from "../../shared/captions";
import type { TimelineCaptionCue, TimelineDraft } from "../../shared/timeline";
import { addTimelineCaption, removeTimelineCaption, replaceTimelineCaptions, updateTimelineCaption } from "../../shared/timeline";
import { formatRecordingTime } from "../services";

interface TimelineCaptionPanelProps {
  draft: TimelineDraft;
  playheadMs: number;
  rangeStartMs: number;
  rangeEndMs: number;
  hasSelectedRange: boolean;
  onDraftChange: (draft: TimelineDraft) => void;
}

export const TimelineCaptionPanel = memo(function TimelineCaptionPanel({ draft, playheadMs, rangeStartMs, rangeEndMs, hasSelectedRange, onDraftChange }: TimelineCaptionPanelProps) {
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState("Everything here runs locally; caption files and pasted transcripts are never uploaded.");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fillerWordCount = draft.captions.reduce((count, cue) => count + (cue.text.match(/\b(?:um+|uh+|like|you know)\b/gi)?.length ?? 0), 0);
  const timingStart = hasSelectedRange ? rangeStartMs : 0;
  const timingEnd = hasSelectedRange ? rangeEndMs : Math.max(draft.durationMs, timingStart + 30000);

  function applyCaptions(cues: TimelineCaptionCue[], label: string) {
    if (cues.length === 0) {
      setStatus("No usable caption lines were found.");
      return;
    }
    if (draft.captions.length > 0 && !window.confirm(`Replace the ${draft.captions.length} existing caption cues? You can Undo this change.`)) return;
    onDraftChange(replaceTimelineCaptions(draft, cues, label));
    setStatus(`${cues.length} caption cue${cues.length === 1 ? "" : "s"} added. Review timing while listening, then save the draft.`);
  }

  function autoTimePastedTranscript() {
    const cues = autoTimeTranscript(transcript, timingStart, timingEnd, `caption-auto-${Date.now()}`);
    applyCaptions(cues, "Auto-time transcript");
  }

  async function importCaptionFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const isTimedFile = /\.(srt|vtt)$/i.test(file.name);
      const timedCues = parseTimedCaptionDocument(text, `caption-file-${Date.now()}`);
      if (isTimedFile && timedCues.length === 0) {
        setStatus(`${file.name} did not contain valid SRT or WebVTT timing.`);
        return;
      }
      applyCaptions(timedCues.length > 0 ? timedCues : autoTimeTranscript(text, timingStart, timingEnd, `caption-file-${Date.now()}`), timedCues.length > 0 ? "Import timed captions" : "Auto-time transcript file");
    } catch (error) {
      setStatus(`Caption import failed: ${String(error)}`);
    }
  }

  return (
    <details className="editor-caption-panel">
      <summary>
        <span><Captions size={18} /> Transcript &amp; captions</span>
        <small>{draft.captions.length} cue{draft.captions.length === 1 ? "" : "s"}{fillerWordCount ? ` · ${fillerWordCount} filler word${fillerWordCount === 1 ? "" : "s"}` : ""}</small>
      </summary>
      <div className="editor-caption-toolbar">
        <p>Import SRT/VTT, or paste a transcript and distribute it across {hasSelectedRange ? "the selected range" : "the full episode"}. Captions remain editable and export as SRT.</p>
        <button type="button" onClick={() => onDraftChange(addTimelineCaption(draft, playheadMs, Math.min(draft.durationMs || playheadMs + 3000, playheadMs + 3000)))}>
          <Plus size={16} /> Add at {formatRecordingTime(playheadMs)}
        </button>
      </div>
      <div className="editor-caption-importer">
        <textarea aria-label="Transcript to auto-time" placeholder="Paste a corrected transcript here…" value={transcript} onChange={(event) => setTranscript(event.target.value)} />
        <div>
          <button type="button" disabled={!transcript.trim()} onClick={autoTimePastedTranscript}><Sparkles size={16} /> Auto-time transcript</button>
          <button type="button" onClick={() => fileInputRef.current?.click()}><FileUp size={16} /> Import SRT, VTT, or TXT</button>
          <input ref={fileInputRef} className="visually-hidden" type="file" accept=".srt,.vtt,.txt,text/plain" onChange={(event) => void importCaptionFile(event)} />
        </div>
        <small role="status" aria-live="polite">{status}</small>
      </div>
      {draft.captions.length === 0 ? <p className="empty-copy">No captions yet. Import a caption file, auto-time a transcript, or add a line at the playhead.</p> : (
        <div className="editor-caption-list">
          {[...draft.captions].sort((left, right) => left.startMs - right.startMs).map((cue) => (
            <div className="editor-caption-cue" key={cue.id}>
              <label><span>Start</span><input type="number" min="0" step="0.1" value={(cue.startMs / 1000).toFixed(1)} onChange={(event) => onDraftChange(updateTimelineCaption(draft, cue.id, { startMs: Number(event.target.value) * 1000 }))} /></label>
              <label><span>End</span><input type="number" min="0" step="0.1" value={(cue.endMs / 1000).toFixed(1)} onChange={(event) => onDraftChange(updateTimelineCaption(draft, cue.id, { endMs: Number(event.target.value) * 1000 }))} /></label>
              <textarea aria-label={`Caption at ${formatRecordingTime(cue.startMs)}`} placeholder="Type or paste the spoken line…" value={cue.text} onChange={(event) => onDraftChange(updateTimelineCaption(draft, cue.id, { text: event.target.value }))} />
              <button type="button" className="danger" title="Delete caption" onClick={() => onDraftChange(removeTimelineCaption(draft, cue.id))}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}
    </details>
  );
});
