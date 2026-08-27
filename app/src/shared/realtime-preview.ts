import type { ReviewMediaAsset, ReviewMediaInventory } from "./review-media";
import {
  getActiveCameraTrackId,
  getTimelineKeepRanges,
  isTimelineTrackAvailableAt,
  type TimelineDraft,
  type TimelineTrack
} from "./timeline";

export interface RealtimePreviewLayer {
  asset: ReviewMediaAsset;
  track?: TimelineTrack;
  role: "active" | "outgoing";
  sourceTimeMs: number;
}

export interface RealtimeProgramPreview {
  timelineTimeMs: number;
  layers: RealtimePreviewLayer[];
  nextBoundaryMs?: number;
}

function isPlayableVideo(asset: ReviewMediaAsset | undefined): asset is ReviewMediaAsset & { playbackUrl: string } {
  return Boolean(asset?.status === "ready" && asset.playbackUrl && asset.kind !== "audio");
}

function getTrackAsset(draft: TimelineDraft, media: ReviewMediaInventory, trackId: string, timestampMs: number) {
  const track = draft.tracks.find((candidate) => candidate.id === trackId);
  if (!track?.sourceAssetId || !isTimelineTrackAvailableAt(draft, track.id, timestampMs)) return undefined;
  const asset = [media.program, ...media.cameras].find((candidate) => candidate.id === track.sourceAssetId);
  return isPlayableVideo(asset) ? { asset, track } : undefined;
}

function getDefaultSource(draft: TimelineDraft, media: ReviewMediaInventory) {
  const programTrack = draft.tracks.find((track) => track.kind === "program" && track.sourceAssetId === media.program.id);
  if (isPlayableVideo(media.program)) return { asset: media.program, track: programTrack };
  for (const track of draft.tracks) {
    if (track.kind !== "camera" || !track.sourceAssetId || !track.includedInProgram) continue;
    const asset = media.cameras.find((candidate) => candidate.id === track.sourceAssetId);
    if (isPlayableVideo(asset)) return { asset, track };
  }
  return undefined;
}

function resolveSourceAt(draft: TimelineDraft, media: ReviewMediaInventory, timestampMs: number) {
  const cameraTrackId = getActiveCameraTrackId(draft, timestampMs);
  return (cameraTrackId ? getTrackAsset(draft, media, cameraTrackId, timestampMs) : undefined) ?? getDefaultSource(draft, media);
}

function getPreviousDecisionTime(draft: TimelineDraft, timestampMs: number) {
  return [...draft.cameraDecisions]
    .map((decision) => decision.startMs)
    .filter((startMs) => startMs < timestampMs)
    .sort((left, right) => right - left)[0];
}

export function getRealtimePreviewSourceTimeMs(timelineTimeMs: number, track?: TimelineTrack) {
  return Math.max(0, timelineTimeMs + (track?.syncOffsetMs ?? 0));
}

export function resolveRealtimeInspectorTrack(
  selectedTrack: TimelineTrack | undefined,
  preview: RealtimeProgramPreview | undefined,
) {
  const activeTrack = preview?.layers.find((layer) => layer.role === "active")?.track;
  return selectedTrack?.kind === "program" && activeTrack?.kind === "camera"
    ? activeTrack
    : selectedTrack;
}

/**
 * Resolves the edited Program into browser-playable layers. This intentionally
 * stays independent from React and FFmpeg so preview and export semantics can
 * be checked with fast deterministic tests.
 */
export function resolveRealtimeProgramPreview(
  draft: TimelineDraft,
  media: ReviewMediaInventory,
  timestampMs: number
): RealtimeProgramPreview {
  const timelineTimeMs = Math.max(0, Math.min(timestampMs, draft.durationMs || timestampMs));
  const active = resolveSourceAt(draft, media, timelineTimeMs);
  const layers: RealtimePreviewLayer[] = active
    ? [{ asset: active.asset, track: active.track, role: "active", sourceTimeMs: getRealtimePreviewSourceTimeMs(timelineTimeMs, active.track) }]
    : [];

  if (active && draft.cameraTransition === "fade" && draft.cameraTransitionMs > 0) {
    const currentDecision = [...draft.cameraDecisions]
      .filter((decision) => decision.startMs <= timelineTimeMs)
      .sort((left, right) => right.startMs - left.startMs)[0];
    if (currentDecision && timelineTimeMs < currentDecision.startMs + draft.cameraTransitionMs) {
      const previousDecisionTime = getPreviousDecisionTime(draft, currentDecision.startMs);
      const outgoing = previousDecisionTime === undefined
        ? getDefaultSource(draft, media)
        : resolveSourceAt(draft, media, previousDecisionTime);
      if (outgoing && outgoing.asset.id !== active.asset.id) {
        layers.push({
          asset: outgoing.asset,
          track: outgoing.track,
          role: "outgoing",
          sourceTimeMs: getRealtimePreviewSourceTimeMs(timelineTimeMs, outgoing.track)
        });
      }
    }
  }

  const boundaries = new Set<number>(draft.cameraDecisions.map((decision) => decision.startMs));
  for (const range of getTimelineKeepRanges(draft)) {
    boundaries.add(range.startMs);
    boundaries.add(range.endMs);
  }
  const nextBoundaryMs = [...boundaries].filter((boundary) => boundary > timelineTimeMs + 1).sort((left, right) => left - right)[0];

  return { timelineTimeMs, layers, nextBoundaryMs };
}
