import { Check, CheckCircle2, Clock, Flower2, ListChecks, Play, Rocket, Scissors, ShieldCheck, Sparkles, Target, Undo2, Zap } from "lucide-react";
import type { AutoEditMode, AutoEditResult } from "../../shared/auto-edit";
import { autoEditModes, createAutoEditStages } from "../../shared/auto-edit";
import { Button } from ".";
import { formatRecordingTime } from "../services";

interface AutoEditReviewProps {
  mode: AutoEditMode;
  result?: AutoEditResult;
  running: boolean;
  onModeChange: (mode: AutoEditMode) => void;
  onRun: () => void;
  onReview: () => void;
  onExport: () => void;
  onToggleSilenceCut: (suggestionId: string) => void;
}

const modeIcons = {
  gentle: <Flower2 size={24} />,
  balanced: <Zap size={24} />,
  "fast-paced": <Rocket size={24} />,
  "clip-hunter": <Target size={24} />
};

export function AutoEditReview({ mode, result, running, onModeChange, onRun, onReview, onExport, onToggleSilenceCut }: AutoEditReviewProps) {
  const stages = running ? createAutoEditStages("timeline-decisions") : (result?.stages ?? createAutoEditStages());
  const report = result?.report;

  return (
    <section className="auto-edit-screen">
      <div className="auto-edit-hero">
        <div>
          <p className="signature">Your offline assistant editor</p>
          <h2>Auto Edit</h2>
          <p className="soft-copy">We'll create a polished first draft while keeping your original recording completely safe.</p>
        </div>
        <div className="original-safe-badge">
          <ShieldCheck size={30} />
          <span>Originals stay untouched</span>
        </div>
      </div>

      <section className="auto-edit-mode-grid" aria-label="Auto Edit modes">
        {autoEditModes.map((item) => (
          <button type="button" className={mode === item.id ? "selected" : ""} onClick={() => onModeChange(item.id)} key={item.id}>
            {modeIcons[item.id]}
            <strong>{item.title}</strong>
            <span>{item.description}</span>
          </button>
        ))}
      </section>

      <section className="auto-edit-progress-panel">
        <div className="panel-heading">
          <h3>{result ? "Your first draft is ready" : running ? "Working on your first draft" : "Ready when you are"}</h3>
          {result ? <CheckCircle2 size={24} /> : <Sparkles size={24} />}
        </div>
        <div className="auto-edit-stage-list">
          {stages.map((stage) => (
            <span className={stage.status} key={stage.id}>
              <i />
              {stage.label}
            </span>
          ))}
        </div>
        <div className="auto-edit-actions">
          <Button variant="primary" icon={<Sparkles size={20} />} disabled={running} onClick={onRun}>
            Auto Edit
          </Button>
          <Button variant="secondary" icon={<Play size={20} />} disabled={!result} onClick={onReview}>
            Review edited playback
          </Button>
          <Button variant="secondary" icon={<Check size={20} />} disabled={!result} onClick={onExport}>
            Export this draft
          </Button>
        </div>
      </section>

      {report && (
        <>
          <section className="auto-edit-summary-grid">
            <article>
              <Clock size={22} />
              <strong>Original length</strong>
              <span>{formatRecordingTime(report.originalLengthMs)}</span>
            </article>
            <article>
              <Clock size={22} />
              <strong>Edited length</strong>
              <span>{formatRecordingTime(report.editedLengthMs)}</span>
            </article>
            <article>
              <Sparkles size={22} />
              <strong>Time saved</strong>
              <span>{formatRecordingTime(report.runtimeReductionMs)}</span>
            </article>
            <article>
              <ListChecks size={22} />
              <strong>Chapters created</strong>
              <span>{report.chaptersGenerated.length}</span>
            </article>
            <article>
              <ShieldCheck size={22} />
              <strong>Style learning</strong>
              <span>{report.learningSummary}</span>
            </article>
          </section>

          <section className="auto-edit-review-grid">
            <AutoEditList title="Chapters" items={report.chaptersGenerated.map((chapter) => `${formatRecordingTime(chapter.timestampMs)} - ${chapter.title}`)} />
            <AutoEditList title="Clip suggestions" items={report.clipsSuggested.map((clip) => `${clip.title}: ${formatRecordingTime(clip.startMs)} to ${formatRecordingTime(clip.endMs)}. ${clip.reason} Confidence: ${clip.confidence}.`)} />
            <AutoEditList title="Production polish and edit plan" items={report.changesMade.map((change) => `${change.label}. Reversible.`)} />
            <AutoEditList
              title="Camera plan"
              items={result.draft.cameraDecisions.length > 0 ? result.draft.cameraDecisions.map((decision) => `${formatRecordingTime(decision.startMs)} - ${decision.reason}`) : ["Program stays on screen. Saved microphone activity was not available for automatic camera choices."]}
            />
            <AutoEditList title="Review-needed items" items={[...report.audioWarnings, ...report.reviewFlags]} />
          </section>
          <section className="auto-edit-silence-review" aria-label="Long pause review">
            <div className="panel-heading">
              <h3>Long pauses</h3>
              <Scissors size={21} />
            </div>
            {report.silenceSuggestions.length === 0 ? (
              <p>No long pauses were removed.</p>
            ) : (
              <div className="auto-edit-silence-list">
                {report.silenceSuggestions.map((suggestion) => (
                  <div className={suggestion.accepted ? "accepted" : "rejected"} key={suggestion.id}>
                    <span>
                      <strong>
                        {formatRecordingTime(suggestion.startMs)} – {formatRecordingTime(suggestion.endMs)}
                      </strong>
                      <small>{formatRecordingTime(suggestion.endMs - suggestion.startMs)} pause</small>
                    </span>
                    <button type="button" aria-pressed={suggestion.accepted} onClick={() => onToggleSilenceCut(suggestion.id)}>
                      {suggestion.accepted ? (
                        <>
                          <Check size={16} /> Remove pause
                        </>
                      ) : (
                        <>
                          <Undo2 size={16} /> Keep pause
                        </>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function AutoEditList({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="auto-edit-list-card">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  );
}
