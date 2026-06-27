import { describe, expect, it } from "vitest";
import { createTimelineDraft, lockedTimelineTools, withTimelineDraftDefaults } from "./timeline";

describe("timeline draft", () => {
  const deviceDefaults = {
    cameras: { camera1: "camera-a", camera2: "camera-b" },
    microphones: { morganMic: "mic-a", guestMic: "mic-b" }
  };

  it("creates a non-destructive draft with placeholder tracks", () => {
    const draft = createTimelineDraft({ episodeId: "episode-a", deviceDefaults, durationMs: 90000 });

    expect(draft.nonDestructive).toBe(true);
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

  it("keeps locked controls locked", () => {
    const draft = createTimelineDraft({ deviceDefaults });

    expect(draft.lockedTools).toEqual(lockedTimelineTools);
  });

  it("fills missing draft data safely", () => {
    const fallback = createTimelineDraft({ deviceDefaults });
    const draft = withTimelineDraftDefaults({ markers: [] }, fallback);

    expect(draft.tracks.length).toBeGreaterThan(0);
    expect(draft.nonDestructive).toBe(true);
  });
});
