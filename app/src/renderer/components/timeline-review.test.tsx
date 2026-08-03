import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createTimelineDraft } from "../../shared/timeline";
import type { ReviewMediaInventory } from "../../shared/review-media";
import { TimelineReview } from "./TimelineReview";

const media: ReviewMediaInventory = {
  episodeId: "episode-a",
  episodeFolder: "C:/episodes/episode-a",
  loadedAt: "2026-06-28T12:00:00.000Z",
  hasPlayableProgram: true,
  message: "Review your recording",
  program: {
    id: "program",
    label: "Program video",
    kind: "program",
    relativePath: "Program/program.webm",
    filePath: "C:/episodes/episode-a/Program/program.webm",
    playbackUrl: "file:///C:/episodes/episode-a/Program/program.webm",
    status: "ready",
    durationMs: 30000,
    codecSummary: "vp9 1280x720",
    sizeBytes: 1024,
    message: "Ready to review"
  },
  cameras: [
    {
      id: "camera-1",
      label: "Camera 1",
      kind: "camera",
      relativePath: "Cameras/camera-1.webm",
      playbackUrl: "file:///C:/episodes/episode-a/Cameras/camera-1.webm",
      pairedAudioId: "morgan-mic",
      pairedAudioLabel: "Morgan Mic",
      status: "ready",
      durationMs: 30000,
      codecSummary: "vp9 1280x720",
      message: "Ready to review"
    },
    {
      id: "camera-2",
      label: "Camera 2",
      kind: "camera",
      relativePath: "Cameras/camera-2.webm",
      status: "missing",
      message: "Not recorded in this episode"
    }
  ],
  audio: [
    {
      id: "morgan-mic",
      label: "Morgan Mic",
      kind: "audio",
      relativePath: "Audio/morgan-mic.m4a",
      playbackUrl: "file:///C:/episodes/episode-a/Audio/morgan-mic.m4a",
      status: "ready",
      durationMs: 30000,
      codecSummary: "aac 48000 Hz",
      message: "Ready to review"
    }
  ]
};

describe("TimelineReview", () => {
  it("renders marker list, original-safe messaging, and unlocked draft controls", () => {
    const draft = createTimelineDraft({
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } },
      markers: [{ id: "marker-a", label: "Highlight", timestampMs: 10000, createdAt: "2026-06-27T10:00:00.000Z" }]
    });
    const markup = renderToStaticMarkup(<TimelineReview draft={draft} media={media} onDraftChange={vi.fn()} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);

    expect(markup).toContain("Review your recording");
    expect(markup).toContain("original recording completely safe");
    expect(markup).toContain("Program video");
    expect(markup).toContain("Recorded video sources");
    expect(markup).toContain("Camera 1");
    expect(markup).toContain("Camera 1 plays with Morgan Mic");
    expect(markup).toContain("Audio files");
    expect(markup).toContain("Original files are safe");
    expect(markup).toContain("Not recorded");
    expect(markup).toContain("Auto Edit");
    expect(markup).toContain("This only changes the draft");
    expect(markup).toContain("You can undo this anytime");
    expect(markup).toContain("Highlight");
    expect(markup).toContain("Combined episode");
    expect(markup).toContain("Camera angle track");
    expect(markup).toContain("Voice track");
    expect(markup).toContain("Trim before here");
    expect(markup).toContain("Split here");
    expect(markup).toContain("Cut this section");
    expect(markup).toContain("Undo");
    expect(markup).toContain("Redo");
    expect(markup).toContain("Restore original");
    expect(markup).toContain("Export");
    expect(markup).toContain("Edit history");
    expect(markup).toContain("Manual Edit");
    expect(markup).toContain("Edit this track");
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
    const markup = renderToStaticMarkup(<TimelineReview draft={editedDraft} media={media} onDraftChange={vi.fn()} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);

    expect(markup).toContain("Draft version 1");
    expect(markup).toContain("Split here");
    expect(markup).toContain("00:00:10");
    expect(markup).toContain("Saved edits will be applied during export.");
  });

  it("shows truthful missing program media state", () => {
    const draft = createTimelineDraft({
      deviceDefaults: { cameras: {}, microphones: {} }
    });
    const missingMedia = {
      ...media,
      hasPlayableProgram: false,
      program: {
        ...media.program,
        playbackUrl: undefined,
        status: "missing" as const,
        message: "No program video found yet"
      }
    };
    const markup = renderToStaticMarkup(<TimelineReview draft={draft} media={missingMedia} onDraftChange={vi.fn()} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);

    expect(markup).toContain("No program video found yet");
    expect(markup).not.toContain("placeholder");
  });
});
