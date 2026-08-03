import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, Download, History, Lock, MousePointer2, Pause, Play, RotateCcw, Save, Scissors, ShieldCheck, SkipForward, Sparkles, Split, Trash2, Undo2, Redo2, Video, Volume2, VolumeX } from "lucide-react";
import type { ReviewMediaAsset, ReviewMediaInventory } from "../../shared/review-media";
import type { TimelineDraft } from "../../shared/timeline";
import {
  addCameraDecision,
  applyTimelineEdit,
  redoTimelineEdit,
  restoreOriginalTimeline,
  selectTimelinePoint,
  selectTimelineTrack,
  setTimelineEditMode,
  undoTimelineEdit,
  updateTimelineTrackMix
} from "../../shared/timeline";
import { Button } from ".";
import { formatRecordingTime } from "../services";

interface TimelineReviewProps {
  draft: TimelineDraft;
  media?: ReviewMediaInventory;
  onDraftChange: (draft: TimelineDraft) => void;
  onSaveDraft: () => void;
  onExport: () => void;
  onAutoEdit: () => void;
}

export function TimelineReview({ draft, media, onDraftChange, onSaveDraft, onExport, onAutoEdit }: TimelineReviewProps) {
  const selectedTimestamp = draft.selection?.timestampMs ?? 0;
  const videoAssets = useMemo(() => media ? [media.program, ...media.cameras] : [], [media]);
  const [selectedVideoId, setSelectedVideoId] = useState("program");
  const videoRef = useRef<HTMLVideoElement>(null);
  const pairedAudioRef = useRef<HTMLAudioElement>(null);
  const selectedVideo = videoAssets.find((asset) => asset.id === selectedVideoId) ?? videoAssets.find((asset) => asset.status === "ready") ?? videoAssets[0];
  const pairedAudio = selectedVideo?.pairedAudioId ? media?.audio.find((asset) => asset.id === selectedVideo.pairedAudioId) : undefined;
  const selectedTrack = draft.tracks.find((track) => track.id === draft.selectedTrackId) ?? draft.tracks[0];

  useEffect(() => {
    if (selectedVideo?.status === "ready") return;
    const firstReady = videoAssets.find((asset) => asset.status === "ready");
    if (firstReady) setSelectedVideoId(firstReady.id);
  }, [selectedVideo?.status, videoAssets]);

  useEffect(() => {
    videoRef.current?.pause();
    pairedAudioRef.current?.pause();
  }, [selectedVideoId]);

  function choosePoint(timestampMs: number, markerId?: string, trackId = draft.selectedTrackId) {
    onDraftChange(selectTimelinePoint(draft, { timestampMs, markerId, trackId, source: markerId ? "marker" : "timeline" }));
    seekSelectedVideo(timestampMs);
  }

  function applyEdit(type: Parameters<typeof applyTimelineEdit>[1]) {
    onDraftChange(applyTimelineEdit(draft, type, new Date().toISOString(), selectedTrack?.id));
  }

  function selectTrack(trackId: string, timestampMs?: number) {
    const selectedDraft = selectTimelineTrack(draft, trackId);
    const nextDraft = timestampMs === undefined
      ? selectedDraft
      : selectTimelinePoint(selectedDraft, { timestampMs, trackId, source: "timeline" });
    onDraftChange(nextDraft);
    const track = nextDraft.tracks.find((candidate) => candidate.id === trackId);
    if (track?.kind === "program" || track?.kind === "camera") setSelectedVideoId(track.sourceAssetId ?? "program");
  }

  function selectAsset(asset: ReviewMediaAsset) {
    const track = draft.tracks.find((candidate) => candidate.sourceAssetId === asset.id);
    if (track) selectTrack(track.id);
    if (asset.kind !== "audio") setSelectedVideoId(asset.id);
  }

  async function playSelectedVideo() {
    if (!videoRef.current) return;
    await videoRef.current.play();
  }

  function pauseSelectedVideo() {
    videoRef.current?.pause();
    pairedAudioRef.current?.pause();
  }

  function seekSelectedVideo(timestampMs: number) {
    const timestampSeconds = Math.max(0, timestampMs / 1000);
    if (videoRef.current) videoRef.current.currentTime = timestampSeconds;
    if (pairedAudioRef.current) pairedAudioRef.current.currentTime = timestampSeconds;
  }

  function syncPairedAudio(play = false) {
    const video = videoRef.current;
    const audio = pairedAudioRef.current;
    if (!video || !audio) return;
    if (Math.abs(audio.currentTime - video.currentTime) > 0.2) audio.currentTime = video.currentTime;
    audio.volume = video.volume;
    if (play) void audio.play().catch(() => undefined);
  }

  return (
    <section className="timeline-review">
      <div className="timeline-hero">
        <div>
          <p className="signature">Markers help you find the good stuff</p>
          <h2>Review your recording</h2>
          <p className="soft-copy">We'll create a polished first draft while keeping your original recording completely safe.</p>
        </div>
        <div className="original-safe-badge">
          <ShieldCheck size={30} />
          <span>Your original recording is still safe.</span>
        </div>
      </div>

      <div className="editor-mode-switch" aria-label="Editing mode">
        <button
          type="button"
          className={draft.editMode === "manual" ? "selected" : ""}
          onClick={() => onDraftChange(setTimelineEditMode(draft, "manual"))}
        >
          <MousePointer2 size={18} /> Manual Edit
          <small>Choose every camera and mic yourself</small>
        </button>
        <button type="button" className={draft.editMode === "auto" ? "selected" : ""} onClick={onAutoEdit}>
          <Sparkles size={18} /> Auto Edit
          <small>Build a draft from real saved sources</small>
        </button>
      </div>

      <div className="timeline-controls">
        <Button variant="primary" icon={<Sparkles size={20} />} onClick={onAutoEdit}>
          Auto Edit
        </Button>
        <Button variant="secondary" icon={<Play size={20} />} disabled={selectedVideo?.status !== "ready"} onClick={() => void playSelectedVideo()}>Play</Button>
        <Button variant="secondary" icon={<Pause size={20} />} disabled={selectedVideo?.status !== "ready"} onClick={pauseSelectedVideo}>Pause</Button>
        <Button variant="secondary" icon={<SkipForward size={20} />} disabled={draft.markers.length === 0} onClick={() => seekSelectedVideo(selectedTimestamp)}>
          Jump to marker
        </Button>
        <Button variant="secondary" icon={<Save size={18} />} onClick={onSaveDraft}>
          Save draft
        </Button>
        <Button variant="secondary" icon={<Download size={20} />} onClick={onExport}>
          Export
        </Button>
      </div>

      <section className="review-media-board" aria-label="Recorded media">
        <div className="program-player-panel review-playback-deck">
          <div className="panel-heading">
            <h3>Recording playback</h3>
            <ShieldCheck size={22} />
          </div>
          <div className="review-source-tabs" aria-label="Recorded video sources">
            {videoAssets.map((asset) => (
              <button
                type="button"
                className={asset.id === selectedVideo?.id ? "selected" : ""}
                onClick={() => selectAsset(asset)}
                title={asset.kind === "camera" ? `${asset.label} plays with ${asset.pairedAudioLabel ?? "its assigned microphone"}` : "Play the finished Program recording"}
                key={asset.id}
              >
                <span>{asset.label}</span>
                <small>{asset.status === "ready" ? "Available" : "Not recorded"}</small>
              </button>
            ))}
          </div>
          {selectedVideo?.status === "ready" && selectedVideo.playbackUrl ? (
            <div className="review-player-stage">
              <video
                key={selectedVideo.playbackUrl}
                ref={videoRef}
                controls
                preload="metadata"
                src={selectedVideo.playbackUrl}
                aria-label={`${selectedVideo.label} playback`}
                onPlay={() => syncPairedAudio(true)}
                onPause={() => pairedAudioRef.current?.pause()}
                onSeeked={() => syncPairedAudio()}
                onTimeUpdate={() => syncPairedAudio()}
                onVolumeChange={() => syncPairedAudio()}
                onEnded={() => pairedAudioRef.current?.pause()}
              />
              {!selectedVideo.includesPairedAudio && pairedAudio?.status === "ready" && pairedAudio.playbackUrl && (
                <audio key={pairedAudio.playbackUrl} ref={pairedAudioRef} preload="metadata" src={pairedAudio.playbackUrl} />
              )}
              <div className={`review-audio-route ${selectedVideo.kind === "program" || pairedAudio?.status === "ready" ? "ready" : "needs-attention"}`}>
                <strong>{selectedVideo.label}</strong>
                <span>
                  {selectedVideo.kind === "program"
                    ? "Program audio is included"
                    : selectedVideo.includesPairedAudio || pairedAudio?.status === "ready"
                      ? `${selectedVideo.pairedAudioLabel} plays with this camera`
                      : `${selectedVideo.pairedAudioLabel ?? "Assigned microphone"} was not recorded separately`}
                </span>
              </div>
            </div>
          ) : (
            <div className="missing-media-state">
              <strong>{selectedVideo?.message ?? "No recorded video found yet"}</strong>
              <span>{selectedVideo?.relativePath ?? "Record an episode to review it here"}</span>
            </div>
          )}
          <p className="soft-copy">Original files are safe. Draft edits stay non-destructive.</p>
        </div>

        <TrackList
          title="Audio files"
          assets={media?.audio ?? []}
          selectedAssetId={selectedTrack?.sourceAssetId}
          onSelect={selectAsset}
          previewAudio
        />
      </section>

      <div className="visual-timeline" aria-label="Draft timeline">
        <div className="timeline-selection-summary">
          <Clock size={18} />
          <span>Selected spot: {formatRecordingTime(selectedTimestamp)}</span>
          <em>{draft.hasUnsavedChanges ? "Auto-saving your draft" : "Draft saved locally"}</em>
          {draft.editLog.length > 0 && <em>Saved edits will be applied during export.</em>}
        </div>
        {draft.tracks.map((track) => (
          <button
            type="button"
            className={`timeline-track ${track.kind} ${draft.selectedTrackId === track.id ? "selected" : ""}`}
            onClick={() => {
              const timestampMs = Math.max(0, Math.floor(draft.durationMs / 2));
              selectTrack(track.id, timestampMs);
              seekSelectedVideo(timestampMs);
            }}
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
          <h3>Edit {selectedTrack?.label ?? "the combined episode"}</h3>
          <p className="soft-copy">Edits apply only to this source. Choose Program when a cut should affect the whole episode.</p>
        </div>
        {selectedTrack && selectedTrack.kind !== "markers" && (
          <div className="source-mix-controls" aria-label={`${selectedTrack.label} episode controls`}>
            <button
              type="button"
              className={selectedTrack.includedInProgram ? "selected" : ""}
              onClick={() => onDraftChange(updateTimelineTrackMix(draft, selectedTrack.id, { includedInProgram: !selectedTrack.includedInProgram }))}
            >
              {selectedTrack.includedInProgram ? <Volume2 size={17} /> : <VolumeX size={17} />}
              {selectedTrack.includedInProgram ? "Included in episode" : "Excluded from episode"}
            </button>
            {selectedTrack.kind === "microphone" && (
              <label>
                Track level <strong>{selectedTrack.volume}%</strong>
                <input
                  aria-label={`${selectedTrack.label} episode volume`}
                  type="range"
                  min="0"
                  max="150"
                  value={selectedTrack.volume}
                  onChange={(event) => onDraftChange(updateTimelineTrackMix(draft, selectedTrack.id, { volume: Number(event.target.value) }))}
                />
              </label>
            )}
            {selectedTrack.kind === "camera" && (
              <button type="button" onClick={() => onDraftChange(addCameraDecision(draft, selectedTrack.id))}>
                <Video size={17} /> Use this camera from selected spot
              </button>
            )}
          </div>
        )}
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
                <span>{draft.tracks.find((track) => track.id === edit.targetTrackId)?.label ?? "Program"} at {formatRecordingTime(edit.timestampMs)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {draft.cameraDecisions.length > 0 && (
        <section className="camera-decision-panel">
          <div className="panel-heading">
            <h3>Combined episode camera plan</h3>
            <Video size={22} />
          </div>
          {draft.cameraDecisions.map((decision) => (
            <div key={decision.id}>
              <strong>{draft.tracks.find((track) => track.id === decision.cameraTrackId)?.label ?? "Camera"}</strong>
              <span>{formatRecordingTime(decision.startMs)} - {decision.source === "auto" ? "Auto Edit" : "Manual"}</span>
              <small>{decision.reason}</small>
            </div>
          ))}
        </section>
      )}

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

function TrackList({
  title,
  assets,
  selectedAssetId,
  onSelect,
  previewAudio = false
}: {
  title: string;
  assets: ReviewMediaAsset[];
  selectedAssetId?: string;
  onSelect?: (asset: ReviewMediaAsset) => void;
  previewAudio?: boolean;
}) {
  return (
    <section className="review-track-list">
      <div className="panel-heading">
        <h3>{title}</h3>
        <Clock size={22} />
      </div>
      {assets.length === 0 ? (
        <p className="empty-copy">No files found yet.</p>
      ) : (
        assets.map((asset) => (
          <article className={`review-track-card ${asset.status} ${selectedAssetId === asset.id ? "selected" : ""}`} key={asset.id}>
            <div>
              <strong>{asset.label}</strong>
              <span>{asset.relativePath}</span>
              <small>{asset.status === "ready" ? `${formatRecordingTime(asset.durationMs ?? 0)} ${asset.codecSummary ?? ""}`.trim() : asset.message}</small>
            </div>
            {previewAudio && asset.status === "ready" && asset.playbackUrl ? (
              <div className="review-track-actions">
                <audio controls src={asset.playbackUrl} aria-label={`${asset.label} audio preview`} />
                <button type="button" onClick={() => onSelect?.(asset)}><Scissors size={15} /> Edit this track</button>
              </div>
            ) : (
              <span className="track-status">{asset.status === "ready" ? "Ready" : asset.message}</span>
            )}
          </article>
        ))
      )}
    </section>
  );
}
