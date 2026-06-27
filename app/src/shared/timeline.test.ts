import { describe, expect, it } from "vitest";
import {
  applyTimelineEdit,
  createTimelineDraft,
  lockedTimelineTools,
  markTimelineSaved,
  redoTimelineEdit,
  restoreOriginalTimeline,
  selectTimelinePoint,
  undoTimelineEdit,
  withTimelineDraftDefaults
} from "./timeline";

describe("timeline draft", () => {
  const deviceDefaults = {
    cameras: { camera1: "camera-a", camera2: "camera-b" },
    microphones: { morganMic: "mic-a", guestMic: "mic-b" }
  };

  it("creates a non-destructive draft with placeholder tracks", () => {
    const draft = createTimelineDraft({ episodeId: "episode-a", deviceDefaults, durationMs: 90000 });

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
      markers: [{ id: "marker-a", label: "Funny", timestampMs: 12000, createdAt: "2026-06-27T10:00:00.000Z" }]
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
    expect(edited.editLog[0]).toMatchObject({ type: "trim-before", label: "Trim before here", timestampMs: 12000 });
    expect(edited.hasUnsavedChanges).toBe(true);
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
