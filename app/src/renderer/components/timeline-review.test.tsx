import { act } from "react";
import { createRoot } from "react-dom/client";
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

    expect(markup).toContain("Edit Studio");
    expect(markup).toContain("Originals always stay untouched");
    expect(markup).toContain("Originals safe");
    expect(markup).toContain("Program video");
    expect(markup).toContain("Source monitor");
    expect(markup).toContain("Camera 1");
    expect(markup).toContain("Morgan Mic");
    expect(markup).toContain("Not recorded");
    expect(markup).toContain("Auto Edit");
    expect(markup).toContain("camera choices from saved mic activity");
    expect(markup).toContain("Highlight");
    expect(markup).toContain("Synchronized episode timeline");
    expect(markup).toContain("Timeline editing tools");
    expect(markup).toContain("Select, scrub, or drag a range");
    expect(markup).toContain("Set range start at the playhead");
    expect(markup).toContain("Set range end at the playhead");
    expect(markup).toContain("Delete range");
    expect(markup).toContain("Timeline zoom");
    expect(markup).toContain("drag onto Program to switch cameras");
    expect(markup).toContain('draggable="true"');
    expect(markup).toContain("Drag onto Program to use this camera");
    expect(markup).toContain("Trim start");
    expect(markup).toContain("Trim end");
    expect(markup).toContain("Split");
    expect(markup).toContain("Undo");
    expect(markup).toContain("Redo");
    expect(markup).toContain("Restore");
    expect(markup).toContain("Save &amp; Export");
    expect(markup).toContain("Previous marker");
    expect(markup).toContain("Next marker");
    expect(markup).toContain("Edit history");
    expect(markup).toContain("Manual Edit");
    expect(markup).toContain("Draft saved");
    expect(markup).toContain("Selected track");
    expect(markup).toContain("Program cuts remove time from every source");
    expect(markup).toContain("Finished episode loudness");
    expect(markup).toContain("Podcast");
    expect(markup).toContain("-16 LUFS");
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

    expect(markup).toContain("Draft v1");
    expect(markup).toContain("Split here");
    expect(markup).toContain("00:00:10");
    expect(markup).toContain("Program at");
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

  it("shows source-level podcast audio finishing controls", () => {
    const draft = createTimelineDraft({
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } }
    });
    const markup = renderToStaticMarkup(<TimelineReview draft={{ ...draft, selectedTrackId: "mic-morganMic" }} media={media} onDraftChange={vi.fn()} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);

    expect(markup).toContain("Voice cleanup");
    expect(markup).toContain("Noise cleanup");
    expect(markup).toContain("Noise gate");
    expect(markup).toContain("De-ess");
    expect(markup).toContain("Compression");
    expect(markup).toContain("Three-band tone");
    expect(markup).toContain("Output protection On");
    expect(markup).toContain("Apply to all mics");
    expect(markup).toContain("Reset track");
  });

  it("shows source-level camera framing and finishing controls", () => {
    const draft = createTimelineDraft({
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } }
    });
    const markup = renderToStaticMarkup(<TimelineReview draft={{ ...draft, selectedTrackId: "camera-camera1" }} media={media} onDraftChange={vi.fn()} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);

    expect(markup).toContain("Frame and position");
    expect(markup).toContain("Zoom");
    expect(markup).toContain("Camera finishing");
    expect(markup).toContain("Temperature");
    expect(markup).toContain("Video denoise");
    expect(markup).toContain("Sharpness");
    expect(markup).toContain("Camera changes");
    expect(markup).toContain("Clean cut");
    expect(markup).toContain("Soft fade");
    expect(markup).toContain("Apply to all cameras");
  });

  it("shows saving failures instead of claiming the draft was saved", () => {
    const draft = createTimelineDraft({
      deviceDefaults: { cameras: {}, microphones: {} }
    });
    const markup = renderToStaticMarkup(<TimelineReview draft={{ ...draft, hasUnsavedChanges: true }} saveState="failed" onDraftChange={vi.fn()} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);

    expect(markup).toContain("Save failed — retry");
    expect(markup).not.toContain("Draft saved");
    expect(markup).toContain('role="status"');
  });

  it("creates a real timeline range by dragging across a track", () => {
    const draft = createTimelineDraft({
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } },
      durationMs: 30000
    });
    const onDraftChange = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(<TimelineReview draft={draft} media={media} onDraftChange={onDraftChange} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);
    });

    const lane = host.querySelector('[aria-label="Program timeline"]') as HTMLDivElement;
    lane.setPointerCapture = vi.fn();
    lane.releasePointerCapture = vi.fn();
    lane.hasPointerCapture = vi.fn(() => true);
    lane.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 54, width: 1000, height: 54, toJSON: () => ({}) });

    function pointer(type: string, clientX: number) {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX });
      Object.defineProperty(event, "pointerId", { value: 1 });
      return event;
    }

    act(() => {
      lane.dispatchEvent(pointer("pointerdown", 100));
      lane.dispatchEvent(pointer("pointermove", 400));
      lane.dispatchEvent(pointer("pointerup", 400));
    });

    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({
      selection: expect.objectContaining({ trackId: "program", timestampMs: 3000, endTimestampMs: 12000 })
    }));
    act(() => root.unmount());
    host.remove();
  });

  it("uses split mode to add an export-backed split operation", () => {
    const draft = createTimelineDraft({
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } },
      durationMs: 30000
    });
    const onDraftChange = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(<TimelineReview draft={draft} media={media} onDraftChange={onDraftChange} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);
    });
    const splitButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Split") as HTMLButtonElement;
    const lane = host.querySelector('[aria-label="Program timeline"]') as HTMLDivElement;
    lane.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 54, width: 1000, height: 54, toJSON: () => ({}) });
    act(() => splitButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const event = new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 500 });
    Object.defineProperty(event, "pointerId", { value: 2 });
    act(() => lane.dispatchEvent(event));

    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({
      editLog: [expect.objectContaining({ type: "split", timestampMs: 15000, targetTrackId: "program" })]
    }));
    act(() => root.unmount());
    host.remove();
  });
});
