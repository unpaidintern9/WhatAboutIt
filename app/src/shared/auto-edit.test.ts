import { describe, expect, it } from "vitest";
import { createTimelineDraft } from "./timeline";
import { runOfflineAutoEdit } from "./auto-edit";

describe("offline auto edit", () => {
  it("creates a non-destructive draft and report", () => {
    const draft = createTimelineDraft({
      episodeId: "episode-a",
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } },
      markers: [{ id: "marker-a", label: "Highlight", timestampMs: 42000, createdAt: "2026-06-27T10:00:00.000Z" }],
      durationMs: 180000
    });
    const result = runOfflineAutoEdit({ draft, mode: "balanced", now: "2026-06-27T10:00:00.000Z" });

    expect(result.draft.nonDestructive).toBe(true);
    expect(result.draft.editLog.at(-1)?.type).toBe("auto-edit-suggestion");
    expect(result.report.mode).toBe("balanced");
    expect(result.report.originalRecordingSafe).toBe(true);
    expect(result.report.chaptersGenerated.length).toBeGreaterThan(0);
    expect(result.report.clipsSuggested[0].reason).toContain("marker");
    expect(result.report.runtimeReductionMs).toBeGreaterThan(0);
  });

  it("keeps manual edits and markers", () => {
    const draft = createTimelineDraft({
      deviceDefaults: { cameras: {}, microphones: {} },
      markers: [{ id: "marker-a", label: "Sponsor", timestampMs: 90000, createdAt: "2026-06-27T10:00:00.000Z" }]
    });
    const result = runOfflineAutoEdit({ draft: { ...draft, editLog: [{ id: "manual", type: "split", label: "Split here", timestampMs: 10, createdAt: "now" }] }, mode: "clip-hunter" });

    expect(result.draft.markers).toHaveLength(1);
    expect(result.draft.editLog.map((edit) => edit.id)).toContain("manual");
    expect(result.report.chaptersGenerated.map((chapter) => chapter.title)).toContain("Sponsor");
  });
});
