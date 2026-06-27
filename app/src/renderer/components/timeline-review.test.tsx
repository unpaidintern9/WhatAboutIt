import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createTimelineDraft } from "../../shared/timeline";
import { TimelineReview } from "./TimelineReview";

describe("TimelineReview", () => {
  it("renders marker list, original-safe messaging, and unlocked draft controls", () => {
    const draft = createTimelineDraft({
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } },
      markers: [{ id: "marker-a", label: "Highlight", timestampMs: 10000, createdAt: "2026-06-27T10:00:00.000Z" }]
    });
    const markup = renderToStaticMarkup(<TimelineReview draft={draft} onDraftChange={vi.fn()} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);

    expect(markup).toContain("Review your episode");
    expect(markup).toContain("original recording completely safe");
    expect(markup).toContain("Auto Edit");
    expect(markup).toContain("This only changes the draft");
    expect(markup).toContain("You can undo this anytime");
    expect(markup).toContain("Highlight");
    expect(markup).toContain("Program track placeholder");
    expect(markup).toContain("Camera track placeholder");
    expect(markup).toContain("Mic track placeholder");
    expect(markup).toContain("Trim before here");
    expect(markup).toContain("Split here");
    expect(markup).toContain("Cut this section");
    expect(markup).toContain("Undo");
    expect(markup).toContain("Redo");
    expect(markup).toContain("Restore original");
    expect(markup).toContain("Export");
    expect(markup).toContain("Edit history");
    expect(markup).not.toContain("Big finishing tools are coming next");
  });

  it("renders edit history", () => {
    const draft = createTimelineDraft({
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } }
    });
    const editedDraft = {
      ...draft,
      editLog: [
        {
          id: "edit-a",
          type: "split" as const,
          label: "Split here",
          timestampMs: 10000,
          createdAt: "2026-06-27T10:00:00.000Z"
        }
      ]
    };
    const markup = renderToStaticMarkup(<TimelineReview draft={editedDraft} onDraftChange={vi.fn()} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);

    expect(markup).toContain("Draft version 1");
    expect(markup).toContain("Split here");
    expect(markup).toContain("00:00:10");
  });
});
