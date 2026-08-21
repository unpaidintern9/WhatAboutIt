import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createTimelineDraft } from "../../shared/timeline";
import { runOfflineAutoEdit } from "../../shared/auto-edit";
import { AutoEditReview } from "./AutoEditReview";

describe("AutoEditReview", () => {
  it("renders modes, progress, and friendly safe copy", () => {
    const markup = renderToStaticMarkup(
      <AutoEditReview
        mode="balanced"
        running={false}
        onModeChange={vi.fn()}
        onRun={vi.fn()}
        onReview={vi.fn()}
        onExport={vi.fn()}
        onToggleSilenceCut={vi.fn()}
      />,
    );

    expect(markup).toContain("Auto Edit");
    expect(markup).toContain("polished first draft");
    expect(markup).toContain("Gentle");
    expect(markup).toContain("Balanced");
    expect(markup).toContain("Fast Paced");
    expect(markup).toContain("Clip Hunter");
    expect(markup).toContain("Checking saved sources");
  });

  it("renders report results", () => {
    const result = runOfflineAutoEdit({
      draft: createTimelineDraft({
        deviceDefaults: { cameras: {}, microphones: {} },
        durationMs: 120000,
      }),
      mode: "balanced",
      now: "2026-06-27T10:00:00.000Z",
    });
    const markup = renderToStaticMarkup(
      <AutoEditReview
        mode="balanced"
        running={false}
        result={result}
        onModeChange={vi.fn()}
        onRun={vi.fn()}
        onReview={vi.fn()}
        onExport={vi.fn()}
        onToggleSilenceCut={vi.fn()}
      />,
    );

    expect(markup).toContain("Your first draft is ready");
    expect(markup).toContain("Original length");
    expect(markup).toContain("Edited length");
    expect(markup).toContain("Clip suggestions");
    expect(markup).toContain("Camera plan");
    expect(markup).toContain("Program stays on screen");
    expect(markup).toContain("Review-needed items");
    expect(markup).toContain("podcast voice cleanup");
    expect(markup).toContain("denoise, color balance, and sharpening");
    expect(markup).toContain("Review edited playback");
    expect(markup).toContain("Long pauses");
  });

  it("shows a recoverable error without claiming the draft changed", () => {
    const markup = renderToStaticMarkup(
      <AutoEditReview
        mode="balanced"
        running={false}
        error="Audio analysis failed."
        onModeChange={vi.fn()}
        onRun={vi.fn()}
        onReview={vi.fn()}
        onExport={vi.fn()}
        onToggleSilenceCut={vi.fn()}
      />,
    );

    expect(markup).toContain("Auto Edit stopped: Audio analysis failed.");
    expect(markup).toContain("Your current draft was not replaced");
    expect(markup).toContain('role="alert"');
  });

  it("shows live analysis progress and an enabled cancel action", () => {
    const markup = renderToStaticMarkup(
      <AutoEditReview
        mode="balanced"
        running
        progress={{
          episodeId: "episode-a",
          stage: "speaker-detection",
          progress: 42,
          message: "Finding active speakers",
        }}
        onModeChange={vi.fn()}
        onRun={vi.fn()}
        onCancel={vi.fn()}
        onReview={vi.fn()}
        onExport={vi.fn()}
        onToggleSilenceCut={vi.fn()}
      />,
    );

    expect(markup).toContain("Finding active speakers 42%");
    expect(markup).toContain('aria-label="Auto Edit progress"');
    expect(markup).toMatch(
      /<button[^>]*>[^<]*(?:<svg[\s\S]*?<\/svg>)?[^<]*Cancel/,
    );
  });
});
