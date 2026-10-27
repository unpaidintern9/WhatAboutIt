import { type ReactElement } from "react";
import { ArrowLeft, CheckCircle2, ExternalLink, FileArchive, FileAudio, FolderInput, Home, LoaderCircle, PackageOpen, RectangleVertical, ShieldCheck, Square, Video } from "lucide-react";
import type { EditorVideoPreset, ExportJob, ExportMasteringMode, ExportQualityPreset, ExportType, MediaToolsStatus } from "../../shared/export";
import { exportFriendlyErrorCopy, exportTypeLabels } from "../../shared/export";
import { Button } from ".";

interface ExportEpisodeProps {
  selectedType: ExportType;
  qualityPreset: ExportQualityPreset;
  job?: ExportJob;
  mediaToolsStatus?: MediaToolsStatus;
  selectedRangeMs?: number;
  includeCameraMasters?: boolean;
  includeAudioMasters?: boolean;
  masteringMode?: ExportMasteringMode;
  destinationFolderPath?: string;
  editorVideoPreset?: EditorVideoPreset;
  onEditorVideoPresetChange?: (preset: EditorVideoPreset) => void;
  onTypeChange: (type: ExportType) => void;
  onQualityChange: (preset: ExportQualityPreset) => void;
  onCameraMastersChange?: (included: boolean) => void;
  onAudioMastersChange?: (included: boolean) => void;
  onMasteringModeChange?: (mode: ExportMasteringMode) => void;
  onChooseDestination?: () => void;
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
  "social-clip-placeholder": <RectangleVertical size={24} />,
  "editor-handoff": <PackageOpen size={24} />
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
  includeCameraMasters = false,
  includeAudioMasters = false,
  masteringMode = "measured",
  destinationFolderPath,
  editorVideoPreset = "compatible",
  onEditorVideoPresetChange,
  onTypeChange,
  onQualityChange,
  onCameraMastersChange,
  onAudioMastersChange,
  onMasteringModeChange,
  onChooseDestination,
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
  const isEditorHandoff = selectedType === "editor-handoff";
  const handoffNeedsDestination = isEditorHandoff && !destinationFolderPath;

  const renderFormat = (type: ExportType) => {
    const option = exportTypeLabels[type];
    const selected = selectedType === type;
    return (
      <button
        type="button"
        className={`export-option-card ${selected ? "selected" : ""}`}
        disabled={option.locked || isRunning}
        onClick={() => onTypeChange(type)}
        key={type}
      >
        {exportIcons[type]}
        <strong>{option.title}</strong>
        <span>{option.description}</span>
      </button>
    );
  };

  return (
    <section className="export-screen">
      <div className="export-hero">
        <div>
          <p className="signature">Save a finished copy</p>
          <h2>Export your episode</h2>
          <p className="soft-copy">Your original recording stays safe. Every export gets its own dated folder with its media and notes together.</p>
        </div>
        <div className="original-safe-badge">
          <ShieldCheck size={30} />
          <span>Your original recording stays safe</span>
        </div>
      </div>

      <section className="export-option-grid" aria-label="Export options">
        {(["full-episode-video", "audio-only", "editor-handoff"] as ExportType[]).map(renderFormat)}
      </section>

      <details className="export-more-formats" open={selectedType === "archive-master" || selectedType === "social-clip-placeholder"}><summary>More formats: archive & social clips</summary><div className="export-option-grid">{(["archive-master", "social-clip-placeholder"] as ExportType[]).map(renderFormat)}</div></details>

      <section className="export-settings-panel">
        <div>
          <p className="signature">Keep it simple</p>
          <h3>Quality</h3>
          <p className="soft-copy">{isEditorHandoff ? "Build one organized folder an outside editor can open in nearly any modern editing program." : "High is the best finished episode. Extra source masters are optional, so a normal export stays fast and compact."}</p>
        </div>
        {isEditorHandoff ? (
          <div className="editor-handoff-settings">
            <div className="editor-handoff-summary">
              <strong>Universal editor package</strong>
              <span>Full-length Program and camera files at source resolution and frame rate</span>
              <span>48 kHz, 24-bit WAV microphone files with original channels</span>
              <span>Reference edit, captions, markers, sync map, README, and SHA-256 checksums</span>
              <span>Includes media and edit notes; rebuild the timeline in your editor using the reference edit.</span>
            </div>
            <div className="quality-preset-row" aria-label="Editor source video format">
              <button type="button" aria-pressed={editorVideoPreset === "compatible"} className={editorVideoPreset === "compatible" ? "selected" : ""} disabled={isRunning} onClick={() => onEditorVideoPresetChange?.("compatible")}>
                <strong>Compatible MP4<small>Recommended for sharing</small></strong>
                <span>Smaller H.264 files for Premiere, Resolve, Final Cut, or CapCut.</span>
              </button>
              <button type="button" aria-pressed={editorVideoPreset === "prores"} className={editorVideoPreset === "prores" ? "selected" : ""} disabled={isRunning} onClick={() => onEditorVideoPresetChange?.("prores")}>
                <strong>ProRes 422 MOV</strong>
                <span>Smoother scrubbing in Premiere, Resolve, and Final Cut. Much larger files; choose MP4 for CapCut.</span>
              </button>
            </div>
            <div className="editor-handoff-destination">
              <span><strong>Save destination</strong><small>{destinationFolderPath ?? "Choose an external drive, shared folder, or transfer folder."}</small></span>
              <Button variant={destinationFolderPath ? "secondary" : "primary"} icon={<FolderInput size={18} />} onClick={onChooseDestination}>
                {destinationFolderPath ? "Change destination" : "Choose destination"}
              </Button>
            </div>
          </div>
        ) : null}
        {selectedType === "social-clip-placeholder" ? (
          <p className={socialClipNeedsRange ? "media-tools-status needs-setup" : "media-tools-status ready"} role="status">
            {socialClipNeedsRange ? "Go back to Review and drag across the Program timeline to choose the clip." : `Selected clip: ${(selectedRangeMs! / 1000).toFixed(1)} seconds · 1080×1920 vertical video`}
          </p>
        ) : null}
        {!isEditorHandoff ? <div className="quality-preset-row" aria-label="Quality preset">
          {(["standard", "high", "archive"] as ExportQualityPreset[]).map((preset) => {
            const copy = selectedType === "social-clip-placeholder" ? socialQualityCopy[preset] : qualityCopy[preset];
            return (
              <button
                type="button"
                className={qualityPreset === preset ? "selected" : ""}
                disabled={isRunning} onClick={() => onQualityChange(preset)}
                key={preset}
              >
                <strong>{copy.title}{copy.badge ? <small>{copy.badge}</small> : null}</strong>
                <span>{copy.detail}</span>
              </button>
            );
          })}
        </div> : null}
        {!isEditorHandoff && (selectedType === "full-episode-video" || selectedType === "archive-master") && (
          <details className="export-extra-disclosure"><summary>Advanced: extra source files</summary><div className="export-extra-options" aria-label="Additional export files">
            {selectedType === "full-episode-video" && (
              <label>
                <input type="checkbox" disabled={isRunning} checked={includeCameraMasters} onChange={(event) => onCameraMastersChange?.(event.target.checked)} />
                <span><strong>Camera masters</strong><small>Separate edited video for every camera and its routed microphone. Slowest and largest.</small></span>
              </label>
            )}
            <label>
              <input type="checkbox" disabled={isRunning} checked={includeAudioMasters} onChange={(event) => onAudioMastersChange?.(event.target.checked)} />
              <span><strong>24-bit audio masters</strong><small>Separate WAV files for later remixing or archiving.</small></span>
            </label>
          </div></details>
        )}
        {!isEditorHandoff ? <div className="export-mastering-choice">
          <span><strong>Podcast loudness</strong><small>Measured mastering analyzes the complete mix before applying the final level.</small></span>
          <div className="inspector-segmented" aria-label="Podcast loudness processing">
            <button type="button" className={masteringMode === "measured" ? "selected" : ""} disabled={isRunning} onClick={() => onMasteringModeChange?.("measured")}>Measured</button>
            <button type="button" className={masteringMode === "fast" ? "selected" : ""} disabled={isRunning} onClick={() => onMasteringModeChange?.("fast")}>Fast</button>
          </div>
        </div> : null}
      </section>

      <div className="export-ready-summary" role="region" aria-label="Export summary">
        <div><strong>{exportTypeLabels[selectedType].title}</strong><span>{isEditorHandoff ? `Source format: ${editorVideoPreset === "prores" ? "ProRes MOV" : "Compatible MP4"}` : `Quality: ${qualityPreset}`} · {isEditorHandoff ? destinationFolderPath ?? "Choose a destination" : "Saved in this episode’s Exports folder"}</span><small>{isEditorHandoff ? "Includes original source channels and a reference edit" : `${includeCameraMasters ? "Camera masters included · " : ""}${includeAudioMasters ? "Audio masters included · " : ""}Originals stay unchanged`}</small></div>
        {isEditorHandoff && !destinationFolderPath ? <Button onClick={onChooseDestination}>Choose destination</Button> : null}
        <Button variant="primary" disabled={isRunning || socialClipNeedsRange || handoffNeedsDestination} onClick={onStartExport}>{isRunning ? "Exporting…" : isEditorHandoff ? "Build editor handoff" : isComplete ? "Export again" : "Export"}</Button>
      </div>

      <section className={`export-progress-panel ${!job && mediaToolsStatus?.ready ? "ready-state" : ""}`}>
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
        {job?.outputFolder ? <p className="soft-copy"><strong>Export folder: </strong>{job.outputFolder}</p> : null}
        {isComplete && job?.outputFileNames && job.outputFileNames.length > 1 && (
          <div className="export-output-summary">
            <strong>Your export includes</strong>
            {job.outputFileNames.map((fileName) => <span key={fileName}>{fileName}</span>)}
          </div>
        )}
        <div className="export-actions">
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
