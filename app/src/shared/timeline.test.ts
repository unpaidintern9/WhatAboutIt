import { describe, expect, it } from "vitest";
import {
  addCameraDecision,
  applyTimelineTrackTreatmentToKind,
  applyTimelineEdit,
  createTimelineDraft,
  getTimelineSegments,
  getNextPlayableTimelineTime,
  isTimelineTrackAvailableAt,
  lockedTimelineTools,
  markTimelineSaved,
  redoTimelineEdit,
  resetTimelineTrackControls,
  restoreOriginalTimeline,
  selectTimelinePoint,
  selectTimelineTrack,
  setTimelineRange,
  undoTimelineEdit,
  updateTimelineCameraTransition,
  updateTimelineMastering,
  updateTimelineTrackMix,
  withTimelineDraftDefaults
} from "./timeline";

describe("timeline draft", () => {
  const deviceDefaults = {
    cameras: { camera1: "camera-a", camera2: "camera-b" },
    microphones: { morganMic: "mic-a", guestMic: "mic-b" }
  };

  it("creates a non-destructive draft with review tracks", () => {
    const draft = createTimelineDraft({
      episodeId: "episode-a",
      deviceDefaults,
      durationMs: 90000
    });

    expect(draft.nonDestructive).toBe(true);
    expect(draft.version).toBe(1);
    expect(draft.editLog).toEqual([]);
    expect(draft.tracks.map((track) => track.kind)).toContain("program");
    expect(draft.tracks.map((track) => track.kind)).toContain("camera");
    expect(draft.tracks.map((track) => track.kind)).toContain("microphone");
    expect(draft.tracks.map((track) => track.kind)).toContain("markers");
  });

  it("renders markers with timestamps in the draft", () => {
    const draft = createTimelineDraft({
      deviceDefaults,
      markers: [
        {
          id: "marker-a",
          label: "Funny",
          timestampMs: 12000,
          createdAt: "2026-06-27T10:00:00.000Z"
        }
      ]
    });

    expect(draft.markers[0].label).toBe("Funny");
    expect(draft.markers[0].timestampMs).toBe(12000);
  });

  it("keeps future finishing controls locked", () => {
    const draft = createTimelineDraft({ deviceDefaults });

    expect(draft.lockedTools).toEqual(lockedTimelineTools);
    expect(draft.lockedTools).toEqual([]);
  });

  it("fills missing draft data safely", () => {
    const fallback = createTimelineDraft({ deviceDefaults });
    const draft = withTimelineDraftDefaults({ markers: [] }, fallback);

    expect(draft.tracks.length).toBeGreaterThan(0);
    expect(draft.nonDestructive).toBe(true);
  });

  it("creates a trim draft edit without touching originals", () => {
    const draft = selectTimelinePoint(createTimelineDraft({ deviceDefaults, durationMs: 60000 }), {
      timestampMs: 12000,
      source: "timeline"
    });
    const edited = applyTimelineEdit(draft, "trim-before", "2026-06-27T10:00:00.000Z");

    expect(edited.nonDestructive).toBe(true);
    expect(edited.version).toBe(2);
    expect(edited.editLog[0]).toMatchObject({
      type: "trim-before",
      label: "Trim before here",
      timestampMs: 12000
    });
    expect(edited.hasUnsavedChanges).toBe(true);
  });

  it("targets manual edits to one selected camera or microphone", () => {
    const base = createTimelineDraft({ deviceDefaults, durationMs: 60000 });
    const selected = selectTimelineTrack(base, "mic-guestMic");
    const positioned = selectTimelinePoint(selected, {
      timestampMs: 8000,
      source: "timeline",
      trackId: "mic-guestMic"
    });
    const edited = applyTimelineEdit(positioned, "delete-section");

    expect(edited.editLog[0].targetTrackId).toBe("mic-guestMic");
    expect(edited.tracks.find((track) => track.id === "mic-morganMic")?.includedInProgram).toBe(true);
  });

  it("stores source mix controls and manual camera choices", () => {
    const base = selectTimelinePoint(createTimelineDraft({ deviceDefaults, durationMs: 60000 }), {
      timestampMs: 12000,
      source: "timeline",
      trackId: "camera-camera2"
    });
    const mixed = updateTimelineTrackMix(base, "mic-guestMic", {
      volume: 82,
      includedInProgram: true
    });
    const switched = addCameraDecision(mixed, "camera-camera2", "manual", "Guest is speaking");

    expect(mixed.tracks.find((track) => track.id === "mic-guestMic")?.volume).toBe(82);
    expect(switched.cameraDecisions[0]).toMatchObject({
      cameraTrackId: "camera-camera2",
      startMs: 12000,
      source: "manual"
    });
  });

  it("stores industry-standard source controls with safe limits", () => {
    const base = createTimelineDraft({ deviceDefaults, durationMs: 60000 });
    const mixed = updateTimelineTrackMix(base, "mic-guestMic", {
      muted: true,
      solo: true,
      pan: 140,
      fadeInMs: 1200,
      fadeOutMs: 1800,
      syncOffsetMs: -240,
      audioPreset: "broadcast",
      noiseReduction: 120,
      noiseGateDb: -10,
      deEsser: 110,
      compression: 105,
      eqLowDb: -20,
      eqMidDb: 18,
      eqHighDb: 4,
      limiterEnabled: false
    });
    const graded = updateTimelineTrackMix(mixed, "camera-camera2", {
      cropMode: "fill",
      brightness: 12,
      contrast: 118,
      saturation: 108,
      syncOffsetMs: 500,
      temperature: -150,
      tint: 120,
      sharpness: 140,
      denoise: 34,
      zoom: 200,
      positionX: -140,
      positionY: 130
    });

    expect(mixed.tracks.find((track) => track.id === "mic-guestMic")).toMatchObject({
      muted: true,
      solo: true,
      pan: 100,
      fadeInMs: 1200,
      fadeOutMs: 1800,
      syncOffsetMs: -240,
      audioPreset: "broadcast",
      noiseReduction: 100,
      noiseGateDb: -20,
      deEsser: 100,
      compression: 100,
      eqLowDb: -12,
      eqMidDb: 12,
      eqHighDb: 4,
      limiterEnabled: false
    });
    expect(graded.tracks.find((track) => track.id === "camera-camera2")).toMatchObject({
      cropMode: "fill",
      brightness: 12,
      contrast: 118,
      saturation: 108,
      syncOffsetMs: 500,
      temperature: -100,
      tint: 100,
      sharpness: 100,
      denoise: 34,
      zoom: 160,
      positionX: -100,
      positionY: 100
    });
  });

  it("stores camera transition choices with safe durations", () => {
    const base = createTimelineDraft({ deviceDefaults, durationMs: 60000 });
    const faded = updateTimelineCameraTransition(base, "fade", 2000);

    expect(faded.cameraTransition).toBe("fade");
    expect(faded.cameraTransitionMs).toBe(1000);
    expect(faded.hasUnsavedChanges).toBe(true);
  });

  it("copies treatment across matching source tracks and resets one source", () => {
    const base = createTimelineDraft({ deviceDefaults, durationMs: 60000 });
    const tuned = updateTimelineTrackMix(base, "mic-morganMic", {
      compression: 68,
      noiseReduction: 42,
      volume: 87
    });
    const copied = applyTimelineTrackTreatmentToKind(tuned, "mic-morganMic");
    const reset = resetTimelineTrackControls(copied, "mic-guestMic");

    expect(copied.tracks.find((track) => track.id === "mic-guestMic")).toMatchObject({ compression: 68, noiseReduction: 42, volume: 100 });
    expect(reset.tracks.find((track) => track.id === "mic-guestMic")).toMatchObject({ compression: 0, noiseReduction: 0, volume: 100 });
    expect(reset.tracks.find((track) => track.id === "mic-morganMic")?.compression).toBe(68);
  });

  it("stores safe final loudness targets", () => {
    const base = createTimelineDraft({ deviceDefaults });
    const mastered = updateTimelineMastering(base, -14, -1);
    const clamped = updateTimelineMastering(mastered, -30, 0);

    expect(mastered).toMatchObject({
      loudnessTargetLufs: -14,
      truePeakDb: -1,
      hasUnsavedChanges: true
    });
    expect(clamped).toMatchObject({
      loudnessTargetLufs: -24,
      truePeakDb: -0.5
    });
  });

  it("uses an exact In and Out range for source cuts", () => {
    const base = createTimelineDraft({ deviceDefaults, durationMs: 60000 });
    const ranged = setTimelineRange(base, 8000, 13250, "mic-guestMic");
    const edited = applyTimelineEdit(ranged, "delete-section", "2026-06-27T10:00:00.000Z");
    const segments = getTimelineSegments(edited, "mic-guestMic");

    expect(edited.editLog[0]).toMatchObject({
      timestampMs: 8000,
      endTimestampMs: 13250,
      targetTrackId: "mic-guestMic"
    });
    expect(segments.find((segment) => segment.startMs === 8000 && segment.endMs === 13250)?.removed).toBe(true);
  });

  it("builds visible clip segments from splits and trims", () => {
    const base = setTimelineRange(createTimelineDraft({ deviceDefaults, durationMs: 60000 }), 10000, 20000, "camera-camera1");
    const split = applyTimelineEdit(base, "split", "2026-06-27T10:00:00.000Z");
    const trimmed = applyTimelineEdit({ ...split, selection: { ...split.selection!, timestampMs: 52000 } }, "trim-after", "2026-06-27T10:00:01.000Z");
    const segments = getTimelineSegments(trimmed, "camera-camera1");

    expect(segments.some((segment) => segment.startMs === 10000)).toBe(true);
    expect(segments.at(-1)?.removed).toBe(true);
  });

  it("creates split and delete draft edits", () => {
    const draft = selectTimelinePoint(createTimelineDraft({ deviceDefaults, durationMs: 60000 }), {
      timestampMs: 24000,
      source: "timeline"
    });
    const split = applyTimelineEdit(draft, "split", "2026-06-27T10:00:00.000Z");
    const cut = applyTimelineEdit(split, "delete-section", "2026-06-27T10:01:00.000Z");

    expect(split.editLog[0].label).toBe("Split here");
    expect(cut.editLog[1].label).toBe("Cut this section");
    expect(cut.editLog[1].endTimestampMs).toBe(39000);
  });

  it("supports undo and redo", () => {
    const draft = selectTimelinePoint(createTimelineDraft({ deviceDefaults, durationMs: 60000 }), {
      timestampMs: 12000,
      source: "timeline"
    });
    const edited = applyTimelineEdit(draft, "split");
    const undone = undoTimelineEdit(edited);
    const redone = redoTimelineEdit(undone);

    expect(undone.editLog).toHaveLength(0);
    expect(undone.undoneEditLog).toHaveLength(1);
    expect(redone.editLog).toHaveLength(1);
    expect(redone.undoneEditLog).toHaveLength(0);
  });

  it("undoes and redoes camera decisions and track controls, not just log entries", () => {
    const base = selectTimelinePoint(createTimelineDraft({ deviceDefaults, durationMs: 60000 }), {
      timestampMs: 12000,
      source: "timeline"
    });
    const switched = addCameraDecision(base, "camera-camera2", "manual", "Use guest camera", "2026-06-27T10:00:00.000Z");
    const adjusted = updateTimelineTrackMix(switched, "mic-guestMic", { volume: 72 }, "2026-06-27T10:00:02.000Z");

    const undoLevel = undoTimelineEdit(adjusted, "2026-06-27T10:00:03.000Z");
    const undoCamera = undoTimelineEdit(undoLevel, "2026-06-27T10:00:04.000Z");
    const redoCamera = redoTimelineEdit(undoCamera, "2026-06-27T10:00:05.000Z");

    expect(undoLevel.tracks.find((track) => track.id === "mic-guestMic")?.volume).toBe(100);
    expect(undoLevel.cameraDecisions).toHaveLength(1);
    expect(undoCamera.cameraDecisions).toHaveLength(0);
    expect(redoCamera.cameraDecisions[0]).toMatchObject({
      cameraTrackId: "camera-camera2",
      startMs: 12000
    });
  });

  it("coalesces a fast slider gesture into one undo step", () => {
    const base = createTimelineDraft({ deviceDefaults });
    const first = updateTimelineTrackMix(base, "mic-guestMic", { volume: 90 }, "2026-06-27T10:00:00.000Z");
    const second = updateTimelineTrackMix(first, "mic-guestMic", { volume: 75 }, "2026-06-27T10:00:00.500Z");
    const undone = undoTimelineEdit(second);

    expect(second.history).toHaveLength(1);
    expect(second.tracks.find((track) => track.id === "mic-guestMic")?.volume).toBe(75);
    expect(undone.tracks.find((track) => track.id === "mic-guestMic")?.volume).toBe(100);
  });

  it("skips removed Program ranges during edited preview playback", () => {
    const base = setTimelineRange(createTimelineDraft({ deviceDefaults, durationMs: 60000 }), 10000, 20000, "program");
    const cut = applyTimelineEdit(base, "delete-section");

    expect(getNextPlayableTimelineTime(cut, 15000)).toBe(20000);
    expect(getNextPlayableTimelineTime(cut, 25000)).toBe(25000);
  });

  it("uses camera source edits to decide whether an angle is available", () => {
    const base = setTimelineRange(createTimelineDraft({ deviceDefaults, durationMs: 60000 }), 10000, 20000, "camera-camera1");
    const cut = applyTimelineEdit(base, "delete-section");

    expect(isTimelineTrackAvailableAt(cut, "camera-camera1", 5000)).toBe(true);
    expect(isTimelineTrackAvailableAt(cut, "camera-camera1", 15000)).toBe(false);
    expect(isTimelineTrackAvailableAt(cut, "camera-camera1", 25000)).toBe(true);
    expect(isTimelineTrackAvailableAt({
      ...cut,
      tracks: cut.tracks.map((track) => track.id === "camera-camera1" ? { ...track, includedInProgram: false } : track)
    }, "camera-camera1", 5000)).toBe(false);
  });

  it("restores the original draft by clearing edit history", () => {
    const edited = applyTimelineEdit(createTimelineDraft({ deviceDefaults }), "delete-section");
    const restored = restoreOriginalTimeline(edited);

    expect(restored.editLog).toEqual([]);
    expect(restored.undoneEditLog).toEqual([]);
    expect(restored.nonDestructive).toBe(true);
  });

  it("marks auto-saved draft timelines as clean", () => {
    const edited = applyTimelineEdit(createTimelineDraft({ deviceDefaults }), "trim-before");
    const saved = markTimelineSaved(edited, "2026-06-27T10:00:00.000Z");

    expect(saved.hasUnsavedChanges).toBe(false);
    expect(saved.lastSavedAt).toBe("2026-06-27T10:00:00.000Z");
  });
});
