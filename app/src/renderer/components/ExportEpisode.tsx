import { type ReactElement } from "react";
import { ArrowLeft, CheckCircle2, ExternalLink, FileArchive, FileAudio, Home, LoaderCircle, Play, RectangleVertical, ShieldCheck, Square, Video } from "lucide-react";
import type { ExportJob, ExportQualityPreset, ExportType, MediaToolsStatus } from "../../shared/export";
import { exportFriendlyErrorCopy, exportTypeLabels } from "../../shared/export";
import { Button } from ".";

interface ExportEpisodeProps {
  selectedType: ExportType;
  qualityPreset: ExportQualityPreset;
  job?: ExportJob;
  mediaToolsStatus?: MediaToolsStatus;
  selectedRangeMs?: number;
  onTypeChange: (type: ExportType) => void;
  onQualityChange: (preset: ExportQualityPreset) => void;
  onStartExport: () => void;
  onCancelExport: () => void;
  onOpenFolder: () => void;
  onBackToReview: () => void;
  onFinish: () => void;
}

const exportIcons: Record<ExportType, ReactElement> = {
  "full-episode-video": <Video size={24} />,
  "audio-only": <FileAudio size={24} />,
  "archive-master": <FileArchive size={24} />,
  "social-clip-placeholder": <RectangleVertical size={24} />
};

const qualityCopy: Record<ExportQualityPreset, { title: string; detail: string; badge?: string }> = {
  standard: { title: "Standard", detail: "720p video, 48 kHz audio - quickest shareable copy" },
  high: { title: "High", detail: "1080p video, 320 kbps audio - best finished episode", badge: "Recommended" },
  archive: { title: "Archive", detail: "1080p near-master with 24-bit PCM audio - largest file" }
};

const socialQualityCopy: typeof qualityCopy = {
  standard: { title: "Standard", detail: "1080×1920 vertical video - quickest social copy" },
  high: { title: "High", detail: "1080×1920 vertical video - cleaner motion and detail", badge: "Recommended" },
  archive: { title: "Archive", detail: "1080×1920 vertical video - maximum quality, largest file" }
};

export function ExportEpisode({
  selectedType,
  qualityPreset,
  job,
  mediaToolsStatus,
  selectedRangeMs,
  onTypeChange,
  onQualityChange,
  onStartExport,
  onCancelExport,
  onOpenFolder,
  onBackToReview,
  onFinish
}: ExportEpisodeProps) {
  const isRunning = job?.status === "running" || job?.status === "queued";
  const isComplete = job?.status === "complete";
  const isError = job?.status === "error" || job?.status === "canceled";
  const progress = job?.progress ?? 0;
  const activeStage = isComplete ? 4 : progress >= 85 ? 3 : progress >= 45 ? 2 : progress >= 15 ? 1 : 0;
  const stages = ["Prepare", "Mix sources", "Build video", "Verify file", "Done"];
  const socialClipNeedsRange = selectedType === "social-clip-placeholder" && !selectedRangeMs;

  return (
    <section className="export-screen">
      <div className="export-hero">
        <div>
          <p className="signature">Save a finished copy</p>
          <h2>Export your episode</h2>
          <p className="soft-copy">Your original recording stays safe. Pick the finished copy you need and save it locally.</p>
        </div>
        <div className="original-safe-badge">
          <ShieldCheck size={30} />
          <span>Your original recording stays safe</span>
        </div>
      </div>

      <section className="export-option-grid" aria-label="Export options">
        {(Object.keys(exportTypeLabels) as ExportType[]).map((type) => {
          const option = exportTypeLabels[type];
          const selected = selectedType === type;
          return (
            <button
              type="button"
              className={`export-option-card ${selected ? "selected" : ""}`}
              disabled={option.locked}
              onClick={() => onTypeChange(type)}
              key={type}
            >
              {exportIcons[type]}
              <strong>{option.title}</strong>
              <span>{option.description}</span>
            </button>
          );
        })}
      </section>

      <section className="export-settings-panel">
        <div>
          <p className="signature">Keep it simple</p>
          <h3>Quality</h3>
          <p className="soft-copy">High is the best finished episode. Every full export also creates edited camera masters, separate 24-bit audio masters, and an edit decision list.</p>
        </div>
        {selectedType === "social-clip-placeholder" ? (
          <p className={socialClipNeedsRange ? "media-tools-status needs-setup" : "media-tools-status ready"} role="status">
            {socialClipNeedsRange ? "Go back to Review and drag across the Program timeline to choose the clip." : `Selected clip: ${(selectedRangeMs! / 1000).toFixed(1)} seconds · 1080×1920 vertical video`}
          </p>
        ) : null}
        <div className="quality-preset-row" aria-label="Quality preset">
          {(["standard", "high", "archive"] as ExportQualityPreset[]).map((preset) => {
            const copy = selectedType === "social-clip-placeholder" ? socialQualityCopy[preset] : qualityCopy[preset];
            return (
              <button
                type="button"
                className={qualityPreset === preset ? "selected" : ""}
                onClick={() => onQualityChange(preset)}
                key={preset}
              >
                <strong>{copy.title}{copy.badge ? <small>{copy.badge}</small> : null}</strong>
                <span>{copy.detail}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="export-progress-panel">
        <div className="panel-heading">
          <h3>{isComplete ? "Export complete" : isRunning ? "Exporting your episode" : isError ? "Something needs attention before export" : "Ready to export"}</h3>
          {isComplete ? <CheckCircle2 size={24} /> : isRunning ? <LoaderCircle className="export-spinner" size={24} /> : <ShieldCheck size={24} />}
        </div>
        <p className={`media-tools-status ${mediaToolsStatus?.ready ? "ready" : "needs-setup"}`}>
          {mediaToolsStatus?.message ?? "Checking local media tools..."}
        </p>
        <div className="export-stage-strip" aria-label="Export stages">
          {stages.map((stage, index) => (
            <span className={index < activeStage || isComplete ? "complete" : index === activeStage && isRunning ? "active" : ""} key={stage}>
              {index < activeStage || isComplete ? <CheckCircle2 size={15} /> : <i>{index + 1}</i>}
              {stage}
            </span>
          ))}
        </div>
        <div
          className={`export-progress-bar ${isRunning ? "running" : ""}`}
          role="progressbar"
          aria-label="Export progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={job?.progress ?? 0}
        >
          <span style={{ width: `${job?.progress ?? 0}%` }} />
        </div>
        <div className="export-live-status" role="status" aria-live="polite">
          <strong>{isRunning ? `${job?.progress ?? 0}%` : isComplete ? "100%" : ""}</strong>
          <span>{job?.error ? exportFriendlyErrorCopy[job.error] : job?.message ?? "Save a finished copy"}</span>
        </div>
        {isComplete && job?.outputFileNames && job.outputFileNames.length > 1 && (
          <div className="export-output-summary">
            <strong>Your export includes</strong>
            {job.outputFileNames.map((fileName) => <span key={fileName}>{fileName}</span>)}
          </div>
        )}
        <div className="export-actions">
          <Button variant={isComplete ? "secondary" : "primary"} icon={<Play size={20} />} disabled={isRunning || socialClipNeedsRange} onClick={onStartExport}>
            {isRunning ? "Exporting" : isComplete ? "Export again" : "Export"}
          </Button>
          <Button variant="secondary" icon={<Square size={18} />} disabled={!isRunning} onClick={onCancelExport}>
            Cancel export
          </Button>
          <Button variant={isComplete ? "primary" : "secondary"} icon={<ExternalLink size={18} />} disabled={!isComplete} onClick={onOpenFolder}>
            Open export folder
          </Button>
          <Button variant="secondary" icon={<ArrowLeft size={18} />} disabled={isRunning} onClick={onBackToReview}>
            Back to Review
          </Button>
          <Button variant="secondary" icon={<Home size={18} />} disabled={!isComplete} onClick={onFinish}>
            Finish
          </Button>
        </div>
      </section>
    </section>
  );
}
