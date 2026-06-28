import { useEffect, useRef, type ReactElement } from "react";
import { CheckCircle2, ExternalLink, FileArchive, FileAudio, Lock, Play, ShieldCheck, Square, Video } from "lucide-react";
import type { ExportJob, ExportQualityPreset, ExportType, MediaToolsStatus } from "../../shared/export";
import { exportFriendlyErrorCopy, exportTypeLabels } from "../../shared/export";
import { Button } from ".";

interface ExportEpisodeProps {
  selectedType: ExportType;
  qualityPreset: ExportQualityPreset;
  job?: ExportJob;
  mediaToolsStatus?: MediaToolsStatus;
  onTypeChange: (type: ExportType) => void;
  onQualityChange: (preset: ExportQualityPreset) => void;
  onStartExport: () => void;
  onCancelExport: () => void;
  onOpenFolder: () => void;
}

const exportIcons: Record<ExportType, ReactElement> = {
  "full-episode-video": <Video size={24} />,
  "audio-only": <FileAudio size={24} />,
  "archive-master": <FileArchive size={24} />,
  "social-clip-placeholder": <Lock size={24} />
};

export function ExportEpisode({
  selectedType,
  qualityPreset,
  job,
  mediaToolsStatus,
  onTypeChange,
  onQualityChange,
  onStartExport,
  onCancelExport,
  onOpenFolder
}: ExportEpisodeProps) {
  const isRunning = job?.status === "running" || job?.status === "queued";
  const isComplete = job?.status === "complete";
  const isError = job?.status === "error" || job?.status === "canceled";
  const exportButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const exportButton = exportButtonRef.current;
    if (!exportButton) return undefined;
    const handleStartExport = () => {
      if (!exportButton.disabled) onStartExport();
    };
    exportButton.addEventListener("click", handleStartExport);
    return () => exportButton.removeEventListener("click", handleStartExport);
  }, [onStartExport]);

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
          <p className="soft-copy">Standard is great for most episodes. High is a bigger finished copy. Archive is for the keep-forever version.</p>
        </div>
        <div className="quality-preset-row" aria-label="Quality preset">
          {(["standard", "high", "archive"] as ExportQualityPreset[]).map((preset) => (
            <button
              type="button"
              className={qualityPreset === preset ? "selected" : ""}
              onClick={() => onQualityChange(preset)}
              key={preset}
            >
              {preset[0].toUpperCase() + preset.slice(1)}
            </button>
          ))}
        </div>
      </section>

      <section className="export-progress-panel">
        <div className="panel-heading">
          <h3>{isComplete ? "Export complete" : isError ? "Something needs attention before export" : "Ready to export"}</h3>
          {isComplete ? <CheckCircle2 size={24} /> : <ShieldCheck size={24} />}
        </div>
        <p className={`media-tools-status ${mediaToolsStatus?.ready ? "ready" : "needs-setup"}`}>
          {mediaToolsStatus?.message ?? "Checking local media tools..."}
        </p>
        <div className="export-progress-bar" aria-label="Export progress">
          <span style={{ width: `${job?.progress ?? 0}%` }} />
        </div>
        <p className="soft-copy">
          {job?.error ? exportFriendlyErrorCopy[job.error] : job?.message ?? "Save a finished copy"}
        </p>
        <div className="export-actions">
          <Button ref={exportButtonRef} variant="primary" icon={<Play size={20} />} disabled={isRunning || selectedType === "social-clip-placeholder"}>
            Export
          </Button>
          <Button variant="secondary" icon={<Square size={18} />} disabled={!isRunning} onClick={onCancelExport}>
            Cancel export
          </Button>
          <Button variant="secondary" icon={<ExternalLink size={18} />} disabled={!isComplete} onClick={onOpenFolder}>
            Open export folder
          </Button>
        </div>
      </section>
    </section>
  );
}
