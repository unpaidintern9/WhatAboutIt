import { describe, expect, it } from "vitest";
import { createTimelineDraft } from "./timeline";
import {
  buildTimelineSnapPoints,
  getTimelineSnapDistanceMs,
  resolveTimelineSnap,
  snapTimelineTimestamp
} from "./timeline-engine";

function draft() {
  return createTimelineDraft({
    durationMs: 60_000,
    deviceDefaults: {
      cameras: { camera1: "camera-a", camera2: "", camera3: "" },
      microphones: { morganMic: "mic-a", guestMic: "", extraMic: "" },
      cameraSettings: {},
      cameraMicrophones: {},
      audioOutputId: ""
    }
  });
}

describe("timeline interaction engine", () => {
  it("selects the closest snap point within the current visual threshold", () => {
    const result = resolveTimelineSnap({
      targetTimeMs: 4_880,
      maxSnapDistanceMs: 200,
      snapPoints: [
        { timeMs: 4_000, type: "marker" },
        { timeMs: 5_000, type: "camera-cut" }
      ]
    });

    expect(result.snappedTimeMs).toBe(5_000);
    expect(result.snapPoint?.type).toBe("camera-cut");
    expect(result.snapDistanceMs).toBe(120);
  });

  it("does not snap when every point is outside the threshold", () => {
    const result = resolveTimelineSnap({
      targetTimeMs: 4_500,
      maxSnapDistanceMs: 100,
      snapPoints: [{ timeMs: 5_000, type: "marker" }]
    });

    expect(result.snappedTimeMs).toBe(4_500);
    expect(result.snapPoint).toBeNull();
  });

  it("builds deterministic unique snap points from the WhatAboutIt draft", () => {
    const input = draft();
    input.markers = [{ id: "marker-1", label: "Moment", timestampMs: 10_000, createdAt: input.createdAt }];
    input.cameraDecisions = [{ id: "cut-1", cameraTrackId: "camera-camera1", startMs: 10_000, source: "manual", reason: "Switch" }];

    expect(buildTimelineSnapPoints(input).map((point) => point.timeMs)).toEqual([0, 10_000, 60_000]);
  });

  it("uses a smaller time threshold as the existing timeline zooms in", () => {
    const wide = getTimelineSnapDistanceMs({ durationMs: 60_000, zoomPercent: 100, viewportWidthPx: 1_000 });
    const close = getTimelineSnapDistanceMs({ durationMs: 60_000, zoomPercent: 1_000, viewportWidthPx: 1_000 });

    expect(wide).toBe(500);
    expect(close).toBe(60);
  });

  it("keeps snapping optional and clamps timestamps to the episode", () => {
    const input = draft();
    input.markers = [{ id: "marker-1", label: "Moment", timestampMs: 10_000, createdAt: input.createdAt }];

    expect(snapTimelineTimestamp({ draft: input, targetTimeMs: 9_920, enabled: true, maxSnapDistanceMs: 100 })).toBe(10_000);
    expect(snapTimelineTimestamp({ draft: input, targetTimeMs: 9_920, enabled: false, maxSnapDistanceMs: 100 })).toBe(9_920);
    expect(snapTimelineTimestamp({ draft: input, targetTimeMs: 70_000, enabled: false, maxSnapDistanceMs: 100 })).toBe(60_000);
  });
});
