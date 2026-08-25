import type { TimelineDraft } from "./timeline";

/**
 * Timeline interaction primitives adapted from OpenCut Classic's MIT-licensed
 * snapping model at commit cf5e79e919144200294fb9fed22a222592a0aeea.
 * See THIRD_PARTY_NOTICES.md for attribution and license details.
 */

export type TimelineSnapPointType = "boundary" | "marker" | "camera-cut" | "edit";

export interface TimelineSnapPoint {
  timeMs: number;
  type: TimelineSnapPointType;
  id?: string;
  trackId?: string;
}

export interface TimelineSnapResult {
  snappedTimeMs: number;
  snapPoint: TimelineSnapPoint | null;
  snapDistanceMs: number;
}

export function resolveTimelineSnap(input: {
  targetTimeMs: number;
  snapPoints: TimelineSnapPoint[];
  maxSnapDistanceMs: number;
}): TimelineSnapResult {
  let closestSnapPoint: TimelineSnapPoint | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const snapPoint of input.snapPoints) {
    const distance = Math.abs(input.targetTimeMs - snapPoint.timeMs);
    if (distance <= input.maxSnapDistanceMs && distance < closestDistance) {
      closestDistance = distance;
      closestSnapPoint = snapPoint;
    }
  }

  return {
    snappedTimeMs: closestSnapPoint?.timeMs ?? input.targetTimeMs,
    snapPoint: closestSnapPoint,
    snapDistanceMs: closestDistance
  };
}

export function buildTimelineSnapPoints(draft: TimelineDraft): TimelineSnapPoint[] {
  const points: TimelineSnapPoint[] = [
    { timeMs: 0, type: "boundary", id: "timeline-start" },
    { timeMs: draft.durationMs, type: "boundary", id: "timeline-end" },
    ...draft.markers.map((marker) => ({
      timeMs: marker.timestampMs,
      type: "marker" as const,
      id: marker.id
    })),
    ...draft.cameraDecisions.map((decision) => ({
      timeMs: decision.startMs,
      type: "camera-cut" as const,
      id: decision.id,
      trackId: decision.cameraTrackId
    })),
    ...draft.editLog.flatMap((edit) => [
      {
        timeMs: edit.timestampMs,
        type: "edit" as const,
        id: `${edit.id}:start`,
        trackId: edit.targetTrackId
      },
      ...(edit.endTimestampMs === undefined
        ? []
        : [
            {
              timeMs: edit.endTimestampMs,
              type: "edit" as const,
              id: `${edit.id}:end`,
              trackId: edit.targetTrackId
            }
          ])
    ])
  ];

  const uniquePoints = new Map<number, TimelineSnapPoint>();
  for (const point of points) {
    const safeTime = Math.max(0, Math.min(point.timeMs, draft.durationMs || point.timeMs));
    if (!uniquePoints.has(safeTime)) uniquePoints.set(safeTime, { ...point, timeMs: safeTime });
  }
  return [...uniquePoints.values()].sort((left, right) => left.timeMs - right.timeMs);
}

export function getTimelineSnapDistanceMs(input: {
  durationMs: number;
  zoomPercent: number;
  viewportWidthPx: number;
  thresholdPx?: number;
  minimumMs?: number;
  maximumMs?: number;
}) {
  const thresholdPx = input.thresholdPx ?? 10;
  const minimumMs = input.minimumMs ?? 1000 / 60;
  const maximumMs = input.maximumMs ?? 500;
  if (input.durationMs <= 0 || input.viewportWidthPx <= 0 || input.zoomPercent <= 0) return maximumMs;

  const visibleDurationMs = (input.durationMs * 100) / input.zoomPercent;
  const distanceMs = (visibleDurationMs / input.viewportWidthPx) * thresholdPx;
  return Math.max(minimumMs, Math.min(maximumMs, distanceMs));
}

export function snapTimelineTimestamp(input: {
  draft: TimelineDraft;
  targetTimeMs: number;
  enabled: boolean;
  maxSnapDistanceMs: number;
}) {
  const safeTimestamp = Math.max(0, Math.min(input.targetTimeMs, input.draft.durationMs || input.targetTimeMs));
  if (!input.enabled) return safeTimestamp;
  return resolveTimelineSnap({
    targetTimeMs: safeTimestamp,
    snapPoints: buildTimelineSnapPoints(input.draft),
    maxSnapDistanceMs: input.maxSnapDistanceMs
  }).snappedTimeMs;
}
