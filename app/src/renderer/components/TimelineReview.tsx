import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Check,
  Clock,
  Download,
  Eye,
  EyeOff,
  FastForward,
  Gauge,
  Grid2X2,
  GripVertical,
  History,
  LoaderCircle,
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
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Split,
  Trash2,
  Type,
  Undo2,
  Video,
  Volume2,
  VolumeX,
  Waves
} from "lucide-react";
import type { ReviewMediaAsset, ReviewMediaImportProgress, ReviewMediaImportSlot, ReviewMediaInventory, ReviewMediaTreatmentPreview } from "../../shared/review-media";
import type { EpisodeCleanupScope, EpisodeStorageSummary } from "../../shared/episode-maintenance";
import type { LocalTranscriptionProgress, LocalTranscriptionResult, LocalTranscriptionStatus } from "../../shared/local-transcription";
import type { TimelineAudioPreset, TimelineDraft, TimelineTrack } from "../../shared/timeline";
import { resolveRealtimeInspectorTrack, resolveRealtimeProgramPreview } from "../../shared/realtime-preview";
import { getTimelineSnapDistanceMs, snapTimelineTimestamp } from "../../shared/timeline-engine";
import {
  addCameraDecision,
  addTimelineKeyframe,
  addTimelineTitle,
  applyTimelineTrackTreatmentToKind,
  applyTimelineEdit,
  getActiveCameraTrackId,
  getNextPlayableTimelineTime,
  getTimelineSegments,
  redoTimelineEdit,
  resetTimelineTrackControls,
  removeTimelineTitle,
  resolveTimelineTrackAt,
  restoreOriginalTimeline,
  selectTimelinePoint,
  selectTimelineTrack,
  setTimelineEditMode,
  setTimelineRange,
  undoTimelineEdit,
  updateTimelineCameraTransition,
  updateTimelineMastering,
  updateTimelineTrackMix,
  updateTimelineTitle
} from "../../shared/timeline";
import { formatRecordingTime } from "../services";
import { resumeReviewMonitor, setReviewMonitorGain, setReviewMonitorTreatment } from "../services/review-audio-monitor";
import { startReviewVideoCompositor } from "../services/review-video-compositor";
import { TimelineCaptionPanel } from "./TimelineCaptionPanel";
import { TimelineMediaSetup } from "./TimelineMediaSetup";

interface TimelineReviewProps {
  draft: TimelineDraft;
  media?: ReviewMediaInventory;
  loading?: boolean;
  saveState?: "saved" | "saving" | "failed";
  onDraftChange: (draft: TimelineDraft) => void;
  onSaveDraft: () => void;
  onExport: () => void;
  onCreateCombinedVideo?: () => void;
  onAutoEdit: () => void;
  onImportMedia?: (slot: ReviewMediaImportSlot) => Promise<string>;
  importProgress?: ReviewMediaImportProgress;
  onCancelImport?: (slot: ReviewMediaImportSlot) => Promise<void>;
  onAutoSync?: () => Promise<string>;
  onRenderTreatmentPreview?: (trackId: string, timestampMs: number) => Promise<ReviewMediaTreatmentPreview>;
  onRelinkMedia?: (slot: ReviewMediaImportSlot) => Promise<string>;
  onVerifyOriginals?: () => Promise<string>;
  onGetEpisodeStorage?: () => Promise<EpisodeStorageSummary>;
  onCleanupEpisodeStorage?: (scope: EpisodeCleanupScope) => Promise<EpisodeStorageSummary>;
  transcriptionStatus?: LocalTranscriptionStatus;
  transcriptionProgress?: LocalTranscriptionProgress;
  audioOutputId?: string;
  onTranscribeLocally?: () => Promise<LocalTranscriptionResult>;
  onCancelTranscription?: () => Promise<void>;
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

const timelineZoomLevels = [100, 150, 225, 350, 500, 750, 1000, 1500, 2250, 3500, 5000, 7500, 10000] as const;
const timelineTrackHeaderWidth = 146;

function getTimelineTimestampX(viewport: HTMLDivElement, ratio: number) {
  const contentWidth = Math.max(0, viewport.scrollWidth - timelineTrackHeaderWidth);
  return timelineTrackHeaderWidth + contentWidth * Math.max(0, Math.min(1, ratio));
}

export function TimelineReview({
  draft,
  media,
  loading = false,
  saveState = "saved",
  onDraftChange,
  onSaveDraft,
  onExport,
  onCreateCombinedVideo,
  onAutoEdit,
  onImportMedia,
  importProgress,
  onCancelImport,
  onAutoSync,
  onRenderTreatmentPreview,
  onRelinkMedia,
  onVerifyOriginals,
  onGetEpisodeStorage,
  onCleanupEpisodeStorage,
  transcriptionStatus,
  transcriptionProgress,
  audioOutputId,
  onTranscribeLocally,
  onCancelTranscription
}: TimelineReviewProps) {
  const videoAssets = useMemo(() => (media ? [media.program, ...media.cameras] : []), [media]);
  const multicamAssets = useMemo(() => (media ? [media.program, ...media.cameras] : []), [media]);
  const editableTracks = useMemo(() => draft.tracks.filter((track) => track.kind !== "markers"), [draft.tracks]);
  const [selectedVideoId, setSelectedVideoId] = useState("program");
  const [playheadMs, setPlayheadMs] = useState(draft.selection?.timestampMs ?? 0);
  const [timelineTool, setTimelineTool] = useState<TimelineTool>("select");
  const [timelineZoom, setTimelineZoom] = useState(100);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [treatmentPreview, setTreatmentPreview] = useState<ReviewMediaTreatmentPreview>();
  const [treatmentPreviewBusy, setTreatmentPreviewBusy] = useState(false);
  const [treatmentPreviewError, setTreatmentPreviewError] = useState<string>();
  const [showMulticam, setShowMulticam] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [stemMixActive, setStemMixActive] = useState(false);
  const [audioRouteMessage, setAudioRouteMessage] = useState("Program audio ready");
  const [playbackError, setPlaybackError] = useState<string>();
  const [masterVolume, setMasterVolume] = useState(1);
  const [masterMuted, setMasterMuted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRefs = useRef(new Map<string, HTMLVideoElement>());
  const previewVideoRefCallbacks = useRef(new Map<string, (element: HTMLVideoElement | null) => void>());
  const previewCanvasRefs = useRef(new Map<string, HTMLCanvasElement>());
  const previewCanvasRefCallbacks = useRef(new Map<string, (element: HTMLCanvasElement | null) => void>());
  const pairedAudioRef = useRef<HTMLAudioElement>(null);
  const programAudioRefs = useRef(new Map<string, HTMLAudioElement>());
  const multicamVideoRefs = useRef(new Map<string, HTMLVideoElement>());
  const timelineViewportRef = useRef<HTMLDivElement>(null);
  const resumePlaybackRef = useRef(false);
  const boundarySyncRef = useRef<() => void>(() => undefined);
  const programMode = selectedVideoId === "program";
  const realtimeProgramPreview = useMemo(
    () => (programMode && media ? resolveRealtimeProgramPreview(draft, media, playheadMs) : undefined),
    [draft, media, playheadMs, programMode]
  );
  const activePreviewLayer = realtimeProgramPreview?.layers.find((layer) => layer.role === "active");
  const outgoingPreviewAssetId = realtimeProgramPreview?.layers.find((layer) => layer.role === "outgoing")?.asset.id;
  const activeCameraTrackId = activePreviewLayer?.track?.kind === "camera" ? activePreviewLayer.track.id : undefined;
  const selectedVideo = activePreviewLayer?.asset ?? videoAssets.find((asset) => asset.id === selectedVideoId) ?? videoAssets.find((asset) => asset.status === "ready") ?? videoAssets[0];
  const selectedVideoTrack = activePreviewLayer?.track ?? draft.tracks.find((track) => track.sourceAssetId === selectedVideo?.id);
  const selectedVideoOffsetMs = selectedVideoTrack?.syncOffsetMs ?? 0;
  const pairedAudio = selectedVideo?.pairedAudioId ? media?.audio.find((asset) => asset.id === selectedVideo.pairedAudioId) : undefined;
  const programAudioSources = useMemo(() => {
    const candidates = draft.tracks
      .filter((track) => track.kind === "microphone" && track.includedInProgram)
      .map((track) => ({
        track,
        asset: media?.audio.find((asset) => asset.id === track.sourceAssetId && asset.status === "ready" && asset.audioSignal !== "silent")
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
  const mediaAssetsById = useMemo(
    () => new Map([media?.program, ...(media?.cameras ?? []), ...(media?.audio ?? [])].filter((asset): asset is ReviewMediaAsset => Boolean(asset)).map((asset) => [asset.id, asset])),
    [media]
  );
  const readyCameraTracks = useMemo(
    () =>
      draft.tracks.filter((track) => {
        if (track.kind !== "camera" || !track.sourceAssetId) return false;
        const asset = mediaAssetsById.get(track.sourceAssetId);
        return asset?.status === "ready" && Boolean(asset.playbackUrl);
      }),
    [draft.tracks, mediaAssetsById]
  );
  const defaultCameraTrackId = readyCameraTracks[0]?.id;
  const effectiveCameraTrackId = activeCameraTrackId ?? defaultCameraTrackId;
  const timelineZoomIndex = Math.max(
    0,
    timelineZoomLevels.findIndex((level) => level === timelineZoom)
  );
  const visibleTimelineDurationMs = draft.durationMs > 0 ? Math.max(1, Math.round((draft.durationMs * 100) / timelineZoom)) : 0;
  const timelineTicks = useMemo(() => {
    const divisions = Math.max(4, Math.min(400, Math.ceil((4 * timelineZoom) / 100)));
    return Array.from({ length: divisions + 1 }, (_, index) => ({ position: index / divisions, major: index % 4 === 0 || index === divisions }));
  }, [timelineZoom]);
  const selectedTrack = draft.tracks.find((track) => track.id === draft.selectedTrackId) ?? draft.tracks[0];
  const inspectorTrack = resolveRealtimeInspectorTrack(selectedTrack, realtimeProgramPreview) ?? selectedTrack;
  const inspectorTrackAsset = mediaAssetsById.get(inspectorTrack?.sourceAssetId ?? "");
  const firstMicrophoneTrack = draft.tracks.find((track) => track.kind === "microphone");
  const allRecordedMicrophonesSilent = Boolean(media?.audio.some((asset) => asset.status === "ready"))
    && media!.audio.filter((asset) => asset.status === "ready").every((asset) => asset.audioSignal === "silent");
  const rangeStartMs = draft.selection?.timestampMs ?? playheadMs;
  const rangeEndMs = draft.selection?.endTimestampMs ?? Math.min(draft.durationMs, rangeStartMs + 15000);
  const readyCameraCount = media?.cameras.filter((asset) => asset.status === "ready").length ?? 0;
  const readyMicCount = media?.audio.filter((asset) => asset.status === "ready").length ?? 0;
  const hasPlayableProgram = Boolean(media?.hasPlayableProgram);
  const hasSelectedRange = draft.selection?.endTimestampMs !== undefined && rangeEndMs > rangeStartMs;
  const activeCaption = draft.captions.find((caption) => playheadMs >= caption.startMs && playheadMs < caption.endMs && caption.text.trim());
  const activeTitle = draft.titles.find((title) => playheadMs >= title.startMs && playheadMs < title.endMs);
  const saveStatusLabel = saveState === "saving" ? "Saving draft…" : saveState === "failed" ? "Save failed — retry" : draft.hasUnsavedChanges ? "Draft changed" : "Draft saved";
  const getLiveVideoStyle = (track: TimelineTrack | undefined, isActive: boolean): CSSProperties =>
    track?.kind === "camera"
      ? {
          objectFit: track.cropMode === "fill" ? "cover" : "contain",
          filter: [
            `brightness(${100 + track.brightness}%)`,
            `contrast(${track.contrast + track.sharpness * 0.1}%)`,
            `saturate(${track.saturation}%)`,
            `sepia(${Math.max(0, track.temperature) * 0.18}%)`,
            `hue-rotate(${track.tint * 0.08 - Math.min(0, track.temperature) * 0.08}deg)`,
            `blur(${track.denoise * 0.008}px)`,
          ].join(" "),
          transform: `translate(${track.positionX * 0.18}%, ${track.positionY * 0.18}%) scale(${track.zoom / 100})`,
          opacity: isActive ? 1 : 0,
          zIndex: isActive ? 2 : 1,
          transition: isPlaying && programMode && draft.cameraTransition === "fade" ? `opacity ${draft.cameraTransitionMs}ms linear` : "none"
        }
      : {
          opacity: isActive ? 1 : 0,
          zIndex: isActive ? 2 : 1,
          transition: isPlaying && programMode && draft.cameraTransition === "fade" ? `opacity ${draft.cameraTransitionMs}ms linear` : "none"
        };
  const getLiveCanvasStyle = (track: TimelineTrack | undefined, isActive: boolean): CSSProperties => {
    const style = getLiveVideoStyle(track, isActive);
    return { ...style, filter: undefined };
  };

  useEffect(() => {
    if (selectedVideo?.status === "ready") return;
    const firstReady = videoAssets.find((asset) => asset.status === "ready");
    if (firstReady) setSelectedVideoId(firstReady.id);
  }, [selectedVideo?.status, videoAssets]);

  useEffect(() => setPlaybackError(undefined), [selectedVideo?.playbackUrl]);

  useEffect(() => {
    const stops: Array<() => void> = [];
    for (const asset of videoAssets) {
      const video = previewVideoRefs.current.get(asset.id);
      const canvas = previewCanvasRefs.current.get(asset.id);
      if (!video || !canvas) continue;
      const track = draft.tracks.find((candidate) => candidate.sourceAssetId === asset.id);
      stops.push(startReviewVideoCompositor(canvas, video, track));
    }
    return () => stops.forEach((stop) => stop());
  }, [draft.tracks, videoAssets]);

  useEffect(() => {
    const nextVideo = selectedVideo?.id ? previewVideoRefs.current.get(selectedVideo.id) : undefined;
    if (!nextVideo) return;
    const previousVideo = videoRef.current;
    const shouldResume = isPlaying || Boolean(previousVideo && !previousVideo.paused);
    videoRef.current = nextVideo;
    syncPreviewVideos(playheadMs, shouldResume);
  }, [selectedVideo?.id, outgoingPreviewAssetId]);

  useEffect(() => {
    if (!isPlaying || !programMode || !realtimeProgramPreview?.nextBoundaryMs) return;
    const waitMs = Math.max(0, (realtimeProgramPreview.nextBoundaryMs - playheadMs) / playbackRate);
    const timer = window.setTimeout(() => boundarySyncRef.current(), waitMs);
    return () => window.clearTimeout(timer);
  }, [isPlaying, playbackRate, playheadMs, programMode, realtimeProgramPreview?.nextBoundaryMs]);

  useEffect(() => {
    if (allRecordedMicrophonesSilent) setAudioRouteMessage("No audible microphone signal was captured in this take");
  }, [allRecordedMicrophonesSilent]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const nextTime = Math.max(0, (playheadMs + selectedVideoOffsetMs) / 1000);
    if (video.readyState >= 1) video.currentTime = Math.min(nextTime, Number.isFinite(video.duration) ? video.duration : nextTime);
  }, [selectedVideo?.playbackUrl, selectedVideoOffsetMs]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
    for (const video of previewVideoRefs.current.values()) video.playbackRate = playbackRate;
    if (pairedAudioRef.current) pairedAudioRef.current.playbackRate = playbackRate;
    for (const audio of programAudioRefs.current.values()) audio.playbackRate = playbackRate;
    for (const video of multicamVideoRefs.current.values()) video.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const elements: HTMLMediaElement[] = [videoRef.current, pairedAudioRef.current, ...programAudioRefs.current.values()].filter(
      (element): element is HTMLMediaElement => Boolean(element)
    );
    for (const element of elements) {
      const sinkElement = element as HTMLMediaElement & { setSinkId?: (deviceId: string) => Promise<void> };
      if (!audioOutputId || !sinkElement.setSinkId) continue;
      void sinkElement.setSinkId(audioOutputId).catch((error) => {
        void window.studio?.writeRuntimeLog?.({
          level: "warning",
          source: "ReviewPlayback",
          message: "Could not route Review audio to the selected output.",
          details: { audioOutputId, error: String(error) }
        });
      });
    }
  }, [audioOutputId, selectedVideo?.playbackUrl, programAudioSources]);

  useEffect(() => {
    setReviewMonitorGain(videoRef.current, masterMuted || stemMixActive ? 0 : masterVolume, audioOutputId);
    const pairedTrack = pairedAudio ? draft.tracks.find((track) => track.sourceAssetId === pairedAudio.id) : undefined;
    if (pairedTrack) setReviewMonitorTreatment(pairedAudioRef.current, pairedTrack, masterMuted ? 0 : masterVolume, audioOutputId);
    else setReviewMonitorGain(pairedAudioRef.current, masterMuted ? 0 : masterVolume, audioOutputId);
    syncProgramAudio(playheadMs, isPlaying && stemMixActive);
    if (stemMixActive && !useProgramStemMix) {
      setStemMixActive(false);
      setAudioRouteMessage("Using recorded Program audio");
      setReviewMonitorGain(videoRef.current, masterMuted ? 0 : masterVolume, audioOutputId);
    }
  }, [audioOutputId, draft.tracks, isPlaying, masterMuted, masterVolume, pairedAudio, programAudioSources, stemMixActive, useProgramStemMix]);

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
    syncPreviewVideos(safeTimestamp);
    if (pairedAudioRef.current) pairedAudioRef.current.currentTime = Math.max(0, safeTimestamp / 1000);
    syncProgramAudio(safeTimestamp);
  }

  function setTimelineZoomAtPlayhead(nextZoom: number) {
    const safeZoom = Math.max(timelineZoomLevels[0], Math.min(timelineZoomLevels[timelineZoomLevels.length - 1], nextZoom));
    const viewport = timelineViewportRef.current;
    const playheadRatio = draft.durationMs > 0 ? playheadMs / draft.durationMs : 0;
    setTimelineZoom(safeZoom);
    window.requestAnimationFrame(() => {
      const nextViewport = timelineViewportRef.current ?? viewport;
      if (!nextViewport) return;
      const nextPlayheadX = getTimelineTimestampX(nextViewport, playheadRatio);
      nextViewport.scrollLeft = Math.max(0, nextPlayheadX - nextViewport.clientWidth / 2);
    });
  }

  function zoomTimelineBy(step: -1 | 1) {
    const nextIndex = Math.max(0, Math.min(timelineZoomLevels.length - 1, timelineZoomIndex + step));
    setTimelineZoomAtPlayhead(timelineZoomLevels[nextIndex]);
  }

  function zoomToSelection() {
    if (!hasSelectedRange || draft.durationMs <= 0) return;
    const selectedDurationMs = Math.max(1, rangeEndMs - rangeStartMs);
    const requestedZoom = Math.min(10000, Math.max(100, Math.ceil((draft.durationMs / selectedDurationMs) * 82)));
    const nextZoom = timelineZoomLevels.find((level) => level >= requestedZoom) ?? timelineZoomLevels[timelineZoomLevels.length - 1];
    setPlayheadMs(rangeStartMs + selectedDurationMs / 2);
    const viewport = timelineViewportRef.current;
    setTimelineZoom(nextZoom);
    window.requestAnimationFrame(() => {
      if (!viewport || draft.durationMs <= 0) return;
      const selectionCenter = (rangeStartMs + selectedDurationMs / 2) / draft.durationMs;
      viewport.scrollLeft = Math.max(0, getTimelineTimestampX(viewport, selectionCenter) - viewport.clientWidth / 2);
    });
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
    const nextDraft = applyTimelineEdit(positioned, type, new Date().toISOString(), selectedTrack?.id);
    onDraftChange(nextDraft);
    if (programMode) {
      const nextPlayable = getNextPlayableTimelineTime(nextDraft, playheadMs);
      if (nextPlayable === undefined) pauseSelectedVideo();
      else if (nextPlayable !== playheadMs) seek(nextPlayable);
    }
  }

  function updateTrack(track: TimelineTrack, patch: Parameters<typeof updateTimelineTrackMix>[2]) {
    onDraftChange(updateTimelineTrackMix(draft, track.id, patch));
  }

  function addAutomationKeyframes() {
    if (!selectedTrack || selectedTrack.kind === "program" || selectedTrack.kind === "markers") return;
    const properties = selectedTrack.kind === "microphone"
      ? (["volume", "pan"] as const)
      : (["zoom", "positionX", "positionY", "brightness", "contrast", "saturation"] as const);
    let next = draft;
    for (const property of properties) next = addTimelineKeyframe(next, selectedTrack.id, property, playheadMs, selectedTrack[property]);
    onDraftChange(next);
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
    const video = videoRef.current;
    if (!video) return;
    const nextPlayable = programMode ? getNextPlayableTimelineTime(draft, playheadMs) : playheadMs;
    if (nextPlayable === undefined) return;
    if (nextPlayable !== playheadMs) seek(nextPlayable);
    setReviewMonitorGain(video, 0, audioOutputId);
    resumeReviewMonitor();
    let useStems = false;
    if (useProgramStemMix) useStems = await startProgramStemMix(nextPlayable);
    setReviewMonitorGain(video, masterMuted || useStems ? 0 : masterVolume, audioOutputId);
    try {
      await video.play();
      syncPreviewVideos(nextPlayable, true);
      setIsPlaying(true);
      void window.studio?.writeRuntimeLog?.({
        level: "info",
        source: "ReviewPlayback",
        message: "Review playback started.",
        details: { route: useStems ? "microphone-stems" : "program-audio", stemCount: useStems ? programAudioSources.length : 0, audioOutputId }
      });
    } catch (error) {
      setIsPlaying(false);
      setAudioRouteMessage("Playback could not start — check the selected speaker");
      void window.studio?.writeRuntimeLog?.({ level: "error", source: "ReviewPlayback", message: "Review playback could not start.", details: { error: String(error), audioOutputId } });
    }
  }

  async function startProgramStemMix(timestampMs: number) {
    syncProgramAudio(timestampMs);
    const attempts = programAudioSources.map(async ({ asset }) => {
      const audio = programAudioRefs.current.get(asset.id);
      if (!audio) throw new Error(`${asset.label} player was not ready.`);
      audio.muted = masterMuted;
      await audio.play();
    });
    const results = await Promise.allSettled(attempts);
    const failures = results.filter((result) => result.status === "rejected");
    const active = attempts.length > 0 && failures.length === 0;
    setStemMixActive(active);
    if (active) {
      setAudioRouteMessage(`${attempts.length} microphone track${attempts.length === 1 ? "" : "s"} playing`);
      return true;
    }
    for (const audio of programAudioRefs.current.values()) audio.pause();
    setAudioRouteMessage("Using recorded Program audio (microphone stems unavailable)");
    void window.studio?.writeRuntimeLog?.({
      level: "warning",
      source: "ReviewPlayback",
      message: "Microphone stems could not play; using Program audio.",
      details: { failures: failures.map((failure) => String((failure as PromiseRejectedResult).reason)) }
    });
    return false;
  }

  function pauseSelectedVideo() {
    for (const video of previewVideoRefs.current.values()) {
      if (!video.paused) video.pause();
    }
    pairedAudioRef.current?.pause();
    for (const audio of programAudioRefs.current.values()) audio.pause();
    for (const video of multicamVideoRefs.current.values()) video.pause();
    setIsPlaying(false);
    setStemMixActive(false);
  }

  function syncMulticamAngles(timestampMs: number, play = false) {
    for (const asset of multicamAssets) {
      const video = multicamVideoRefs.current.get(asset.id);
      if (!video) continue;
      const track = draft.tracks.find((candidate) => candidate.sourceAssetId === asset.id);
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
      setReviewMonitorTreatment(audio, resolveTimelineTrackAt(draft, track, timestampMs) ?? track, masterMuted ? 0 : masterVolume, audioOutputId);
      audio.playbackRate = playbackRate;
      if (play) void audio.play().catch(() => undefined);
    }
  }

  function syncPreviewVideos(timestampMs: number, play = false) {
    const activeAssetId = selectedVideo?.id;
    for (const [assetId, video] of previewVideoRefs.current) {
      const track = draft.tracks.find((candidate) => candidate.sourceAssetId === assetId);
      const targetSeconds = Math.max(0, (timestampMs + (track?.syncOffsetMs ?? 0)) / 1000);
      if (video.readyState >= 1 && Math.abs(video.currentTime - targetSeconds) > 0.08) {
        video.currentTime = Math.min(targetSeconds, Number.isFinite(video.duration) ? video.duration : targetSeconds);
      }
      video.playbackRate = playbackRate;
      setReviewMonitorGain(video, masterMuted || stemMixActive || assetId !== activeAssetId ? 0 : masterVolume, audioOutputId);
      const shouldPlay = assetId === activeAssetId || assetId === outgoingPreviewAssetId;
      if (play && shouldPlay) void video.play().catch(() => undefined);
      else if (!shouldPlay && !video.paused) video.pause();
    }
  }

  function getPreviewVideoRef(assetId: string) {
    const existing = previewVideoRefCallbacks.current.get(assetId);
    if (existing) return existing;
    const callback = (element: HTMLVideoElement | null) => {
      if (element) previewVideoRefs.current.set(assetId, element);
      else previewVideoRefs.current.delete(assetId);
    };
    previewVideoRefCallbacks.current.set(assetId, callback);
    return callback;
  }

  function getPreviewCanvasRef(assetId: string) {
    const existing = previewCanvasRefCallbacks.current.get(assetId);
    if (existing) return existing;
    const callback = (element: HTMLCanvasElement | null) => {
      if (element) previewCanvasRefs.current.set(assetId, element);
      else previewCanvasRefs.current.delete(assetId);
    };
    previewCanvasRefCallbacks.current.set(assetId, callback);
    return callback;
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
    if (stemMixActive) {
      syncProgramAudio(timelineTime, play);
      return;
    }
    if (!audio) return;
    const pairedTrack = pairedAudio ? draft.tracks.find((track) => track.sourceAssetId === pairedAudio.id) : undefined;
    const pairedAudioTime = Math.max(0, (timelineTime + (pairedTrack?.syncOffsetMs ?? 0)) / 1000);
    if (Math.abs(audio.currentTime - pairedAudioTime) > 0.2) audio.currentTime = pairedAudioTime;
    if (pairedTrack) setReviewMonitorTreatment(audio, pairedTrack, masterMuted ? 0 : masterVolume, audioOutputId);
    else setReviewMonitorGain(audio, masterMuted ? 0 : masterVolume, audioOutputId);
    audio.playbackRate = playbackRate;
    if (play) void audio.play().catch(() => undefined);
  }

  boundarySyncRef.current = () => syncPreviewAudio(true);

  function loadSelectedVideoAtPlayhead() {
    syncPreviewVideos(playheadMs, resumePlaybackRef.current);
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
    const viewportWidthPx = Math.max(1, (timelineViewportRef.current?.clientWidth ?? 1) - timelineTrackHeaderWidth);
    return snapTimelineTimestamp({
      draft,
      targetTimeMs: timestampMs,
      enabled: snapEnabled,
      maxSnapDistanceMs: getTimelineSnapDistanceMs({
        durationMs: draft.durationMs,
        zoomPercent: timelineZoom,
        viewportWidthPx
      })
    });
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
        const camera = readyCameraTracks[Number(event.key) - 1];
        if (camera) {
          event.preventDefault();
          cutToCamera(camera, `${camera.label} selected with keyboard shortcut ${event.key}`);
        }
      }
    }
    window.addEventListener("keydown", handleEditorKey);
    return () => window.removeEventListener("keydown", handleEditorKey);
  });

  if (loading) {
    return (
      <section className="timeline-review edit-studio edit-studio--loading">
        <section className="edit-studio-workspace">
          <div className="edit-source-monitor">
            <div className="missing-media-state missing-media-state--loading" role="status" aria-live="polite">
              <LoaderCircle size={28} aria-hidden="true" />
              <strong>Preparing your Review workspace</strong>
              <span>Your recording is safe. Building waveforms and timeline previews now.</span>
            </div>
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className={`timeline-review edit-studio ${hasPlayableProgram ? "" : "edit-studio--empty"}`}>
      <header className="edit-studio-bar">
        <div className="edit-studio-title">
          <strong>Episode editor</strong>
          <span>{readyCameraCount} cameras · {readyMicCount} microphones</span>
        </div>
        <div className="edit-studio-status" role="status" aria-live="polite">
          <ShieldCheck size={15} /> Originals safe
          <span className={saveState === "failed" || draft.hasUnsavedChanges ? "needs-attention" : "ready"}>
            <Save size={15} /> {saveStatusLabel}
          </span>
        </div>
        <div className="edit-studio-actions">
          <button type="button" onClick={() => onDraftChange(setTimelineEditMode(draft, "manual"))} className={draft.editMode === "manual" ? "selected" : ""}>
            <MousePointer2 size={16} /> Manual
          </button>
          <button type="button" onClick={onAutoEdit} className={draft.editMode === "auto" ? "selected" : ""}>
            <Sparkles size={16} /> Auto Edit
          </button>
          <button type="button" onClick={onSaveDraft}>
            <Save size={16} /> Save
          </button>
          <button type="button" className="primary" onClick={onCreateCombinedVideo ?? onExport}>
            <Download size={16} /> Export
          </button>
        </div>
      </header>

      <section className="edit-studio-workspace">
        <div className="edit-source-monitor">
          <div className="panel-heading">
            <div>
              <span>Source monitor</span>
              <h3>{programMode && selectedVideo ? `Program · ${selectedVideo.label}` : (selectedVideo?.label ?? "Program video")}</h3>
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
          <div className="program-camera-switcher" role="toolbar" aria-label="Program camera switcher">
            <div className="program-camera-switcher-label">
              <Video size={16} />
              <span>
                <small>Program</small>
                <strong>{draft.tracks.find((track) => track.id === effectiveCameraTrackId)?.label ?? "Recorded Program"}</strong>
              </span>
            </div>
            <div className="program-camera-buttons">
              {readyCameraTracks.map((cameraTrack, index) => (
                <button type="button" className={cameraTrack.id === effectiveCameraTrackId ? "active" : ""} aria-pressed={cameraTrack.id === effectiveCameraTrackId} aria-label={`Use ${cameraTrack.label} in Program from ${formatRecordingTime(playheadMs)}`} title={`Use ${cameraTrack.label} in Program from ${formatRecordingTime(playheadMs)} (${index + 1})`} onClick={() => cutToCamera(cameraTrack, `${cameraTrack.label} selected from the Program switcher`)} key={cameraTrack.id}>
                  <kbd>{index + 1}</kbd>
                  <span>{cameraTrack.label}</span>
                </button>
              ))}
            </div>
            <button type="button" className={`program-multicam-toggle ${showMulticam ? "active" : ""}`} aria-pressed={showMulticam} onClick={() => setShowMulticam((current) => !current)} title={showMulticam ? "Show edited Program" : "Show all camera angles"}>
              <Grid2X2 size={16} /> Multicam
            </button>
          </div>
          {showMulticam ? (
            <div className="multicam-grid" aria-label="Multicamera angles">
              {multicamAssets.map((camera) => {
                const isProgramTile = camera.kind === "program";
                const cameraTrack = draft.tracks.find((track) => track.kind === "camera" && track.sourceAssetId === camera.id);
                const isActive = cameraTrack?.id === activeCameraTrackId;
                const readyCameraIndex = cameraTrack ? readyCameraTracks.findIndex((track) => track.id === cameraTrack.id) : -1;
                return (
                  <button
                    type="button"
                    className={`${isProgramTile ? "program" : ""} ${isActive ? "active" : ""}`.trim()}
                    disabled={camera.status !== "ready" || !camera.playbackUrl || (!isProgramTile && !cameraTrack)}
                    onClick={() => {
                      if (isProgramTile) {
                        setSelectedVideoId("program");
                        setShowMulticam(false);
                      } else if (cameraTrack) {
                        cutToCamera(cameraTrack, `${cameraTrack.label} selected from Multicam view`);
                      }
                    }}
                    title={isProgramTile ? "Return to the edited Program" : camera.status === "ready" && readyCameraIndex >= 0 ? `Cut to ${camera.label} (shortcut ${readyCameraIndex + 1})` : camera.message}
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
                      {isProgramTile ? <span className="multicam-program-badge">PROGRAM</span> : readyCameraIndex >= 0 ? <kbd>{readyCameraIndex + 1}</kbd> : null} {camera.label}
                    </strong>
                  </button>
                );
              })}
            </div>
          ) : null}
          {selectedVideo?.status === "ready" && selectedVideo.playbackUrl ? (
            <div className="review-player-stage" data-aspect-ratio="16:9">
              <div className="review-player-frame">
              {(programMode ? videoAssets : [selectedVideo])
                .filter((asset): asset is ReviewMediaAsset & { playbackUrl: string } => asset.status === "ready" && Boolean(asset.playbackUrl))
                .map((asset) => {
                  const isActive = asset.id === selectedVideo.id;
                  const track = resolveTimelineTrackAt(draft, draft.tracks.find((candidate) => candidate.sourceAssetId === asset.id), playheadMs);
                  return (
                    <Fragment key={asset.id}>
                    <video
                      className={`realtime-preview-layer ${isActive ? "active" : asset.id === outgoingPreviewAssetId ? "outgoing" : "standby"}`}
                      ref={getPreviewVideoRef(asset.id)}
                      preload="auto"
                      src={asset.playbackUrl}
                      poster={asset.posterUrl}
                      muted={masterMuted || stemMixActive || !isActive}
                      style={getLiveVideoStyle(track, isActive)}
                      aria-hidden={!isActive}
                      aria-label={isActive ? `${programMode ? "Edited Program" : asset.label} playback` : undefined}
                      onLoadedMetadata={(event) => {
                        const sourceTime = Math.max(0, (playheadMs + (track?.syncOffsetMs ?? 0)) / 1000);
                        event.currentTarget.currentTime = Math.min(sourceTime, Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : sourceTime);
                        if (!isActive) return;
                        videoRef.current = event.currentTarget;
                        setPlaybackError(undefined);
                        loadSelectedVideoAtPlayhead();
                      }}
                      onError={(event) => {
                        const mediaError = event.currentTarget.error;
                        const message = mediaError ? `This recording could not be loaded (media error ${mediaError.code}).` : "This recording could not be loaded.";
                        if (isActive) setPlaybackError(message);
                        void window.studio?.writeRuntimeLog?.({
                          level: "error",
                          source: "ReviewPlayback",
                          message: "Review video failed to load.",
                          details: { assetId: asset.id, playbackUrl: asset.playbackUrl, mediaErrorCode: mediaError?.code, active: isActive }
                        });
                      }}
                      onPlay={(event) => {
                        if (event.currentTarget !== videoRef.current) return;
                        setIsPlaying(true);
                        syncPreviewAudio(true);
                      }}
                      onPause={(event) => {
                        if (event.currentTarget !== videoRef.current) return;
                        pairedAudioRef.current?.pause();
                        for (const audio of programAudioRefs.current.values()) audio.pause();
                        setIsPlaying(false);
                        setStemMixActive(false);
                      }}
                      onSeeked={(event) => event.currentTarget === videoRef.current && syncPreviewAudio()}
                      onTimeUpdate={(event) => event.currentTarget === videoRef.current && syncPreviewAudio()}
                      onVolumeChange={(event) => event.currentTarget === videoRef.current && syncPreviewAudio()}
                      onEnded={(event) => event.currentTarget === videoRef.current && pauseSelectedVideo()}
                    />
                    <canvas
                      ref={getPreviewCanvasRef(asset.id)}
                      className={`webgl-preview-layer ${isActive ? "active" : asset.id === outgoingPreviewAssetId ? "outgoing" : "standby"}`}
                      style={getLiveCanvasStyle(track, isActive)}
                      aria-hidden="true"
                      data-renderer="webgl"
                    />
                    </Fragment>
                  );
                })}
              {programMode && activeCaption ? <div className="realtime-preview-caption">{activeCaption.text}</div> : null}
              {programMode && activeTitle ? <div className={`realtime-preview-title ${activeTitle.position}`}>{activeTitle.text}</div> : null}
              {playbackError ? (
                <div className="review-playback-error" role="alert">
                  <strong>Playback needs attention</strong>
                  <span>{playbackError}</span>
                </div>
              ) : null}
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
              <div className={`review-audio-route ${selectedVideo.audioSignal === "silent" || allRecordedMicrophonesSilent ? "needs-attention" : programMode || pairedAudio?.status === "ready" ? "ready" : "needs-attention"}`}>
                <strong>{programMode ? audioRouteMessage : pairedAudio?.audioSignal === "silent" ? `${selectedVideo.pairedAudioLabel ?? "Paired mic"} recorded no signal` : (selectedVideo.pairedAudioLabel ?? "No paired mic")}</strong>
                <span>{programMode ? (allRecordedMicrophonesSilent ? "This recording contains silence, so there is no audible waveform to display." : useProgramStemMix ? "Separate microphone tracks are preferred; Program audio is the automatic fallback." : "Recorded Program audio is available.") : pairedAudio?.audioSignal === "silent" ? "Choose another audio source or import replacement audio for this take." : selectedVideo.message}</span>
                {programMode && useProgramStemMix ? <span>Live mix is on — audio control changes are heard immediately during playback.</span> : null}
                {programMode && useProgramStemMix && isPlaying && !stemMixActive ? (
                  <button type="button" onClick={() => void startProgramStemMix(playheadMs).then((active) => {
                    if (active) setReviewMonitorGain(videoRef.current, 0, audioOutputId);
                  })}>
                    Retry live microphone mix
                  </button>
                ) : null}
              </div>
              </div>
            </div>
          ) : (
            <div className="missing-media-state">
              <strong>{selectedVideo?.message ?? "No recorded video found yet"}</strong>
              <span>{hasPlayableProgram ? selectedVideo?.relativePath : "Record an episode or add source files below."}</span>
            </div>
          )}
          {hasPlayableProgram ? <div className="edit-transport" aria-label="Playback controls">
            <button type="button" disabled={selectedVideo?.status !== "ready"} onClick={() => seek(playheadMs - 5000)} title="Back 5 seconds (J)" aria-label="Back 5 seconds">
              <Rewind size={17} />
            </button>
            <button className="transport-play" type="button" disabled={selectedVideo?.status !== "ready"} onClick={() => isPlaying ? pauseSelectedVideo() : void playSelectedVideo()} title={isPlaying ? "Pause" : "Play"}>
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button type="button" disabled={selectedVideo?.status !== "ready"} onClick={() => seek(playheadMs + 5000)} title="Forward 5 seconds (L)" aria-label="Forward 5 seconds">
              <FastForward size={17} />
            </button>
            <strong className="transport-time">{formatRecordingTime(playheadMs)} / {formatRecordingTime(draft.durationMs)}</strong>
            <input className="transport-scrubber" aria-label="Episode playhead" type="range" min="0" max={Math.max(1, draft.durationMs)} value={Math.min(playheadMs, Math.max(1, draft.durationMs))} onChange={(event) => seek(Number(event.target.value))} />
            <button type="button" onClick={() => setMasterMuted((current) => !current)} title={masterMuted ? "Unmute preview" : "Mute preview"} aria-label={masterMuted ? "Unmute preview" : "Mute preview"}>
              {masterMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </button>
            <input className="transport-volume" aria-label="Live monitor gain" aria-valuetext={`${Math.round(masterVolume * 100)}% monitor gain`} title="Live monitor gain — boost quiet recordings without changing the saved mix" type="range" min="0" max="3" step="0.05" value={masterVolume} onChange={(event) => setMasterVolume(Number(event.target.value))} />
            <strong className="transport-gain-value">{Math.round(masterVolume * 100)}%</strong>
            <label className="edit-playback-speed">
              <span className="sr-only">Speed</span>
              <select aria-label="Playback speed" value={playbackRate} onChange={(event) => setPlaybackRate(Number(event.target.value))}>
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option value={rate} key={rate}>{rate}×</option>)}
              </select>
            </label>
          </div> : null}
        </div>

        {hasPlayableProgram ? <aside className="edit-track-inspector" aria-label="Selected track controls">
          {activeTitle ? (
            <section className="title-overlay-inspector" aria-label="Title overlay controls">
              <strong>Title overlay</strong>
              <input aria-label="Title text" value={activeTitle.text} onChange={(event) => onDraftChange(updateTimelineTitle(draft, activeTitle.id, { text: event.target.value }))} />
              <div className="inspector-number-pair">
                <InspectorNumber label="Starts" value={activeTitle.startMs} suffix="ms" onChange={(startMs) => onDraftChange(updateTimelineTitle(draft, activeTitle.id, { startMs }))} />
                <InspectorNumber label="Ends" value={activeTitle.endMs} suffix="ms" onChange={(endMs) => onDraftChange(updateTimelineTitle(draft, activeTitle.id, { endMs }))} />
              </div>
              <button type="button" className="danger" onClick={() => onDraftChange(removeTimelineTitle(draft, activeTitle.id))}><Trash2 size={16} /> Delete title</button>
            </section>
          ) : null}
          <TrackInspector
            track={inspectorTrack}
            tracks={editableTracks}
            asset={inspectorTrackAsset}
            draft={draft}
            playheadMs={playheadMs}
            onUpdate={updateTrack}
            onSelectTrack={selectTrack}
            onUseCamera={() => cutToCamera(inspectorTrack)}
            onTransitionChange={(cameraTransition, cameraTransitionMs) => onDraftChange(updateTimelineCameraTransition(draft, cameraTransition, cameraTransitionMs))}
            onApplyTreatment={() => onDraftChange(applyTimelineTrackTreatmentToKind(draft, inspectorTrack.id))}
            onReset={() => onDraftChange(resetTimelineTrackControls(draft, inspectorTrack.id))}
            onMasteringChange={(loudnessTargetLufs, truePeakDb) => onDraftChange(updateTimelineMastering(draft, loudnessTargetLufs, truePeakDb))}
            preview={treatmentPreview?.trackId === inspectorTrack.id ? treatmentPreview : undefined}
            previewBusy={treatmentPreviewBusy}
            previewError={treatmentPreviewError}
            onRenderPreview={onRenderTreatmentPreview ? async () => {
              setTreatmentPreviewBusy(true);
              setTreatmentPreviewError(undefined);
              try {
                setTreatmentPreview(await onRenderTreatmentPreview(inspectorTrack.id, playheadMs));
              } catch (error) {
                setTreatmentPreviewError(error instanceof Error ? error.message : String(error));
              } finally {
                setTreatmentPreviewBusy(false);
              }
            } : undefined}
            audioAuditionMode={allRecordedMicrophonesSilent ? "unavailable" : useProgramStemMix ? (stemMixActive || !isPlaying ? "live-stems" : "program-fallback") : "program-fallback"}
          />
          <div className="editor-inspector-drawers">
            <details>
              <summary>Sources ready</summary>
              <TimelineMediaSetup media={media} importProgress={importProgress} onImportMedia={onImportMedia} onCancelImport={onCancelImport} onAutoSync={onAutoSync} onRelinkMedia={onRelinkMedia} onVerifyOriginals={onVerifyOriginals} onGetEpisodeStorage={onGetEpisodeStorage} onCleanupEpisodeStorage={onCleanupEpisodeStorage} />
            </details>
            <details>
              <summary>Captions & transcript</summary>
              <TimelineCaptionPanel
                draft={draft}
                playheadMs={playheadMs}
                rangeStartMs={rangeStartMs}
                rangeEndMs={rangeEndMs}
                hasSelectedRange={hasSelectedRange}
                onDraftChange={onDraftChange}
                transcriptionStatus={transcriptionStatus}
                transcriptionProgress={transcriptionProgress}
                onTranscribeLocally={onTranscribeLocally}
                onCancelTranscription={onCancelTranscription}
              />
            </details>
          </div>
        </aside> : null}
      </section>

      {!hasPlayableProgram ? (
        <section className="edit-empty-media-setup">
          <TimelineMediaSetup media={media} importProgress={importProgress} onImportMedia={onImportMedia} onCancelImport={onCancelImport} onAutoSync={onAutoSync} onRelinkMedia={onRelinkMedia} onVerifyOriginals={onVerifyOriginals} onGetEpisodeStorage={onGetEpisodeStorage} onCleanupEpisodeStorage={onCleanupEpisodeStorage} />
        </section>
      ) : (
        <>
      <section className="edit-direct-toolbar" aria-label="Timeline editing tools">
        <div className="timeline-tool-group" role="toolbar" aria-label="Edit tool">
          <div className="timeline-tool-cluster" role="group" aria-label="Selection tools">
            <button type="button" className={timelineTool === "select" ? "selected" : ""} data-compact-tool onClick={() => setTimelineTool("select")} title="Select, scrub, or drag a range">
              <MousePointer2 size={17} /> <span>Select</span>
            </button>
            <button type="button" className={timelineTool === "split" ? "selected" : ""} data-compact-tool onClick={() => setTimelineTool("split")} title="Click a track to split it">
              <Split size={17} /> <span>Split</span>
            </button>
          </div>
          <div className="timeline-tool-cluster" role="group" aria-label="Range tools">
            <button type="button" onClick={markIn} title="Set the selection start at the playhead">
              In
            </button>
            <button type="button" onClick={markOut} title="Set the selection end at the playhead">
              Out
            </button>
            <button type="button" className="danger" data-compact-tool disabled={!hasSelectedRange} onClick={() => applyEdit("delete-section")} title="Remove the selected range">
              <Trash2 size={17} /> <span>Delete range</span>
            </button>
          </div>
          <div className="timeline-tool-cluster" role="group" aria-label="Edit history">
            <button type="button" disabled={draft.history.length === 0 && draft.editLog.length === 0} onClick={() => onDraftChange(undoTimelineEdit(draft))} title="Undo">
              <Undo2 size={17} />
            </button>
            <button type="button" disabled={draft.redoHistory.length === 0 && draft.undoneEditLog.length === 0} onClick={() => onDraftChange(redoTimelineEdit(draft))} title="Redo">
              <Redo2 size={17} />
            </button>
            <button type="button" data-compact-tool onClick={() => onDraftChange(restoreOriginalTimeline(draft))} title="Restore the original timeline">
              <RotateCcw size={16} /> <span>Restore</span>
            </button>
          </div>
          <div className="timeline-tool-cluster" role="group" aria-label="Trim tools">
            <button type="button" data-compact-tool onClick={() => applyEdit("trim-before")} title="Trim everything before the playhead">
              <ArrowLeftToLine size={16} /> <span>Trim start</span>
            </button>
            <button type="button" data-compact-tool onClick={() => applyEdit("trim-after")} title="Trim everything after the playhead">
              <ArrowRightToLine size={16} /> <span>Trim end</span>
            </button>
          </div>
          <div className="timeline-tool-cluster" role="group" aria-label="Audio tools">
            <button type="button" className="timeline-audio-tool" data-compact-tool disabled={!firstMicrophoneTrack} onClick={() => firstMicrophoneTrack && selectTrack(firstMicrophoneTrack.id)} title="Open microphone mix and voice filters">
              <Waves size={17} /> <span>Audio Mix</span>
            </button>
          </div>
          <div className="timeline-tool-cluster" role="group" aria-label="Graphics tools">
            <button type="button" data-compact-tool onClick={() => onDraftChange(addTimelineTitle(draft, playheadMs))} title="Add an editable four-second title at the playhead">
              <Type size={17} /> <span>Add Title</span>
            </button>
          </div>
          <div className="timeline-tool-cluster" role="group" aria-label="Automation tools">
            <button type="button" data-compact-tool disabled={!selectedTrack || selectedTrack.kind === "program" || selectedTrack.kind === "markers"} onClick={addAutomationKeyframes} title="Store this track's current controls at the playhead and interpolate to the next keyframe">
              <Gauge size={17} /> <span>Add Keyframe</span>
            </button>
          </div>
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
          <button type="button" onClick={() => setTimelineZoomAtPlayhead(100)} title="Fit the full episode in the timeline">
            Fit
          </button>
          <button type="button" disabled={timelineZoomIndex === 0} onClick={() => zoomTimelineBy(-1)} title="Zoom timeline out">
            <Minus size={17} />
          </button>
          <input aria-label="Timeline zoom" aria-valuetext={`${timelineZoom}% zoom, ${formatRecordingTime(visibleTimelineDurationMs)} visible`} type="range" min="0" max={timelineZoomLevels.length - 1} step="1" value={timelineZoomIndex} onChange={(event) => setTimelineZoomAtPlayhead(timelineZoomLevels[Number(event.target.value)])} />
          <strong>{timelineZoom}%</strong>
          <button type="button" disabled={timelineZoomIndex === timelineZoomLevels.length - 1} onClick={() => zoomTimelineBy(1)} title="Zoom timeline in">
            <Plus size={17} />
          </button>
          <button type="button" disabled={!hasSelectedRange} onClick={zoomToSelection} title="Zoom to the selected range" aria-label="Zoom to selected range">
            <Maximize2 size={17} />
          </button>
        </div>
      </section>

      <div
        ref={timelineViewportRef}
        className="pro-timeline-viewport"
        onWheel={(event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          zoomTimelineBy(event.deltaY > 0 ? -1 : 1);
        }}
      >
        <section className={`pro-timeline tool-${timelineTool}`} style={{ width: `${timelineZoom}%` } as CSSProperties} aria-label="Synchronized episode timeline">
          <div className="timeline-time-ruler" aria-hidden="true">
            {timelineTicks.map(({ position, major }) => (
              <span className={major ? "major" : "minor"} style={{ left: `${position * 100}%` }} key={position}>
                {major ? formatRecordingTime(draft.durationMs * position) : null}
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
              waveformUrl={track.kind === "microphone" ? mediaAssetsById.get(track.sourceAssetId ?? "")?.waveformUrl : undefined}
              filmstripUrl={track.kind !== "microphone" ? mediaAssetsById.get(track.sourceAssetId ?? "")?.filmstripUrl : undefined}
              filmstripIsPoster={track.kind !== "microphone" && mediaAssetsById.get(track.sourceAssetId ?? "")?.filmstripUrl === mediaAssetsById.get(track.sourceAssetId ?? "")?.posterUrl}
              audioSignal={track.kind === "microphone" ? mediaAssetsById.get(track.sourceAssetId ?? "")?.audioSignal : undefined}
              defaultCameraTrackId={defaultCameraTrackId}
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
        </>
      )}

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
  waveformUrl,
  filmstripUrl,
  filmstripIsPoster,
  audioSignal,
  defaultCameraTrackId
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
  filmstripUrl?: string;
  filmstripIsPoster?: boolean;
  audioSignal?: ReviewMediaAsset["audioSignal"];
  defaultCameraTrackId?: string;
}) {
  const segments = getTimelineSegments(draft, track.id);
  const durationMs = Math.max(1, draft.durationMs);
  const clipsRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ timestampMs: number; pointerId: number } | undefined>(undefined);
  const handledPointerGestureRef = useRef(false);
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
    handledPointerGestureRef.current = false;
    const timestampMs = timestampFromClientX(event.clientX);
    if (tool === "split") {
      handledPointerGestureRef.current = true;
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
    if (distanceMs >= Math.max(250, durationMs * 0.002)) {
      handledPointerGestureRef.current = true;
      onRange(start.timestampMs, endMs);
    } else onPoint(endMs);
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
        className={`edit-track-clips ${waveformUrl ? "has-waveform" : ""} ${filmstripUrl ? "has-filmstrip" : ""}`}
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
        {filmstripUrl ? filmstripIsPoster ? (
          <div className="timeline-filmstrip-poster" style={{ backgroundImage: `url("${filmstripUrl}")` }} aria-hidden="true" />
        ) : <img className="timeline-filmstrip-image" src={filmstripUrl} alt="" aria-hidden="true" /> : null}
        {waveformUrl ? <img className="timeline-waveform-image" src={waveformUrl} alt="" aria-hidden="true" /> : null}
        {track.kind === "microphone" && audioSignal === "silent" ? <span className="timeline-audio-warning">No audio signal captured</span> : null}
        {segments.map((segment) => {
          const activeCameraId = track.kind === "program" ? (getActiveCameraTrackId(draft, segment.startMs) ?? defaultCameraTrackId) : undefined;
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
              onClick={() => {
                if (handledPointerGestureRef.current) {
                  handledPointerGestureRef.current = false;
                  return;
                }
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
        {draft.keyframes.filter((point) => point.trackId === track.id).map((point) => (
          <i className="timeline-keyframe" style={{ left: `${(point.timestampMs / durationMs) * 100}%` }} title={`${point.property} keyframe at ${formatRecordingTime(point.timestampMs)}`} key={point.id} />
        ))}
        <i className="timeline-playhead" style={{ left: `${(playheadMs / durationMs) * 100}%` }} />
      </div>
    </div>
  );
}

function TrackInspector({
  track,
  tracks,
  asset,
  draft,
  playheadMs,
  onUpdate,
  onSelectTrack,
  onUseCamera,
  onTransitionChange,
  onApplyTreatment,
  onReset,
  onMasteringChange,
  preview,
  previewBusy,
  previewError,
  onRenderPreview,
  audioAuditionMode
}: {
  track: TimelineTrack;
  tracks: TimelineTrack[];
  asset?: ReviewMediaAsset;
  draft: TimelineDraft;
  playheadMs: number;
  onUpdate: (track: TimelineTrack, patch: Parameters<typeof updateTimelineTrackMix>[2]) => void;
  onSelectTrack: (trackId: string) => void;
  onUseCamera: () => void;
  onTransitionChange: (transition: "cut" | "fade", durationMs: number) => void;
  onApplyTreatment: () => void;
  onReset: () => void;
  onMasteringChange: (loudnessTargetLufs: number, truePeakDb: number) => void;
  preview?: ReviewMediaTreatmentPreview;
  previewBusy?: boolean;
  previewError?: string;
  onRenderPreview?: () => Promise<void>;
  audioAuditionMode: "live-stems" | "program-fallback" | "unavailable";
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
          <select aria-label="Selected track" value={track.id} onChange={(event) => onSelectTrack(event.target.value)}>
            {tracks.map((candidate) => (
              <option value={candidate.id} key={candidate.id}>{candidate.label}</option>
            ))}
          </select>
        </span>
      </div>
      <div className="inspector-status">
        <span>{selectedAsset ?? "Combined episode"}</span>
        <strong>{track.includedInProgram && !track.muted ? "In episode" : "Not in episode"}</strong>
      </div>
      {isAudio && asset?.audioSignal === "silent" ? (
        <div className="inspector-audio-warning" role="alert">
          <VolumeX size={17} />
          <strong>No audible signal was captured on this microphone track.</strong>
        </div>
      ) : null}
      {isAudio ? (
        <div className={`inspector-audio-warning ${audioAuditionMode === "live-stems" ? "ready" : ""}`} role="status" aria-live="polite">
          {audioAuditionMode === "live-stems" ? <Volume2 size={17} /> : <VolumeX size={17} />}
          <strong>
            {audioAuditionMode === "live-stems"
              ? "Live microphone mix — every audio change is heard immediately."
              : audioAuditionMode === "unavailable"
                ? "This take has no audible isolated microphone signal."
                : "Program fallback — changes are saved for export but cannot be auditioned on the baked Program audio."}
          </strong>
        </div>
      ) : null}
      {(isAudio || isVideo) && (
        <div className="inspector-effect-preview">
          <button type="button" className="inspector-primary" disabled={!onRenderPreview || previewBusy} onClick={() => void onRenderPreview?.()}>
            <Play size={16} /> {previewBusy ? "Rendering 10-second preview…" : "Render final-quality preview"}
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
          <InspectorRange label="Voice level" value={track.volume} min={0} max={300} suffix="%" onChange={(volume) => onUpdate(track, { volume })} />
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
            <small>Level, pan, cleanup, tone, compression, and output protection update live during Review playback. Final export uses the full-quality render.</small>
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
            <InspectorRange label="Zoom" value={track.zoom} min={100} max={400} suffix="%" onChange={(zoom) => onUpdate(track, { zoom })} />
            <InspectorRange label="Horizontal" value={track.positionX} min={-100} max={100} onChange={(positionX) => onUpdate(track, { positionX })} />
            <InspectorRange label="Vertical" value={track.positionY} min={-100} max={100} onChange={(positionY) => onUpdate(track, { positionY })} />
          </details>
          <details className="editor-tool-group" open>
            <summary>Light and color</summary>
            <InspectorRange label="Brightness" value={track.brightness} min={-100} max={100} onChange={(brightness) => onUpdate(track, { brightness })} />
            <InspectorRange label="Contrast" value={track.contrast} min={50} max={200} suffix="%" onChange={(contrast) => onUpdate(track, { contrast })} />
            <InspectorRange label="Color" value={track.saturation} min={0} max={200} suffix="%" onChange={(saturation) => onUpdate(track, { saturation })} />
          </details>
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
