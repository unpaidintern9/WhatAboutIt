import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createTimelineDraft } from "../../shared/timeline";
import { TimelineReview } from "./TimelineReview";

describe("TimelineReview", () => {
  it("renders marker list, original-safe messaging, and locked controls", () => {
    const draft = createTimelineDraft({
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } },
      markers: [{ id: "marker-a", label: "Highlight", timestampMs: 10000, createdAt: "2026-06-27T10:00:00.000Z" }]
    });
    const markup = renderToStaticMarkup(<TimelineReview draft={draft} onJumpToMarker={vi.fn()} />);

    expect(markup).toContain("Review your episode");
    expect(markup).toContain("Your original recording is safe");
    expect(markup).toContain("Highlight");
    expect(markup).toContain("Program track placeholder");
    expect(markup).toContain("Camera track placeholder");
    expect(markup).toContain("Mic track placeholder");
    expect(markup).toContain("Editing tools are coming next");
    expect(markup).toContain("disabled");
  });
});
