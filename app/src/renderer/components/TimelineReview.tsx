import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  Check,
  Captions,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Eye,
  EyeOff,
  FastForward,
  Gauge,
  Grid2X2,
  GripVertical,
  History,
  Magnet,
  Maximize2,
  Minus,
  MousePointer2,
  Pause,
  Play,
  Plus,
  Redo2,
  Rewind,
  RotateCcw,
  Save,
  Scissors,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Split,
  Trash2,
  Undo2,
  Upload,
  Video,
  VolumeX,
  Waves
} from "lucide-react";
import type { ReviewMediaAsset, ReviewMediaImportProgress, ReviewMediaImportSlot, ReviewMediaInventory, ReviewMediaTreatmentPreview } from "../../shared/review-media";
import type { TimelineAudioPreset, TimelineDraft, TimelineTrack } from "../../shared/timeline";
import {
  addCameraDecision,
  addTimelineCaption,
  applyTimelineTrackTreatmentToKind,
  applyTimelineEdit,
  getActiveCameraTrackId,
  getNextPlayableTimelineTime,
  getTimelineSegments,
  isTimelineTrackAvailableAt,
  redoTimelineEdit,
  removeTimelineCaption,
  resetTimelineTrackControls,
  restoreOriginalTimeline,
  selectTimelinePoint,
  selectTimelineTrack,
  setTimelineEditMode,
  setTimelineRange,
  undoTimelineEdit,
  updateTimelineCameraTransition,
  updateTimelineCaption,
  updateTimelineMastering,
  updateTimelineTrackMix
} from "../../shared/timeline";
import { Button } from ".";
import { formatRecordingTime } from "../services";

interface TimelineReviewProps {
  draft: TimelineDraft;
  media?: ReviewMediaInventory;
  saveState?: "saved" | "saving" | "failed";
  onDraftChange: (draft: TimelineDraft) => void;
  onSaveDraft: () => void;
  onExport: () => void;
  onAutoEdit: () => void;
  onImportMedia?: (slot: ReviewMediaImportSlot) => Promise<string>;
  importProgress?: ReviewMediaImportProgress;
  onCancelImport?: (slot: ReviewMediaImportSlot) => Promise<void>;
  onAutoSync?: () => Promise<string>;
  onRenderTreatmentPreview?: (trackId: string, timestampMs: number) => Promise<ReviewMediaTreatmentPreview>;
}

const audioPresetCopy: Record<TimelineAudioPreset, { label: string; help: string }> = {
  natural: {
    label: "Natural",
    help: "Level only. Keep the original voice character."
  },
  clean: { label: "Clean", help: "Reduce rumble and keep speech clear." },
  warm: { label: "Warm", help: "Add gentle body and podcast compression." },
  broadcast: {
    label: "Broadcast",
    help: "Tighter voice control for a finished show sound."
  }
};

type TimelineTool = "select" | "split";

export function TimelineReview({ draft, media, saveState = "saved", onDraftChange, onSaveDraft, onExport, onAutoEdit, onImportMedia, importProgress, onCancelImport, onAutoSync, onRenderTreatmentPreview }: TimelineReviewProps) {
  const videoAssets = useMemo(() => (media ? [media.program, ...media.cameras] : []), [media]);
  const editableTracks = useMemo(() => draft.tracks.filter((track) => track.kind !== "markers"), [draft.tracks]);
  const [selectedVideoId, setSelectedVideoId] = useState("program");
  const [playheadMs, setPlayheadMs] = useState(draft.selection?.timestampMs ?? 0);
  const [timelineTool, setTimelineTool] = useState<TimelineTool>("select");
  const [timelineZoom, setTimelineZoom] = useState(100);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [mediaSetupMessage, setMediaSetupMessage] = useState("Add up to three camera files and the main podcast audio. Full-quality originals stay protected while lighter copies keep editing responsive.");
  const [mediaSetupBusy, setMediaSetupBusy] = useState<ReviewMediaImportSlot | "sync">();
  const [treatmentPreview, setTreatmentPreview] = useState<ReviewMediaTreatmentPreview>();
  const [treatmentPreviewBusy, setTreatmentPreviewBusy] = useState(false);
  const [treatmentPreviewError, setTreatmentPreviewError] = useState<string>();
  const [showMulticam, setShowMulticam] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pairedAudioRef = useRef<HTMLAudioElement>(null);
  const programAudioRefs = useRef(new Map<string, HTMLAudioElement>());
  const multicamVideoRefs = useRef(new Map<string, HTMLVideoElement>());
  const resumePlaybackRef = useRef(false);
  const decidedCameraTrackId = selectedVideoId === "program" ? getActiveCameraTrackId(draft, playheadMs) : undefined;
  const activeCameraTrackId = decidedCameraTrackId && isTimelineTrackAvailableAt(draft, decidedCameraTrackId, playheadMs) ? decidedCameraTrackId : undefined;
  const activeCameraTrack = draft.tracks.find((track) => track.id === activeCameraTrackId);
  const activeProgramAsset = activeCameraTrack?.sourceAssetId ? videoAssets.find((asset) => asset.id === activeCameraTrack.sourceAssetId && asset.status === "ready") : undefined;
  const selectedVideo = activeProgramAsset ?? videoAssets.find((asset) => asset.id === selectedVideoId) ?? videoAssets.find((asset) => asset.status === "ready") ?? videoAssets[0];
  const selectedVideoTrack = draft.tracks.find((track) => track.sourceAssetId === selectedVideo?.id);
  const selectedVideoOffsetMs = selectedVideoTrack?.syncOffsetMs ?? 0;
  const programMode = selectedVideoId === "program";
  const pairedAudio = selectedVideo?.pairedAudioId ? media?.audio.find((asset) => asset.id === selectedVideo.pairedAudioId) : undefined;
  const programAudioSources = useMemo(() => {
    const candidates = draft.tracks
      .filter((track) => track.kind === "microphone" && track.includedInProgram)
      .map((track) => ({
        track,
        asset: media?.audio.find((asset) => asset.id === track.sourceAssetId && asset.status === "ready")
      }))
      .filter(
        (
          item
        ): item is {
          track: TimelineTrack;
          asset: ReviewMediaAsset & { playbackUrl: string };
        } => Boolean(item.asset?.playbackUrl)
      );
    const anySolo = candidates.some(({ track }) => track.solo && !track.muted);
    return candidates.filter(({ track }) => !track.muted && (!anySolo || track.solo));
  }, [draft.tracks, media?.audio]);
  const useProgramStemMix = programMode && programAudioSources.length > 0;
  const selectedTrack = draft.tracks.find((track) => track.id === draft.selectedTrackId) ?? draft.tracks[0];
  const fillerWordCount = draft.captions.reduce((count, cue) => count + (cue.text.match(/\b(?:um+|uh+|like|you know)\b/gi)?.length ?? 0), 0);
  const rangeStartMs = draft.selection?.timestampMs ?? playheadMs;
  const rangeEndMs = draft.selection?.endTimestampMs ?? Math.min(draft.durationMs, rangeStartMs + 15000);
  const readyCameraCount = media?.cameras.filter((asset) => asset.status === "ready").length ?? 0;
  const readyMicCount = media?.audio.filter((asset) => asset.status === "ready").length ?? 0;
  const hasSelectedRange = draft.selection?.endTimestampMs !== undefined && rangeEndMs > rangeStartMs;
  const saveStatusLabel = saveState === "saving" ? "Saving draft…" : saveState === "failed" ? "Save failed — retry" : draft.hasUnsavedChanges ? "Draft changed" : "Draft saved";
  const liveVideoStyle: CSSProperties | undefined =
    selectedVideoTrack?.kind === "camera"
      ? {
          objectFit: selectedVideoTrack.cropMode === "fill" ? "cover" : "contain",
          filter: `brightness(${100 + selectedVideoTrack.brightness}%) contrast(${selectedVideoTrack.contrast}%) saturate(${selectedVideoTrack.saturation}%)`,
          transform: `translate(${selectedVideoTrack.positionX * 0.18}%, ${selectedVideoTrack.positionY * 0.18}%) scale(${selectedVideoTrack.zoom / 100})`
        }
      : undefined;

  useEffect(() => {
    if (selectedVideo?.status === "ready") return;
    const firstReady = videoAssets.find((asset) => asset.status === "ready");
    if (firstReady) setSelectedVideoId(firstReady.id);
  }, [selectedVideo?.status, videoAssets]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const nextTime = Math.max(0, (playheadMs + selectedVideoOffsetMs) / 1000);
    if (video.readyState >= 1) video.currentTime = Math.min(nextTime, Number.isFinite(video.duration) ? video.duration : nextTime);
  }, [selectedVideo?.playbackUrl, selectedVideoOffsetMs]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
    if (pairedAudioRef.current) pairedAudioRef.current.playbackRate = playbackRate;
    for (const audio of programAudioRefs.current.values()) audio.playbackRate = playbackRate;
    for (const video of multicamVideoRefs.current.values()) video.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(
    () => () => {
      pairedAudioRef.current?.pause();
      for (const audio of programAudioRefs.current.values()) audio.pause();
    },
    []
  );

  function seek(timestampMs: number) {
    const safeTimestamp = Math.max(0, Math.min(timestampMs, draft.durationMs || timestampMs));
    setPlayheadMs(safeTimestamp);
    const videoSeconds = Math.max(0, (safeTimestamp + selectedVideoOffsetMs) / 1000);
    if (videoRef.current) videoRef.current.currentTime = videoSeconds;
    if (pairedAudioRef.current) pairedAudioRef.current.currentTime = Math.max(0, safeTimestamp / 1000);
    syncProgramAudio(safeTimestamp);
  }

  function choosePoint(timestampMs: number, markerId?: string, trackId = draft.selectedTrackId) {
    setPlayheadMs(timestampMs);
    onDraftChange(
      selectTimelinePoint(draft, {
        timestampMs,
        markerId,
        trackId,
        source: markerId ? "marker" : "timeline"
      })
    );
    seek(timestampMs);
  }

  function selectTrack(trackId: string, timestampMs?: number) {
    const selectedDraft = selectTimelineTrack(draft, trackId);
    const nextDraft =
      timestampMs === undefined
        ? selectedDraft
        : selectTimelinePoint(selectedDraft, {
            timestampMs,
            trackId,
            source: "timeline"
          });
    onDraftChange(nextDraft);
    const track = nextDraft.tracks.find((candidate) => candidate.id === trackId);
    if (track?.kind === "program" || track?.kind === "camera") setSelectedVideoId(track.sourceAssetId ?? "program");
    if (timestampMs !== undefined) seek(timestampMs);
  }

  function selectAsset(asset: ReviewMediaAsset) {
    const track = draft.tracks.find((candidate) => candidate.sourceAssetId === asset.id);
    if (track) selectTrack(track.id);
    if (asset.kind !== "audio") setSelectedVideoId(asset.id);
  }

  function applyEdit(type: Parameters<typeof applyTimelineEdit>[1]) {
    const positioned = selectTimelinePoint(draft, {
      timestampMs: playheadMs,
      endTimestampMs: type === "delete-section" ? rangeEndMs : undefined,
      trackId: selectedTrack?.id,
      source: "timeline"
    });
    onDraftChange(applyTimelineEdit(positioned, type, new Date().toISOString(), selectedTrack?.id));
  }

  function updateTrack(track: TimelineTrack, patch: Parameters<typeof updateTimelineTrackMix>[2]) {
    onDraftChange(updateTimelineTrackMix(draft, track.id, patch));
  }

  function markIn() {
    const nextEnd = rangeEndMs > playheadMs ? rangeEndMs : Math.min(draft.durationMs, playheadMs + 15000);
    onDraftChange(setTimelineRange(draft, playheadMs, nextEnd, selectedTrack?.id));
  }

  function markOut() {
    const nextStart = rangeStartMs < playheadMs ? rangeStartMs : Math.max(0, playheadMs - 15000);
    onDraftChange(setTimelineRange(draft, nextStart, playheadMs, selectedTrack?.id));
  }

  async function playSelectedVideo() {
    if (!videoRef.current) return;
    const nextPlayable = programMode ? getNextPlayableTimelineTime(draft, playheadMs) : playheadMs;
    if (nextPlayable === undefined) return;
    if (nextPlayable !== playheadMs) seek(nextPlayable);
    await videoRef.current.play();
  }

  function pauseSelectedVideo() {
    videoRef.current?.pause();
    pairedAudioRef.current?.pause();
    for (const audio of programAudioRefs.current.values()) audio.pause();
    for (const video of multicamVideoRefs.current.values()) video.pause();
  }

  function syncMulticamAngles(timestampMs: number, play = false) {
    for (const camera of media?.cameras ?? []) {
      const video = multicamVideoRefs.current.get(camera.id);
      if (!video) continue;
      const track = draft.tracks.find((candidate) => candidate.sourceAssetId === camera.id);
      const targetSeconds = Math.max(0, (timestampMs + (track?.syncOffsetMs ?? 0)) / 1000);
      if (Math.abs(video.currentTime - targetSeconds) > 0.18) video.currentTime = targetSeconds;
      video.playbackRate = playbackRate;
      if (play && showMulticam) void video.play().catch(() => undefined);
    }
  }

  function syncProgramAudio(timestampMs: number, play = false) {
    for (const { track, asset } of programAudioSources) {
      const audio = programAudioRefs.current.get(asset.id);
      if (!audio) continue;
      const targetSeconds = Math.max(0, (timestampMs + track.syncOffsetMs) / 1000);
      if (Math.abs(audio.currentTime - targetSeconds) > 0.12) audio.currentTime = targetSeconds;
      audio.volume = Math.max(0, Math.min(1, track.volume / 100));
      audio.playbackRate = playbackRate;
      if (play) void audio.play().catch(() => undefined);
    }
  }

  function syncPreviewAudio(play = false) {
    const video = videoRef.current;
    const audio = pairedAudioRef.current;
    if (!video) return;
    const timelineTime = Math.max(0, Math.round(video.currentTime * 1000 - selectedVideoOffsetMs));
    const nextPlayable = programMode ? getNextPlayableTimelineTime(draft, timelineTime) : timelineTime;
    if (programMode && nextPlayable === undefined) {
      pauseSelectedVideo();
      return;
    }
    if (programMode && nextPlayable !== undefined && nextPlayable !== timelineTime) {
      seek(nextPlayable);
      return;
    }
    resumePlaybackRef.current = !video.paused;
    setPlayheadMs(timelineTime);
    syncMulticamAngles(timelineTime, play);
    if (useProgramStemMix) {
      syncProgramAudio(timelineTime, play);
      return;
    }
    if (!audio) return;
    if (Math.abs(audio.currentTime - timelineTime / 1000) > 0.2) audio.currentTime = timelineTime / 1000;
    audio.volume = video.volume;
    audio.playbackRate = playbackRate;
    if (play) void audio.play().catch(() => undefined);
  }

  function loadSelectedVideoAtPlayhead() {
    const video = videoRef.current;
    if (!video) return;
    const target = Math.max(0, (playheadMs + selectedVideoOffsetMs) / 1000);
    video.currentTime = Math.min(target, Number.isFinite(video.duration) ? video.duration : target);
    video.playbackRate = playbackRate;
    if (resumePlaybackRef.current) void video.play().catch(() => undefined);
  }

  function cutToCamera(cameraTrack: TimelineTrack, reason = `${cameraTrack.label} selected during playback`) {
    const positioned = selectTimelinePoint(selectTimelineTrack(draft, cameraTrack.id), {
      timestampMs: playheadMs,
      trackId: cameraTrack.id,
      source: "timeline"
    });
    onDraftChange(addCameraDecision(positioned, cameraTrack.id, "manual", reason));
    setSelectedVideoId("program");
  }

  function snapTimestamp(timestampMs: number) {
    const safeTimestamp = Math.max(0, Math.min(timestampMs, draft.durationMs || timestampMs));
    if (!snapEnabled) return safeTimestamp;
    const snapPoints = [
      0,
      draft.durationMs,
      ...draft.markers.map((marker) => marker.timestampMs),
      ...draft.cameraDecisions.map((decision) => decision.startMs),
      ...draft.editLog.map((edit) => edit.timestampMs),
      ...draft.editLog.flatMap((edit) => (edit.endTimestampMs === undefined ? [] : [edit.endTimestampMs]))
    ];
    const nearest = snapPoints.reduce((best, point) => (Math.abs(point - safeTimestamp) < Math.abs(best - safeTimestamp) ? point : best), safeTimestamp);
    return Math.abs(nearest - safeTimestamp) <= 500 ? nearest : safeTimestamp;
  }

  function scrubTrack(trackId: string, timestampMs: number) {
    const snapped = snapTimestamp(timestampMs);
    selectTrack(trackId, snapped);
  }

  function selectTrackRange(trackId: string, startMs: number, endMs: number) {
    const safeStart = snapTimestamp(Math.min(startMs, endMs));
    const safeEnd = snapTimestamp(Math.max(startMs, endMs));
    const nextDraft = setTimelineRange(selectTimelineTrack(draft, trackId), safeStart, safeEnd, trackId);
    onDraftChange(nextDraft);
    setPlayheadMs(safeStart);
    const track = nextDraft.tracks.find((candidate) => candidate.id === trackId);
    if (track?.kind === "program" || track?.kind === "camera") setSelectedVideoId(track.sourceAssetId ?? "program");
    seek(safeStart);
  }

  function splitTrackAt(trackId: string, timestampMs: number) {
    const snapped = snapTimestamp(timestampMs);
    const positioned = selectTimelinePoint(selectTimelineTrack(draft, trackId), {
      timestampMs: snapped,
      trackId,
      source: "timeline"
    });
    onDraftChange(applyTimelineEdit(positioned, "split", new Date().toISOString(), trackId));
    setPlayheadMs(snapped);
    seek(snapped);
  }

  function handleTrackPoint(trackId: string, timestampMs: number) {
    if (timelineTool === "split") {
      splitTrackAt(trackId, timestampMs);
      return;
    }
    scrubTrack(trackId, timestampMs);
  }

  function dropCameraOnProgram(cameraAssetId: string, timestampMs: number) {
    const cameraTrack = draft.tracks.find((track) => track.kind === "camera" && track.sourceAssetId === cameraAssetId);
    if (!cameraTrack) return;
    const snapped = snapTimestamp(timestampMs);
    const positioned = selectTimelinePoint(selectTimelineTrack(draft, cameraTrack.id), {
      timestampMs: snapped,
      trackId: cameraTrack.id,
      source: "timeline"
    });
    onDraftChange(addCameraDecision(positioned, cameraTrack.id, "manual", `${cameraTrack.label} dragged into the Program timeline`));
    setPlayheadMs(snapped);
    setSelectedVideoId("program");
    seek(snapped);
  }

  function seekMarker(direction: -1 | 1) {
    const orderedMarkers = [...draft.markers].sort((left, right) => left.timestampMs - right.timestampMs);
    const marker = direction < 0 ? [...orderedMarkers].reverse().find((candidate) => candidate.timestampMs < playheadMs - 250) : orderedMarkers.find((candidate) => candidate.timestampMs > playheadMs + 250);
    if (marker) choosePoint(marker.timestampMs, marker.id);
  }

  async function importMedia(slot: ReviewMediaImportSlot) {
    if (!onImportMedia) return;
    setMediaSetupBusy(slot);
    try {
      setMediaSetupMessage(await onImportMedia(slot));
    } catch (error) {
      setMediaSetupMessage(`Import failed: ${String(error)}`);
    } finally {
      setMediaSetupBusy(undefined);
    }
  }

  async function autoSync() {
    if (!onAutoSync) return;
    setMediaSetupBusy("sync");
    try {
      setMediaSetupMessage(await onAutoSync());
    } catch (error) {
      setMediaSetupMessage(`Automatic sync failed: ${String(error)}`);
    } finally {
      setMediaSetupBusy(undefined);
    }
  }

  useEffect(() => {
    function handleEditorKey(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof Element && target.matches("input, select, textarea, [contenteditable='true']")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        onDraftChange(event.shiftKey ? redoTimelineEdit(draft) : undoTimelineEdit(draft));
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        onDraftChange(redoTimelineEdit(draft));
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        if (videoRef.current?.paused) void playSelectedVideo();
        else pauseSelectedVideo();
        return;
      }
      if (event.key.toLowerCase() === "j") {
        event.preventDefault();
        seek(playheadMs - 5000);
        return;
      }
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (videoRef.current?.paused) void playSelectedVideo();
        else pauseSelectedVideo();
        return;
      }
      if (event.key.toLowerCase() === "l") {
        event.preventDefault();
        seek(playheadMs + 5000);
        return;
      }
      if (event.key.toLowerCase() === "s" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        splitTrackAt(selectedTrack?.id ?? "program", playheadMs);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && hasSelectedRange) {
        event.preventDefault();
        applyEdit("delete-section");
        return;
      }
      if (/^[123]$/.test(event.key)) {
        const camera = draft.tracks.filter((track) => track.kind === "camera")[Number(event.key) - 1];
        if (camera) {
          event.preventDefault();
          cutToCamera(camera, `${camera.label} selected with keyboard shortcut ${event.key}`);
        }
      }
    }
    window.addEventListener("keydown", handleEditorKey);
    return () => window.removeEventListener("keydown", handleEditorKey);
  });

  return (
    <section className="timeline-review edit-studio">
      <header className="edit-studio-header">
        <div>
          <p className="signature">Your episode, source by source</p>
          <h2>Edit Studio</h2>
          <p className="soft-copy">Pick a track, choose a moment, and make the change. Originals always stay untouched.</p>
        </div>
        <div className="edit-studio-confidence" aria-label="Episode source readiness">
          <span>
            <Video size={17} />
            <strong>{readyCameraCount}</strong> cameras
          </span>
          <span>
            <Waves size={17} />
            <strong>{readyMicCount}</strong> microphones
          </span>
          <span>
            <ShieldCheck size={17} /> Originals safe
          </span>
          <span className={saveState === "failed" || draft.hasUnsavedChanges ? "needs-attention" : "ready"} role="status" aria-live="polite">
            <Save size={17} /> {saveStatusLabel}
          </span>
        </div>
      </header>

      <div className="editor-mode-switch" aria-label="Editing mode">
        <button type="button" className={draft.editMode === "manual" ? "selected" : ""} onClick={() => onDraftChange(setTimelineEditMode(draft, "manual"))}>
          <MousePointer2 size={18} /> Manual Edit
          <small>Choose each camera, cut, and mic level yourself</small>
        </button>
        <button type="button" className={draft.editMode === "auto" ? "selected" : ""} onClick={onAutoEdit}>
          <Sparkles size={18} /> Auto Edit
          <small>Start with camera choices from saved mic activity</small>
        </button>
      </div>

      <section className="editor-media-setup" aria-label="Episode media setup">
        <div className="editor-media-setup-heading">
          <div>
            <p className="signature">Media setup</p>
            <h3>Three cameras. One synchronized episode.</h3>
          </div>
          <button type="button" disabled={!onAutoSync || Boolean(mediaSetupBusy)} onClick={() => void autoSync()}>
            <Waves size={17} /> {mediaSetupBusy === "sync" ? "Synchronizing…" : "Sync automatically"}
          </button>
        </div>
        <div className="editor-media-slots">
          {(["camera-1", "camera-2", "camera-3", "morgan-mic"] as ReviewMediaImportSlot[]).map((slot) => {
            const asset = slot.startsWith("camera-") ? media?.cameras.find((candidate) => candidate.id === slot) : media?.audio.find((candidate) => candidate.id === slot);
            const label = slot.startsWith("camera-") ? slot.replace("camera-", "Camera ") : "Main audio";
            return (
              <div className={asset?.status === "ready" ? "ready" : "missing"} key={slot}>
                <span>
                  {slot.startsWith("camera-") ? <Video size={17} /> : <Waves size={17} />}
                  <strong>{label}</strong>
                </span>
                <small>{asset?.status === "ready" ? `${asset.codecSummary ?? "Ready"}${asset.durationMs ? ` · ${formatRecordingTime(asset.durationMs)}` : ""}` : "Choose a file"}</small>
                <button type="button" disabled={!onImportMedia || Boolean(mediaSetupBusy)} onClick={() => void importMedia(slot)}>
                  <Upload size={15} /> {mediaSetupBusy === slot ? "Importing…" : asset?.status === "ready" ? "Replace" : "Add file"}
                </button>
                {mediaSetupBusy === slot && importProgress?.slot === slot && (
                  <div className="editor-import-progress">
                    <progress max="100" value={importProgress.progress} aria-label={`${label} import progress`} />
                    <span>{importProgress.progress}% · {importProgress.message}</span>
                    {onCancelImport && <button type="button" className="editor-import-cancel" onClick={() => void onCancelImport(slot)}>Cancel</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="editor-media-message" aria-live="polite">
          {mediaSetupMessage}
        </p>
      </section>

      <details className="editor-caption-panel">
        <summary>
          <span><Captions size={18} /> Transcript &amp; captions</span>
          <small>{draft.captions.length} cue{draft.captions.length === 1 ? "" : "s"}{fillerWordCount ? ` · ${fillerWordCount} filler word${fillerWordCount === 1 ? "" : "s"}` : ""}</small>
        </summary>
        <div className="editor-caption-toolbar">
          <p>Add or paste corrected transcript text at the playhead. Captions export as an editable SRT file and follow deleted timeline ranges.</p>
          <button type="button" onClick={() => onDraftChange(addTimelineCaption(draft, playheadMs, Math.min(draft.durationMs, playheadMs + 3000)))}>
            <Plus size={16} /> Add at {formatRecordingTime(playheadMs)}
          </button>
        </div>
        {draft.captions.length === 0 ? <p className="empty-copy">No captions yet. Move the playhead to a spoken line and add one.</p> : (
          <div className="editor-caption-list">
            {[...draft.captions].sort((left, right) => left.startMs - right.startMs).map((cue) => (
              <div className="editor-caption-cue" key={cue.id}>
                <label>
                  <span>Start</span>
                  <input type="number" min="0" step="0.1" value={(cue.startMs / 1000).toFixed(1)} onChange={(event) => onDraftChange(updateTimelineCaption(draft, cue.id, { startMs: Number(event.target.value) * 1000 }))} />
                </label>
                <label>
                  <span>End</span>
                  <input type="number" min="0" step="0.1" value={(cue.endMs / 1000).toFixed(1)} onChange={(event) => onDraftChange(updateTimelineCaption(draft, cue.id, { endMs: Number(event.target.value) * 1000 }))} />
                </label>
                <textarea
                  aria-label={`Caption at ${formatRecordingTime(cue.startMs)}`}
                  placeholder="Type or paste the spoken line…"
                  value={cue.text}
                  onChange={(event) => onDraftChange(updateTimelineCaption(draft, cue.id, { text: event.target.value }))}
                />
                <button type="button" className="danger" title="Delete caption" onClick={() => onDraftChange(removeTimelineCaption(draft, cue.id))}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </details>

      <section className="edit-studio-workspace">
        <div className="edit-source-monitor">
          <div className="panel-heading">
            <div>
              <span>Source monitor</span>
              <h3>{programMode && activeProgramAsset ? `Program · ${activeProgramAsset.label}` : (selectedVideo?.label ?? "Program video")}</h3>
            </div>
            <strong>{formatRecordingTime(playheadMs)}</strong>
          </div>
          <div className="monitor-view-switch" aria-label="Monitor view">
            <button type="button" className={!showMulticam ? "selected" : ""} onClick={() => setShowMulticam(false)}>
              <Video size={16} /> Program
            </button>
            <button type="button" className={showMulticam ? "selected" : ""} onClick={() => setShowMulticam(true)}>
              <Grid2X2 size={16} /> Multicam
            </button>
            <span>Press 1, 2, or 3 while playing to cut cameras.</span>
          </div>
          <div className="review-source-tabs" aria-label="Recorded video sources">
            {videoAssets.map((asset) => (
              <button
                type="button"
                className={asset.id === selectedVideoId ? "selected" : ""}
                onClick={() => selectAsset(asset)}
                disabled={asset.status !== "ready"}
                draggable={asset.kind === "camera" && asset.status === "ready"}
                onDragStart={(event) => {
                  if (asset.kind !== "camera") return;
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData("application/x-wai-camera", asset.id);
                }}
                title={asset.status === "ready" ? (asset.kind === "camera" ? `${asset.label}: drag onto Program to switch cameras` : `${asset.label} source preview`) : asset.message}
                key={asset.id}
              >
                {asset.kind === "camera" ? <GripVertical className="source-drag-handle" size={15} aria-hidden="true" /> : null}
                <span>{asset.label}</span>
                <small>{asset.status === "ready" ? (asset.codecSummary ?? "Available") : "Not recorded"}</small>
              </button>
            ))}
          </div>
          {showMulticam ? (
            <div className="multicam-grid" aria-label="Multicamera angles">
              {media?.cameras.map((camera, index) => {
                const cameraTrack = draft.tracks.find((track) => track.kind === "camera" && track.sourceAssetId === camera.id);
                const isActive = cameraTrack?.id === activeCameraTrackId;
                return (
                  <button
                    type="button"
                    className={isActive ? "active" : ""}
                    disabled={camera.status !== "ready" || !camera.playbackUrl || !cameraTrack}
                    onClick={() => cameraTrack && cutToCamera(cameraTrack, `${cameraTrack.label} selected from Multicam view`)}
                    title={camera.status === "ready" ? `Cut to ${camera.label} (shortcut ${index + 1})` : camera.message}
                    key={camera.id}
                  >
                    {camera.status === "ready" && camera.playbackUrl ? (
                      <video
                        ref={(element) => {
                          if (element) multicamVideoRefs.current.set(camera.id, element);
                          else multicamVideoRefs.current.delete(camera.id);
                        }}
                        muted
                        playsInline
                        preload="metadata"
                        src={camera.playbackUrl}
                        onLoadedMetadata={(event) => {
                          const offset = cameraTrack?.syncOffsetMs ?? 0;
                          event.currentTarget.currentTime = Math.max(0, (playheadMs + offset) / 1000);
                        }}
                      />
                    ) : (
                      <span className="multicam-missing">Not recorded</span>
                    )}
                    <strong>
                      <kbd>{index + 1}</kbd> {camera.label}
                    </strong>
                  </button>
                );
              })}
            </div>
          ) : null}
          {selectedVideo?.status === "ready" && selectedVideo.playbackUrl ? (
            <div className="review-player-stage">
              <video
                key={selectedVideo.playbackUrl}
                ref={videoRef}
                controls
                preload="metadata"
                src={selectedVideo.playbackUrl}
                muted={useProgramStemMix}
                style={liveVideoStyle}
                aria-label={`${programMode ? "Edited Program" : selectedVideo.label} playback`}
                onLoadedMetadata={loadSelectedVideoAtPlayhead}
                onPlay={() => syncPreviewAudio(true)}
                onPause={pauseSelectedVideo}
                onSeeked={() => syncPreviewAudio()}
                onTimeUpdate={() => syncPreviewAudio()}
                onVolumeChange={() => syncPreviewAudio()}
                onEnded={pauseSelectedVideo}
              />
              {!programMode && !selectedVideo.includesPairedAudio && pairedAudio?.status === "ready" && pairedAudio.playbackUrl ? <audio key={pairedAudio.playbackUrl} ref={pairedAudioRef} preload="metadata" src={pairedAudio.playbackUrl} /> : null}
              {useProgramStemMix
                ? programAudioSources.map(({ track, asset }) => (
                    <audio
                      key={asset.id}
                      ref={(element) => {
                        if (element) programAudioRefs.current.set(asset.id, element);
                        else programAudioRefs.current.delete(asset.id);
                      }}
                      preload="metadata"
                      src={asset.playbackUrl}
                      data-track-id={track.id}
                    />
                  ))
                : null}
              <div className={`review-audio-route ${programMode || pairedAudio?.status === "ready" ? "ready" : "needs-attention"}`}>
                <strong>{programMode ? "Edited Program preview" : (selectedVideo.pairedAudioLabel ?? "No paired mic")}</strong>
                <span>{programMode ? `${useProgramStemMix ? `${programAudioSources.length} microphone tracks mixed live` : "Recorded Program audio"}. Cuts, camera choices, levels, mute, solo, crop and color are previewed here.` : selectedVideo.message}</span>
              </div>
            </div>
          ) : (
            <div className="missing-media-state">
              <strong>{selectedVideo?.message ?? "No recorded video found yet"}</strong>
              <span>{selectedVideo?.relativePath ?? "Record an episode to review it here"}</span>
            </div>
          )}
          <div className="edit-transport" aria-label="Playback controls">
            <button type="button" disabled={!draft.markers.some((marker) => marker.timestampMs < playheadMs - 250)} onClick={() => seekMarker(-1)} title="Previous marker">
              <ChevronLeft size={17} /> Marker
            </button>
            <button type="button" disabled={selectedVideo?.status !== "ready"} onClick={() => void playSelectedVideo()} title="Play selected source">
              <Play size={17} /> Play
            </button>
            <button type="button" disabled={selectedVideo?.status !== "ready"} onClick={pauseSelectedVideo} title="Pause playback">
              <Pause size={17} /> Pause
            </button>
            <button type="button" disabled={selectedVideo?.status !== "ready"} onClick={() => seek(playheadMs - 5000)} title="Go back 5 seconds (J)">
              <Rewind size={17} /> <kbd>J</kbd> 5s
            </button>
            <button type="button" disabled={selectedVideo?.status !== "ready"} onClick={() => seek(playheadMs + 5000)} title="Go forward 5 seconds (L)">
              <FastForward size={17} /> <kbd>L</kbd> 5s
            </button>
            <label className="edit-playback-speed">
              <span>Speed</span>
              <select aria-label="Playback speed" value={playbackRate} onChange={(event) => setPlaybackRate(Number(event.target.value))}>
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option value={rate} key={rate}>{rate}×</option>)}
              </select>
            </label>
            <button type="button" disabled={!draft.markers.some((marker) => marker.timestampMs > playheadMs + 250)} onClick={() => seekMarker(1)} title="Next marker">
              Marker <ChevronRight size={17} />
            </button>
            <input aria-label="Episode playhead" type="range" min="0" max={Math.max(1, draft.durationMs)} value={Math.min(playheadMs, Math.max(1, draft.durationMs))} onChange={(event) => seek(Number(event.target.value))} />
          </div>
        </div>

        <aside className="edit-track-inspector" aria-label="Selected track controls">
          <TrackInspector
            track={selectedTrack}
            draft={draft}
            playheadMs={playheadMs}
            onUpdate={updateTrack}
            onUseCamera={() => cutToCamera(selectedTrack)}
            onTransitionChange={(cameraTransition, cameraTransitionMs) => onDraftChange(updateTimelineCameraTransition(draft, cameraTransition, cameraTransitionMs))}
            onApplyTreatment={() => onDraftChange(applyTimelineTrackTreatmentToKind(draft, selectedTrack.id))}
            onReset={() => onDraftChange(resetTimelineTrackControls(draft, selectedTrack.id))}
            onMasteringChange={(loudnessTargetLufs, truePeakDb) => onDraftChange(updateTimelineMastering(draft, loudnessTargetLufs, truePeakDb))}
            preview={treatmentPreview?.trackId === selectedTrack.id ? treatmentPreview : undefined}
            previewBusy={treatmentPreviewBusy}
            previewError={treatmentPreviewError}
            onRenderPreview={onRenderTreatmentPreview ? async () => {
              setTreatmentPreviewBusy(true);
              setTreatmentPreviewError(undefined);
              try {
                setTreatmentPreview(await onRenderTreatmentPreview(selectedTrack.id, playheadMs));
              } catch (error) {
                setTreatmentPreviewError(error instanceof Error ? error.message : String(error));
              } finally {
                setTreatmentPreviewBusy(false);
              }
            } : undefined}
          />
        </aside>
      </section>

      <section className="edit-direct-toolbar" aria-label="Timeline editing tools">
        <div className="timeline-tool-group" role="toolbar" aria-label="Edit tool">
          <button type="button" className={timelineTool === "select" ? "selected" : ""} onClick={() => setTimelineTool("select")} title="Select, scrub, or drag a range">
            <MousePointer2 size={17} /> Select
          </button>
          <button type="button" className={timelineTool === "split" ? "selected" : ""} onClick={() => setTimelineTool("split")} title="Click a track to split it">
            <Split size={17} /> Split
          </button>
          <button type="button" className="danger" disabled={!hasSelectedRange} onClick={() => applyEdit("delete-section")} title="Remove the selected range">
            <Trash2 size={17} /> Delete range
          </button>
          <button type="button" disabled={draft.history.length === 0 && draft.editLog.length === 0} onClick={() => onDraftChange(undoTimelineEdit(draft))} title="Undo">
            <Undo2 size={17} />
          </button>
          <button type="button" disabled={draft.redoHistory.length === 0 && draft.undoneEditLog.length === 0} onClick={() => onDraftChange(redoTimelineEdit(draft))} title="Redo">
            <Redo2 size={17} />
          </button>
        </div>
        <div className="timeline-selection-readout">
          <div>
            <span>Playhead</span>
            <strong>{formatRecordingTime(playheadMs)}</strong>
          </div>
          <button type="button" onClick={markIn} title="Set range start at the playhead">
            In
          </button>
          <div>
            <span>Range</span>
            <strong>
              {formatRecordingTime(rangeStartMs)} - {formatRecordingTime(rangeEndMs)}
            </strong>
          </div>
          <button type="button" onClick={markOut} title="Set range end at the playhead">
            Out
          </button>
        </div>
        <div className="timeline-view-controls">
          <button type="button" className={snapEnabled ? "selected" : ""} onClick={() => setSnapEnabled((current) => !current)} title={snapEnabled ? "Turn snapping off" : "Snap to markers and cuts"}>
            <Magnet size={17} />
          </button>
          <button type="button" disabled={timelineZoom <= 100} onClick={() => setTimelineZoom((current) => Math.max(100, current - 25))} title="Zoom timeline out">
            <Minus size={17} />
          </button>
          <input aria-label="Timeline zoom" type="range" min="100" max="300" step="25" value={timelineZoom} onChange={(event) => setTimelineZoom(Number(event.target.value))} />
          <strong>{timelineZoom}%</strong>
          <button type="button" disabled={timelineZoom >= 300} onClick={() => setTimelineZoom((current) => Math.min(300, current + 25))} title="Zoom timeline in">
            <Plus size={17} />
          </button>
        </div>
      </section>

      <div className="pro-timeline-viewport">
        <section className={`pro-timeline tool-${timelineTool}`} style={{ width: `${timelineZoom}%` } as CSSProperties} aria-label="Synchronized episode timeline">
          <div className="timeline-time-ruler" aria-hidden="true">
            {[0, 0.25, 0.5, 0.75, 1].map((position) => (
              <span style={{ left: `${position * 100}%` }} key={position}>
                {formatRecordingTime(draft.durationMs * position)}
              </span>
            ))}
          </div>
          {editableTracks.map((track) => (
            <TrackLane
              key={track.id}
              track={track}
              draft={draft}
              selected={track.id === selectedTrack?.id}
              playheadMs={playheadMs}
              tool={timelineTool}
              onPoint={(timestampMs) => handleTrackPoint(track.id, timestampMs)}
              onRange={(startMs, endMs) => selectTrackRange(track.id, startMs, endMs)}
              onSplit={(timestampMs) => splitTrackAt(track.id, timestampMs)}
              onCameraDrop={track.kind === "program" ? dropCameraOnProgram : undefined}
              onToggleMute={() => updateTrack(track, { muted: !track.muted })}
              onToggleSolo={() => updateTrack(track, { solo: !track.solo })}
              waveformUrl={track.kind === "microphone" ? media?.audio.find((asset) => asset.id === track.sourceAssetId)?.waveformUrl : undefined}
            />
          ))}
          <div className="timeline-marker-lane">
            <strong>Markers</strong>
            <div>
              {draft.markers.map((marker) => (
                <button
                  type="button"
                  style={{
                    left: `${draft.durationMs > 0 ? (marker.timestampMs / draft.durationMs) * 100 : 0}%`
                  }}
                  onClick={() => choosePoint(marker.timestampMs, marker.id)}
                  title={`${marker.label} at ${formatRecordingTime(marker.timestampMs)}`}
                  key={marker.id}
                >
                  <Clock size={13} /> {marker.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className="edit-command-bar">
        <div>
          <strong>Edit {selectedTrack?.label ?? "Program"}</strong>
          <span>Program cuts shorten the whole episode. Source cuts affect only that camera or mic.</span>
        </div>
        <div className="edit-button-grid" aria-label="Draft editing controls">
          <Button variant="secondary" icon={<Scissors size={17} />} onClick={() => applyEdit("trim-before")}>
            Trim start
          </Button>
          <Button variant="secondary" icon={<Scissors size={17} />} onClick={() => applyEdit("trim-after")}>
            Trim end
          </Button>
          <Button variant="secondary" icon={<RotateCcw size={17} />} onClick={() => onDraftChange(restoreOriginalTimeline(draft))}>
            Restore
          </Button>
        </div>
        <div className="edit-finish-actions">
          <Button variant="secondary" icon={<Save size={18} />} onClick={onSaveDraft}>
            Save draft
          </Button>
          <Button variant="primary" icon={<Download size={19} />} onClick={onExport}>
            Save &amp; Export
          </Button>
        </div>
      </section>

      {draft.cameraDecisions.length > 0 ? (
        <section className="camera-decision-panel">
          <div className="panel-heading">
            <h3>Episode camera plan</h3>
            <Video size={20} />
          </div>
          {draft.cameraDecisions.map((decision) => (
            <div key={decision.id}>
              <strong>{draft.tracks.find((track) => track.id === decision.cameraTrackId)?.label ?? "Camera"}</strong>
              <span>
                {formatRecordingTime(decision.startMs)} - {decision.source === "auto" ? "Auto Edit" : "Manual"}
              </span>
              <small>{decision.reason}</small>
            </div>
          ))}
        </section>
      ) : null}

      <section className="edit-history-panel">
        <div className="panel-heading">
          <h3>Edit history</h3>
          <History size={20} />
        </div>
        {draft.editLog.length === 0 ? (
          <p className="empty-copy">No cuts yet. Pick a track and choose a moment.</p>
        ) : (
          <ol className="edit-history-list">
            {draft.editLog.map((edit) => (
              <li key={edit.id}>
                <strong>{edit.label}</strong>
                <span>
                  {draft.tracks.find((track) => track.id === edit.targetTrackId)?.label ?? "Program"} at {formatRecordingTime(edit.timestampMs)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}

function TrackLane({
  track,
  draft,
  selected,
  playheadMs,
  tool,
  onPoint,
  onRange,
  onSplit,
  onCameraDrop,
  onToggleMute,
  onToggleSolo,
  waveformUrl
}: {
  track: TimelineTrack;
  draft: TimelineDraft;
  selected: boolean;
  playheadMs: number;
  tool: TimelineTool;
  onPoint: (timestampMs: number) => void;
  onRange: (startMs: number, endMs: number) => void;
  onSplit: (timestampMs: number) => void;
  onCameraDrop?: (cameraAssetId: string, timestampMs: number) => void;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  waveformUrl?: string;
}) {
  const segments = getTimelineSegments(draft, track.id);
  const durationMs = Math.max(1, draft.durationMs);
  const clipsRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ timestampMs: number; pointerId: number } | undefined>(undefined);
  const [dragSelection, setDragSelection] = useState<{
    startMs: number;
    endMs: number;
  }>();
  const [dropReady, setDropReady] = useState(false);
  const savedSelection =
    selected && draft.selection?.trackId === track.id && draft.selection.endTimestampMs !== undefined
      ? {
          startMs: draft.selection.timestampMs,
          endMs: draft.selection.endTimestampMs
        }
      : undefined;
  const visibleSelection = dragSelection ?? savedSelection;

  function timestampFromClientX(clientX: number) {
    const bounds = clipsRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return playheadMs;
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    return ratio * durationMs;
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const timestampMs = timestampFromClientX(event.clientX);
    if (tool === "split") {
      onSplit(timestampMs);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = { timestampMs, pointerId: event.pointerId };
    setDragSelection({ startMs: timestampMs, endMs: timestampMs });
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setDragSelection({
      startMs: Math.min(start.timestampMs, timestampFromClientX(event.clientX)),
      endMs: Math.max(start.timestampMs, timestampFromClientX(event.clientX))
    });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const endMs = timestampFromClientX(event.clientX);
    const distanceMs = Math.abs(endMs - start.timestampMs);
    if (distanceMs >= Math.max(250, durationMs * 0.002)) onRange(start.timestampMs, endMs);
    else onPoint(endMs);
    dragStartRef.current = undefined;
    setDragSelection(undefined);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!onCameraDrop) return;
    event.preventDefault();
    setDropReady(false);
    const cameraAssetId = event.dataTransfer.getData("application/x-wai-camera");
    if (cameraAssetId) onCameraDrop(cameraAssetId, timestampFromClientX(event.clientX));
  }

  return (
    <div className={`edit-track-lane ${track.kind} ${selected ? "selected" : ""} ${track.muted ? "muted" : ""} ${dropReady ? "drop-ready" : ""}`}>
      <div className="edit-track-header">
        <button type="button" className="track-name" onClick={() => onRange(playheadMs, Math.min(durationMs, playheadMs + 15000))}>
          {track.kind === "microphone" ? <Waves size={16} /> : <Video size={16} />}
          <span>
            <strong>{track.label}</strong>
            <small>{track.kind === "program" ? "Final episode" : track.kind === "camera" ? "Video source" : "Audio source"}</small>
          </span>
        </button>
        {track.kind === "microphone" ? (
          <div className="track-quick-controls">
            <button type="button" className={track.muted ? "selected" : ""} onClick={onToggleMute} title={`Mute ${track.label}`}>
              M
            </button>
            <button type="button" className={track.solo ? "selected" : ""} onClick={onToggleSolo} title={`Solo ${track.label}`}>
              S
            </button>
          </div>
        ) : null}
      </div>
      <div
        ref={clipsRef}
        className={`edit-track-clips ${waveformUrl ? "has-waveform" : ""}`}
        style={
          waveformUrl
            ? ({
                "--waveform-image": `url(${JSON.stringify(waveformUrl).slice(1, -1)})`
              } as CSSProperties)
            : undefined
        }
        role="group"
        aria-label={`${track.label} timeline`}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          dragStartRef.current = undefined;
          setDragSelection(undefined);
        }}
        onDoubleClick={(event) => {
          if (tool === "select") onSplit(timestampFromClientX(event.clientX));
        }}
        onDragEnter={(event) => {
          if (!onCameraDrop) return;
          event.preventDefault();
          setDropReady(true);
        }}
        onDragOver={(event) => {
          if (!onCameraDrop) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={() => setDropReady(false)}
        onDrop={handleDrop}
      >
        {segments.map((segment) => {
          const activeCameraId = track.kind === "program" ? getActiveCameraTrackId(draft, segment.startMs) : undefined;
          const segmentLabel = activeCameraId ? (draft.tracks.find((candidate) => candidate.id === activeCameraId)?.label ?? track.label) : track.label;
          const isSelectedClip = selected && draft.selection?.trackId === track.id && draft.selection.timestampMs === segment.startMs && draft.selection.endTimestampMs === segment.endMs;
          return (
            <button
              type="button"
              className={`timeline-clip ${segment.removed ? "removed" : ""} ${activeCameraId ?? ""}`}
              style={{
                width: `${((segment.endMs - segment.startMs) / durationMs) * 100}%`
              }}
              aria-pressed={isSelectedClip}
              draggable={track.kind === "camera" && Boolean(track.sourceAssetId) && !segment.removed}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                if (!segment.removed) onRange(segment.startMs, segment.endMs);
              }}
              onDoubleClick={() => {
                if (!segment.removed) onSplit(segment.startMs + (segment.endMs - segment.startMs) / 2);
              }}
              onDragStart={(event) => {
                if (track.kind !== "camera" || !track.sourceAssetId || segment.removed) return;
                event.stopPropagation();
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData("application/x-wai-camera", track.sourceAssetId);
              }}
              title={`${track.label}: ${formatRecordingTime(segment.startMs)} to ${formatRecordingTime(segment.endMs)}${segment.removed ? ", removed" : track.kind === "camera" ? ". Drag onto Program to use this camera." : ""}`}
              key={segment.id}
            >
              <i />
              <span>{segment.removed ? "Removed" : segmentLabel}</span>
            </button>
          );
        })}
        {visibleSelection ? (
          <span
            className="timeline-range-selection"
            style={{
              left: `${(Math.min(visibleSelection.startMs, visibleSelection.endMs) / durationMs) * 100}%`,
              width: `${(Math.abs(visibleSelection.endMs - visibleSelection.startMs) / durationMs) * 100}%`
            }}
            aria-hidden="true"
          >
            <i />
            <i />
          </span>
        ) : null}
        <i className="timeline-playhead" style={{ left: `${(playheadMs / durationMs) * 100}%` }} />
      </div>
    </div>
  );
}

function TrackInspector({
  track,
  draft,
  playheadMs,
  onUpdate,
  onUseCamera,
  onTransitionChange,
  onApplyTreatment,
  onReset,
  onMasteringChange,
  preview,
  previewBusy,
  previewError,
  onRenderPreview
}: {
  track: TimelineTrack;
  draft: TimelineDraft;
  playheadMs: number;
  onUpdate: (track: TimelineTrack, patch: Parameters<typeof updateTimelineTrackMix>[2]) => void;
  onUseCamera: () => void;
  onTransitionChange: (transition: "cut" | "fade", durationMs: number) => void;
  onApplyTreatment: () => void;
  onReset: () => void;
  onMasteringChange: (loudnessTargetLufs: number, truePeakDb: number) => void;
  preview?: ReviewMediaTreatmentPreview;
  previewBusy?: boolean;
  previewError?: string;
  onRenderPreview?: () => Promise<void>;
}) {
  const selectedAsset = track.sourceAssetId;
  const isAudio = track.kind === "microphone";
  const isVideo = track.kind === "camera";
  return (
    <>
      <div className="inspector-heading">
        <div>{isAudio ? <Waves size={19} /> : <SlidersHorizontal size={19} />}</div>
        <span>
          <small>Selected track</small>
          <strong>{track.label}</strong>
        </span>
      </div>
      <div className="inspector-status">
        <span>{selectedAsset ?? "Combined episode"}</span>
        <strong>{track.includedInProgram && !track.muted ? "In episode" : "Not in episode"}</strong>
      </div>
      {(isAudio || isVideo) && (
        <div className="inspector-effect-preview">
          <button type="button" className="inspector-primary" disabled={!onRenderPreview || previewBusy} onClick={() => void onRenderPreview?.()}>
            <Play size={16} /> {previewBusy ? "Rendering 10-second preview…" : "Preview current effects"}
          </button>
          {preview?.kind === "audio" && <audio controls autoPlay src={preview.playbackUrl} />}
          {preview?.kind === "video" && <video controls autoPlay src={preview.playbackUrl} />}
          {previewError && <small role="alert">{previewError}</small>}
        </div>
      )}
      {track.kind !== "markers" ? (
        <button type="button" className={`inspector-toggle ${track.includedInProgram ? "selected" : ""}`} onClick={() => onUpdate(track, { includedInProgram: !track.includedInProgram })}>
          {track.includedInProgram ? <Eye size={17} /> : <EyeOff size={17} />}
          {track.includedInProgram ? "Included in episode" : "Excluded from episode"}
        </button>
      ) : null}

      {isAudio ? (
        <>
          <div className="inspector-button-pair">
            <button type="button" className={track.muted ? "selected" : ""} onClick={() => onUpdate(track, { muted: !track.muted })}>
              <VolumeX size={16} /> Mute
            </button>
            <button type="button" className={track.solo ? "selected" : ""} onClick={() => onUpdate(track, { solo: !track.solo })}>
              <Gauge size={16} /> Solo
            </button>
          </div>
          <InspectorRange label="Voice level" value={track.volume} min={0} max={150} suffix="%" onChange={(volume) => onUpdate(track, { volume })} />
          <InspectorRange label="Left / Right" value={track.pan} min={-100} max={100} suffix={track.pan === 0 ? " Center" : track.pan < 0 ? " L" : " R"} onChange={(pan) => onUpdate(track, { pan })} />
          <label className="inspector-select">
            <span>Voice sound</span>
            <select
              aria-label={`${track.label} voice sound`}
              value={track.audioPreset}
              onChange={(event) =>
                onUpdate(track, {
                  audioPreset: event.target.value as TimelineAudioPreset
                })
              }
            >
              {(Object.entries(audioPresetCopy) as Array<[TimelineAudioPreset, { label: string; help: string }]>).map(([id, preset]) => (
                <option value={id} key={id}>
                  {preset.label}
                </option>
              ))}
            </select>
            <small>{audioPresetCopy[track.audioPreset].help}</small>
          </label>
          <details className="editor-tool-group" open>
            <summary>Voice cleanup</summary>
            <small>Voice cleanup, tone, fades, and output protection are rendered in the final export.</small>
            <InspectorRange label="Noise cleanup" value={track.noiseReduction} min={0} max={100} suffix="%" onChange={(noiseReduction) => onUpdate(track, { noiseReduction })} />
            <InspectorRange label="Noise gate" value={track.noiseGateDb} min={-80} max={-20} suffix={track.noiseGateDb === -80 ? " Off" : " dB"} onChange={(noiseGateDb) => onUpdate(track, { noiseGateDb })} />
            <InspectorRange label="De-ess" value={track.deEsser} min={0} max={100} suffix="%" onChange={(deEsser) => onUpdate(track, { deEsser })} />
            <InspectorRange label="Compression" value={track.compression} min={0} max={100} suffix="%" onChange={(compression) => onUpdate(track, { compression })} />
          </details>
          <details className="editor-tool-group">
            <summary>Three-band tone</summary>
            <InspectorRange label="Low" value={track.eqLowDb} min={-12} max={12} suffix=" dB" onChange={(eqLowDb) => onUpdate(track, { eqLowDb })} />
            <InspectorRange label="Mid" value={track.eqMidDb} min={-12} max={12} suffix=" dB" onChange={(eqMidDb) => onUpdate(track, { eqMidDb })} />
            <InspectorRange label="High" value={track.eqHighDb} min={-12} max={12} suffix=" dB" onChange={(eqHighDb) => onUpdate(track, { eqHighDb })} />
          </details>
          <div className="inspector-number-pair">
            <InspectorNumber label="Fade in" value={track.fadeInMs} suffix="ms" onChange={(fadeInMs) => onUpdate(track, { fadeInMs })} />
            <InspectorNumber label="Fade out" value={track.fadeOutMs} suffix="ms" onChange={(fadeOutMs) => onUpdate(track, { fadeOutMs })} />
          </div>
          <button type="button" className={`inspector-toggle ${track.limiterEnabled ? "selected" : ""}`} onClick={() => onUpdate(track, { limiterEnabled: !track.limiterEnabled })}>
            <Gauge size={17} /> {track.limiterEnabled ? "Output protection On" : "Output protection Off"}
          </button>
        </>
      ) : null}

      {isVideo ? (
        <>
          <button type="button" className="inspector-primary" onClick={onUseCamera}>
            <Video size={17} /> Use from {formatRecordingTime(playheadMs)}
          </button>
          <div className="inspector-segmented" aria-label={`${track.label} framing`}>
            <button type="button" className={track.cropMode === "fit" ? "selected" : ""} onClick={() => onUpdate(track, { cropMode: "fit" })}>
              <Maximize2 size={15} /> Fit
            </button>
            <button type="button" className={track.cropMode === "fill" ? "selected" : ""} onClick={() => onUpdate(track, { cropMode: "fill" })}>
              <Check size={15} /> Fill
            </button>
          </div>
          <details className="editor-tool-group" open>
            <summary>Frame and position</summary>
            <InspectorRange label="Zoom" value={track.zoom} min={100} max={160} suffix="%" onChange={(zoom) => onUpdate(track, { zoom })} />
            <InspectorRange label="Horizontal" value={track.positionX} min={-100} max={100} onChange={(positionX) => onUpdate(track, { positionX })} />
            <InspectorRange label="Vertical" value={track.positionY} min={-100} max={100} onChange={(positionY) => onUpdate(track, { positionY })} />
          </details>
          <InspectorRange label="Brightness" value={track.brightness} min={-100} max={100} onChange={(brightness) => onUpdate(track, { brightness })} />
          <InspectorRange label="Contrast" value={track.contrast} min={50} max={200} suffix="%" onChange={(contrast) => onUpdate(track, { contrast })} />
          <InspectorRange label="Color" value={track.saturation} min={0} max={200} suffix="%" onChange={(saturation) => onUpdate(track, { saturation })} />
          <details className="editor-tool-group">
            <summary>Camera finishing</summary>
            <small>These finishing controls are rendered in the final export.</small>
            <InspectorRange label="Temperature" value={track.temperature} min={-100} max={100} onChange={(temperature) => onUpdate(track, { temperature })} />
            <InspectorRange label="Tint" value={track.tint} min={-100} max={100} onChange={(tint) => onUpdate(track, { tint })} />
            <InspectorRange label="Video denoise" value={track.denoise} min={0} max={100} suffix="%" onChange={(denoise) => onUpdate(track, { denoise })} />
            <InspectorRange label="Sharpness" value={track.sharpness} min={0} max={100} suffix="%" onChange={(sharpness) => onUpdate(track, { sharpness })} />
          </details>
          <div className="inspector-transition">
            <span>Camera changes</span>
            <div className="inspector-segmented" aria-label="Camera transition">
              <button type="button" className={draft.cameraTransition === "cut" ? "selected" : ""} onClick={() => onTransitionChange("cut", draft.cameraTransitionMs)}>
                Clean cut
              </button>
              <button type="button" className={draft.cameraTransition === "fade" ? "selected" : ""} onClick={() => onTransitionChange("fade", draft.cameraTransitionMs)}>
                Fade through black
              </button>
            </div>
            {draft.cameraTransition === "fade" ? <InspectorRange label="Fade length" value={draft.cameraTransitionMs} min={100} max={1000} step={50} suffix="ms" onChange={(durationMs) => onTransitionChange("fade", durationMs)} /> : null}
          </div>
        </>
      ) : null}

      {isAudio || isVideo ? (
        <>
          <InspectorRange label="Sync nudge" value={track.syncOffsetMs} min={-30000} max={30000} step={10} suffix="ms" onChange={(syncOffsetMs) => onUpdate(track, { syncOffsetMs })} />
          <div className="inspector-utility-actions">
            <button type="button" onClick={onApplyTreatment} title={`Copy this ${isAudio ? "voice treatment" : "camera look"} to matching tracks`}>
              <SlidersHorizontal size={16} /> Apply to all {isAudio ? "mics" : "cameras"}
            </button>
            <button type="button" onClick={onReset} title="Reset this source without changing any other track">
              <RotateCcw size={16} /> Reset track
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="program-inspector-copy">
            <ShieldCheck size={18} />
            <span>Program cuts remove time from every source and shorten the finished episode.</span>
          </div>
          <div className="program-mastering-controls">
            <span>Finished episode loudness</span>
            <div className="inspector-segmented" aria-label="Finished episode loudness">
              <button type="button" className={draft.loudnessTargetLufs === -16 ? "selected" : ""} onClick={() => onMasteringChange(-16, -1.5)}>
                Podcast
              </button>
              <button type="button" className={draft.loudnessTargetLufs === -14 ? "selected" : ""} onClick={() => onMasteringChange(-14, -1)}>
                Video
              </button>
              <button type="button" className={draft.loudnessTargetLufs === -24 ? "selected" : ""} onClick={() => onMasteringChange(-24, -2)}>
                Broadcast
              </button>
            </div>
            <small>
              {draft.loudnessTargetLufs} LUFS, {draft.truePeakDb} dB peak protection
            </small>
          </div>
        </>
      )}
      <small className="inspector-footer">Draft v{draft.version}. Changes save inside this episode.</small>
    </>
  );
}

function InspectorRange({ label, value, min, max, step = 1, suffix = "", onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void }) {
  return (
    <label className="inspector-range">
      <span>
        {label}
        <strong>
          {value}
          {suffix}
        </strong>
      </span>
      <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function InspectorNumber({ label, value, suffix, onChange }: { label: string; value: number; suffix: string; onChange: (value: number) => void }) {
  return (
    <label className="inspector-number">
      <span>{label}</span>
      <div>
        <input aria-label={label} type="number" min="0" max="10000" step="100" value={value} onChange={(event) => onChange(Number(event.target.value))} />
        <small>{suffix}</small>
      </div>
    </label>
  );
}
