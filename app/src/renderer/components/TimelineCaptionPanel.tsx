import { memo, useRef, useState, type ChangeEvent } from "react";
import {
  Captions,
  FileUp,
  LocateFixed,
  Mic2,
  Plus,
  Scissors,
  Search,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import {
  autoTimeTranscript,
  parseTimedCaptionDocument,
} from "../../shared/captions";
import type {
  LocalTranscriptionProgress,
  LocalTranscriptionResult,
  LocalTranscriptionStatus,
} from "../../shared/local-transcription";
import type { TimelineCaptionCue, TimelineDraft } from "../../shared/timeline";
import {
  addTimelineCaption,
  applyTimelineEdit,
  removeTimelineCaption,
  replaceTimelineCaptions,
  setTimelineRange,
  updateTimelineCaption,
} from "../../shared/timeline";
import { formatRecordingTime } from "../services";

interface TimelineCaptionPanelProps {
  draft: TimelineDraft;
  playheadMs: number;
  rangeStartMs: number;
  rangeEndMs: number;
  hasSelectedRange: boolean;
  onDraftChange: (draft: TimelineDraft) => void;
  transcriptionStatus?: LocalTranscriptionStatus;
  transcriptionProgress?: LocalTranscriptionProgress;
  onTranscribeLocally?: () => Promise<LocalTranscriptionResult>;
  onCancelTranscription?: () => Promise<void>;
}

export const TimelineCaptionPanel = memo(function TimelineCaptionPanel({
  draft,
  playheadMs,
  rangeStartMs,
  rangeEndMs,
  hasSelectedRange,
  onDraftChange,
  transcriptionStatus,
  transcriptionProgress,
  onTranscribeLocally,
  onCancelTranscription,
}: TimelineCaptionPanelProps) {
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState(
    "Everything here runs locally; caption files and pasted transcripts are never uploaded.",
  );
  const [transcribing, setTranscribing] = useState(false);
  const [captionSearch, setCaptionSearch] = useState("");
  const [fillersOnly, setFillersOnly] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fillerWordCount = draft.captions.reduce(
    (count, cue) =>
      count + (cue.text.match(/\b(?:um+|uh+|like|you know)\b/gi)?.length ?? 0),
    0,
  );
  const timingStart = hasSelectedRange ? rangeStartMs : 0;
  const timingEnd = hasSelectedRange
    ? rangeEndMs
    : Math.max(draft.durationMs, timingStart + 30000);
  const fillerPattern = /\b(?:um+|uh+|like|you know)\b/i;
  const visibleCues = [...draft.captions]
    .sort((left, right) => left.startMs - right.startMs)
    .filter(
      (cue) =>
        (!captionSearch.trim() ||
          cue.text
            .toLowerCase()
            .includes(captionSearch.trim().toLowerCase())) &&
        (!fillersOnly || fillerPattern.test(cue.text)),
    );

  function selectCue(cue: TimelineCaptionCue) {
    onDraftChange(setTimelineRange(draft, cue.startMs, cue.endMs, "program"));
    setStatus(
      `Selected ${formatRecordingTime(cue.startMs)}–${formatRecordingTime(cue.endMs)} on the Program timeline.`,
    );
  }

  function cutCue(cue: TimelineCaptionCue) {
    const selected = setTimelineRange(draft, cue.startMs, cue.endMs, "program");
    onDraftChange(applyTimelineEdit(selected, "delete-section"));
    setStatus(
      `Removed that transcript range from the finished episode. Undo remains available.`,
    );
  }

  function applyCaptions(
    cues: TimelineCaptionCue[],
    label: string,
    replaceConfirmed = false,
  ) {
    if (cues.length === 0) {
      setStatus("No usable caption lines were found.");
      return;
    }
    if (
      !replaceConfirmed &&
      draft.captions.length > 0 &&
      !window.confirm(
        `Replace the ${draft.captions.length} existing caption cues? You can Undo this change.`,
      )
    )
      return;
    onDraftChange(replaceTimelineCaptions(draft, cues, label));
    setStatus(
      `${cues.length} caption cue${cues.length === 1 ? "" : "s"} added. Review timing while listening, then save the draft.`,
    );
  }

  async function transcribeLocally() {
    if (!onTranscribeLocally) {
      setStatus(
        "Local transcription is available in the installed Windows app.",
      );
      return;
    }
    if (
      draft.captions.length > 0 &&
      !window.confirm(
        `Replace the ${draft.captions.length} existing caption cues? You can Undo this change.`,
      )
    )
      return;
    setTranscribing(true);
    setStatus("Starting free local transcription…");
    try {
      const result = await onTranscribeLocally();
      applyCaptions(result.cues, "Transcribe episode locally", true);
      setStatus(result.message);
    } catch (error) {
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      setStatus(
        normalized.name === "AbortError" || /cancel/i.test(normalized.message)
          ? "Local transcription canceled. Existing captions were left unchanged."
          : `Local transcription failed: ${normalized.message}`,
      );
    } finally {
      setTranscribing(false);
    }
  }

  async function cancelTranscription() {
    setStatus("Canceling local transcription…");
    await onCancelTranscription?.();
  }

  function autoTimePastedTranscript() {
    const cues = autoTimeTranscript(
      transcript,
      timingStart,
      timingEnd,
      `caption-auto-${Date.now()}`,
    );
    applyCaptions(cues, "Auto-time transcript");
  }

  async function importCaptionFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const isTimedFile = /\.(srt|vtt)$/i.test(file.name);
      const timedCues = parseTimedCaptionDocument(
        text,
        `caption-file-${Date.now()}`,
      );
      if (isTimedFile && timedCues.length === 0) {
        setStatus(`${file.name} did not contain valid SRT or WebVTT timing.`);
        return;
      }
      applyCaptions(
        timedCues.length > 0
          ? timedCues
          : autoTimeTranscript(
              text,
              timingStart,
              timingEnd,
              `caption-file-${Date.now()}`,
            ),
        timedCues.length > 0
          ? "Import timed captions"
          : "Auto-time transcript file",
      );
    } catch (error) {
      setStatus(`Caption import failed: ${String(error)}`);
    }
  }

  return (
    <details className="editor-caption-panel">
      <summary>
        <span>
          <Captions size={18} /> Transcript &amp; captions
        </span>
        <small>
          {draft.captions.length} cue{draft.captions.length === 1 ? "" : "s"}
          {fillerWordCount
            ? ` · ${fillerWordCount} filler word${fillerWordCount === 1 ? "" : "s"}`
            : ""}
        </small>
      </summary>
      <div className="editor-caption-toolbar">
        <p>
          Transcribe the episode locally, import SRT/VTT, or paste a transcript
          across {hasSelectedRange ? "the selected range" : "the full episode"}.
          Captions remain editable and export as SRT.
        </p>
        <button
          type="button"
          onClick={() =>
            onDraftChange(
              addTimelineCaption(
                draft,
                playheadMs,
                Math.min(
                  draft.durationMs || playheadMs + 3000,
                  playheadMs + 3000,
                ),
              ),
            )
          }
        >
          <Plus size={16} /> Add at {formatRecordingTime(playheadMs)}
        </button>
      </div>
      <div className="editor-caption-importer">
        <div className="editor-local-transcription">
          <div>
            <strong>
              <Mic2 size={16} /> Free local transcription
            </strong>
            <small>
              {transcriptionStatus?.message ??
                "First use downloads the free English model (about 57 MB). After that it works offline—no API key or per-episode fee."}
            </small>
          </div>
          {transcribing ? (
            <button
              type="button"
              className="danger"
              onClick={() => void cancelTranscription()}
            >
              <Square size={14} /> Cancel
            </button>
          ) : (
            <button
              type="button"
              disabled={transcriptionStatus?.supported === false}
              onClick={() => void transcribeLocally()}
            >
              <Mic2 size={16} /> Transcribe episode locally
            </button>
          )}
        </div>
        {transcribing && transcriptionProgress ? (
          <div className="editor-transcription-progress" aria-live="polite">
            <progress
              aria-label="Local transcription progress"
              max="100"
              value={transcriptionProgress.progress}
            />
            <small>
              {transcriptionProgress.message} {transcriptionProgress.progress}%
            </small>
          </div>
        ) : null}
        <textarea
          aria-label="Transcript to auto-time"
          placeholder="Paste a corrected transcript here…"
          value={transcript}
          onChange={(event) => setTranscript(event.target.value)}
        />
        <div>
          <button
            type="button"
            disabled={!transcript.trim()}
            onClick={autoTimePastedTranscript}
          >
            <Sparkles size={16} /> Auto-time transcript
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            <FileUp size={16} /> Import SRT, VTT, or TXT
          </button>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept=".srt,.vtt,.txt,text/plain"
            onChange={(event) => void importCaptionFile(event)}
          />
        </div>
        <small role="status" aria-live="polite">
          {status}
        </small>
      </div>
      {draft.captions.length === 0 ? (
        <p className="empty-copy">
          No captions yet. Import a caption file, auto-time a transcript, or add
          a line at the playhead.
        </p>
      ) : (
        <>
          <div className="editor-caption-search">
            <label>
              <Search size={15} />
              <input
                aria-label="Search transcript"
                placeholder="Search transcript…"
                value={captionSearch}
                onChange={(event) => setCaptionSearch(event.target.value)}
              />
            </label>
            <button
              type="button"
              className={fillersOnly ? "selected" : ""}
              disabled={fillerWordCount === 0}
              onClick={() => setFillersOnly((current) => !current)}
            >
              Review filler words ({fillerWordCount})
            </button>
          </div>
          {visibleCues.length === 0 ? (
            <p className="empty-copy">No transcript cues match this filter.</p>
          ) : (
            <div className="editor-caption-list">
              {visibleCues.map((cue) => (
                <div className="editor-caption-cue" key={cue.id}>
                  <label>
                    <span>Start</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={(cue.startMs / 1000).toFixed(1)}
                      onChange={(event) =>
                        onDraftChange(
                          updateTimelineCaption(draft, cue.id, {
                            startMs: Number(event.target.value) * 1000,
                          }),
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>End</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={(cue.endMs / 1000).toFixed(1)}
                      onChange={(event) =>
                        onDraftChange(
                          updateTimelineCaption(draft, cue.id, {
                            endMs: Number(event.target.value) * 1000,
                          }),
                        )
                      }
                    />
                  </label>
                  <textarea
                    aria-label={`Caption at ${formatRecordingTime(cue.startMs)}`}
                    placeholder="Type or paste the spoken line…"
                    value={cue.text}
                    onChange={(event) =>
                      onDraftChange(
                        updateTimelineCaption(draft, cue.id, {
                          text: event.target.value,
                        }),
                      )
                    }
                  />
                  <button
                    type="button"
                    title="Select this spoken range on the timeline"
                    onClick={() => selectCue(cue)}
                  >
                    <LocateFixed size={16} />
                  </button>
                  <button
                    type="button"
                    title="Cut this spoken range from the finished episode"
                    onClick={() => cutCue(cue)}
                  >
                    <Scissors size={16} />
                  </button>
                  <button
                    type="button"
                    className="danger"
                    title="Delete caption"
                    onClick={() =>
                      onDraftChange(removeTimelineCaption(draft, cue.id))
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </details>
  );
});
