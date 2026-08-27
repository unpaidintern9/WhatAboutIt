import { act } from "react";
import fs from "node:fs";
import path from "node:path";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { addCameraDecision, createTimelineDraft, selectTimelinePoint, updateTimelineTrackMix } from "../../shared/timeline";
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
    posterUrl: "file:///C:/episodes/episode-a/Session/Review/program-poster.jpg",
    waveformUrl: "file:///C:/episodes/episode-a/Session/Review/program-waveform.png",
    filmstripUrl: "file:///C:/episodes/episode-a/Session/Review/program-filmstrip.jpg",
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
      waveformUrl: "file:///C:/episodes/episode-a/Session/Review/camera-1-waveform.png",
      filmstripUrl: "file:///C:/episodes/episode-a/Session/Review/camera-1-filmstrip.jpg",
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
    },
    { id: "camera-3", label: "Camera 3", kind: "camera", relativePath: "Cameras/camera-3.webm", playbackUrl: "file:///C:/episodes/episode-a/Cameras/camera-3.webm", waveformUrl: "file:///C:/episodes/episode-a/Session/Review/camera-3-waveform.png", filmstripUrl: "file:///C:/episodes/episode-a/Session/Review/camera-3-filmstrip.jpg", pairedAudioId: "extra-mic", pairedAudioLabel: "Extra Mic", status: "ready", durationMs: 30000, codecSummary: "vp9 1280x720", message: "Ready to review" }
  ],
  audio: [
    {
      id: "morgan-mic",
      label: "Morgan Mic",
      kind: "audio",
      relativePath: "Audio/morgan-mic.m4a",
      playbackUrl: "file:///C:/episodes/episode-a/Audio/morgan-mic.m4a",
      waveformUrl: "file:///C:/episodes/episode-a/Session/Review/morgan-mic-waveform.png",
      status: "ready",
      durationMs: 30000,
      codecSummary: "aac 48000 Hz",
      message: "Ready to review"
    }
  ]
};

describe("TimelineReview", () => {
  it("shows Program framing changes immediately on the active camera layer", () => {
    let draft = createTimelineDraft({
      episodeId: "episode-a",
      durationMs: 30_000,
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } }
    });
    draft = updateTimelineTrackMix(draft, "camera-camera1", {
      zoom: 180,
      positionX: 25,
      temperature: 30,
      tint: 25,
      denoise: 50,
      sharpness: 40
    });
    draft = addCameraDecision(
      selectTimelinePoint(draft, { timestampMs: 0, trackId: "camera-camera1", source: "timeline" }),
      "camera-camera1",
      "manual",
      "Open on Camera 1",
      "2026-08-27T12:00:00.000Z"
    );

    const markup = renderToStaticMarkup(<TimelineReview draft={draft} media={media} onDraftChange={vi.fn()} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);

    expect(markup).toContain("scale(1.8)");
    expect(markup).toContain("translate(4.5%, 0%)");
    expect(markup).toContain("blur(0.4px)");
    expect(markup).toContain('aria-label="Zoom" type="range" min="100" max="400" step="1" value="180"');
  });

  it("allows local review posters, filmstrips, and waveforms through the renderer CSP", () => {
    const rendererHtml = fs.readFileSync(path.join(process.cwd(), "src", "renderer", "index.html"), "utf8");
    const styles = fs.readFileSync(path.join(process.cwd(), "src", "renderer", "styles.css"), "utf8");

    expect(rendererHtml).toContain("img-src 'self' data: http://127.0.0.1:*");
    expect(rendererHtml).toContain("media-src 'self' http://127.0.0.1:*");
    expect(styles).toContain("width: min(100cqw, 177.7778cqh)");
    expect(styles).toContain("height: min(100cqh, 56.25cqw)");
  });

  it("renders marker list, original-safe messaging, and unlocked draft controls", () => {
    const draft = createTimelineDraft({
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } },
      markers: [{ id: "marker-a", label: "Highlight", timestampMs: 10000, createdAt: "2026-06-27T10:00:00.000Z" }]
    });
    const markup = renderToStaticMarkup(<TimelineReview draft={draft} media={media} onDraftChange={vi.fn()} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} onRelinkMedia={vi.fn()} onVerifyOriginals={vi.fn()} onGetEpisodeStorage={vi.fn()} onCleanupEpisodeStorage={vi.fn()} />);

    expect(markup).toContain("Episode editor");
    expect(markup).toContain("Originals safe");
    expect(markup).toContain("Program video");
    expect(markup).toContain('aria-label="Edited Program playback"');
    expect(markup).toContain('data-aspect-ratio="16:9"');
    expect(markup).toContain('class="review-player-frame"');
    expect(markup).toContain('poster="file:///C:/episodes/episode-a/Session/Review/program-poster.jpg"');
    expect(markup).toContain("Camera 1");
    expect(markup).toContain("Morgan Mic");
    expect(markup).toContain("Not recorded");
    expect(markup).toContain("Auto Edit");
    expect(markup).toContain("Highlight");
    expect(markup).toContain("Synchronized episode timeline");
    expect(markup).toContain("Full-quality originals stay protected");
    expect(markup).toContain("Verify originals");
    expect(markup).toContain("Relink original");
    expect(markup).toContain("Episode media storage");
    expect(markup).toContain("Clear review cache");
    expect(markup).toContain("Delete exports");
    expect(markup).toContain("Timeline editing tools");
    expect(markup).toContain('aria-label="Selection tools"');
    expect(markup).toContain('aria-label="Range tools"');
    expect(markup).toContain('aria-label="Edit history"');
    expect(markup).toContain('aria-label="Trim tools"');
    expect(markup).toContain('aria-label="Audio tools"');
    expect(markup).toContain("Select, scrub, or drag a range");
    expect(markup).toContain("Set range start at the playhead");
    expect(markup).toContain("Set range end at the playhead");
    expect(markup).toContain("Set the selection start at the playhead");
    expect(markup).toContain("Set the selection end at the playhead");
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
    expect(markup).toContain("Transcript &amp; captions");
    expect(markup).toContain("Add at");
    expect(markup).toContain("Auto-time transcript");
    expect(markup).toContain("Import SRT, VTT, or TXT");
    expect(markup).toContain("never uploaded");
    expect(markup).toContain("Restore");
    expect(markup).toContain("Export</button>");
    expect(markup.match(/timeline-waveform-image/g)).toHaveLength(1);
    expect(markup.match(/timeline-filmstrip-image/g)).toHaveLength(2);
    expect(markup).toContain("Back 5 seconds (J)");
    expect(markup).toContain("Forward 5 seconds (L)");
    expect(markup).toContain('aria-label="Playback speed"');
    expect(markup).toContain("Edit history");
    expect(markup).toContain("Manual</button>");
    expect(markup).toContain("Draft saved");
    expect(markup).toContain("Selected track");
    expect(markup).toContain('<select aria-label="Selected track"');
    expect(markup).toContain("Program cuts remove time from every source");
    expect(markup).toContain("Finished episode loudness");
    expect(markup).toContain("Podcast");
    expect(markup).toContain("-16 LUFS");
  });

  it("switches the inspector source from its track picker", () => {
    const draft = createTimelineDraft({ deviceDefaults: { cameras: { camera1: "camera-a", camera3: "camera-c" }, microphones: { morganMic: "mic-a" } }, durationMs: 30000 });
    const onDraftChange = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(<TimelineReview draft={draft} media={media} onDraftChange={onDraftChange} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);
    });

    const picker = host.querySelector('select[aria-label="Selected track"]') as HTMLSelectElement;
    act(() => {
      picker.value = "camera-camera3";
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({ selectedTrackId: "camera-camera3" }));
    act(() => root.unmount());
    host.remove();
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
    expect(markup).toContain("edit-studio--empty");
    expect(markup).toContain("edit-empty-media-setup");
    expect(markup).toContain("Record an episode or add source files below.");
    expect(markup.match(/Episode media setup/g)).toHaveLength(1);
    expect(markup).not.toContain("Timeline editing tools");
    expect(markup).not.toContain("Synchronized episode timeline");
    expect(markup).not.toContain("Selected track controls");
    expect(markup).not.toContain("Video placeholder");
  });

  it("shows preparation instead of claiming a finalized recording is missing", () => {
    const draft = createTimelineDraft({ deviceDefaults: { cameras: {}, microphones: {} } });
    const markup = renderToStaticMarkup(<TimelineReview draft={draft} loading onDraftChange={vi.fn()} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);

    expect(markup).toContain("edit-studio--loading");
    expect(markup).toContain("Preparing your Review workspace");
    expect(markup).toContain("Your recording is safe");
    expect(markup).not.toContain("Not recorded in this episode");
    expect(markup).not.toContain("edit-empty-media-setup");
  });

  it("repeats poster thumbnails instead of stretching them across long timeline lanes", () => {
    const draft = createTimelineDraft({ deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } } });
    const posterFallbackMedia = {
      ...media,
      program: { ...media.program, filmstripUrl: media.program.posterUrl }
    };
    const markup = renderToStaticMarkup(<TimelineReview draft={draft} media={posterFallbackMedia} onDraftChange={vi.fn()} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);

    expect(markup).toContain("timeline-filmstrip-poster");
    expect(markup).toContain("program-poster.jpg");
  });

  it("keeps precision timeline zoom and multicamera Program switching visible", () => {
    const draft = createTimelineDraft({ deviceDefaults: { cameras: { camera1: "camera-a", camera2: "camera-b", camera3: "camera-c" }, microphones: { morganMic: "mic-a" } }, durationMs: 30 * 60 * 1000 });
    const multicamMedia = { ...media, cameras: media.cameras.map((camera) => (camera.id === "camera-2" ? { ...camera, status: "ready" as const, playbackUrl: "file:///C:/episodes/episode-a/Cameras/camera-2.webm" } : camera)) };
    const markup = renderToStaticMarkup(<TimelineReview draft={draft} media={multicamMedia} onDraftChange={vi.fn()} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);

    expect(markup).toContain('aria-label="Program camera switcher"');
    expect(markup).toContain('aria-label="Use Camera 1 in Program from 00:00:00"');
    expect(markup).toContain('aria-label="Use Camera 2 in Program from 00:00:00"');
    expect(markup).toContain('aria-label="Use Camera 3 in Program from 00:00:00"');
    expect(markup).toContain('aria-label="Zoom to selected range"');
    expect(markup).toContain('max="12"');
    expect(markup).toContain('aria-valuetext="100% zoom, 00:30:00 visible"');
    expect(markup).toContain('aria-label="Live monitor gain"');
    expect(markup).toContain('aria-valuetext="100% monitor gain"');
  });

  it("shows Program and all three camera slots in the four-up Multicam view", () => {
    const draft = createTimelineDraft({ deviceDefaults: { cameras: { camera1: "camera-a", camera2: "camera-b", camera3: "camera-c" }, microphones: { morganMic: "mic-a" } }, durationMs: 30000 });
    const onDraftChange = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(<TimelineReview draft={draft} media={media} onDraftChange={onDraftChange} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);
    });

    act(() => (host.querySelector('.monitor-view-switch button:nth-child(2)') as HTMLButtonElement).click());

    const multiview = host.querySelector('[aria-label="Multicamera angles"]') as HTMLDivElement;
    expect(multiview.querySelectorAll(":scope > button")).toHaveLength(4);
    expect(multiview.textContent).toContain("PROGRAM");
    expect(multiview.textContent).toContain("Camera 1");
    expect(multiview.textContent).toContain("Camera 2");
    expect(multiview.textContent).toContain("Camera 3");
    act(() => root.unmount());
    host.remove();
  });

  it("adds an export-backed Camera 2 cut from the visible Program switcher", () => {
    const draft = { ...createTimelineDraft({ deviceDefaults: { cameras: { camera1: "camera-a", camera2: "camera-b" }, microphones: { morganMic: "mic-a" } }, durationMs: 30000 }), selection: { timestampMs: 12000, trackId: "program", source: "timeline" as const } };
    const multicamMedia = { ...media, cameras: media.cameras.map((camera) => (camera.id === "camera-2" ? { ...camera, status: "ready" as const, playbackUrl: "file:///C:/episodes/episode-a/Cameras/camera-2.webm" } : camera)) };
    const onDraftChange = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(<TimelineReview draft={draft} media={multicamMedia} onDraftChange={onDraftChange} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);
    });

    const cameraTwo = host.querySelector('button[aria-label="Use Camera 2 in Program from 00:00:12"]') as HTMLButtonElement;
    act(() => cameraTwo.click());

    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({ cameraDecisions: [expect.objectContaining({ cameraTrackId: "camera-camera2", startMs: 12000, source: "manual" })] }));
    act(() => root.unmount());
    host.remove();
  });

  it("maps camera keyboard shortcuts to ready feeds when an earlier slot is missing", () => {
    const draft = {
      ...createTimelineDraft({ deviceDefaults: { cameras: { camera1: "camera-a", camera3: "camera-c" }, microphones: { morganMic: "mic-a" } }, durationMs: 30000 }),
      selection: { timestampMs: 7000, trackId: "program", source: "timeline" as const }
    };
    const onDraftChange = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(<TimelineReview draft={draft} media={media} onDraftChange={onDraftChange} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);
    });

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true })));

    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({
      cameraDecisions: [expect.objectContaining({ cameraTrackId: "camera-camera3", startMs: 7000, source: "manual" })]
    }));
    act(() => root.unmount());
    host.remove();
  });

  it("zooms the timeline through production-scale precision levels and centers the editable content", async () => {
    const draft = {
      ...createTimelineDraft({ deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } }, durationMs: 30 * 60 * 1000 }),
      selection: { timestampMs: 15 * 60 * 1000, trackId: "program", source: "timeline" as const }
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(<TimelineReview draft={draft} media={media} onDraftChange={vi.fn()} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);
    });

    const zoomInput = host.querySelector('input[aria-label="Timeline zoom"]') as HTMLInputElement;
    const zoomIn = host.querySelector('button[title="Zoom timeline in"]') as HTMLButtonElement;
    const viewport = host.querySelector(".pro-timeline-viewport") as HTMLDivElement;
    Object.defineProperties(viewport, {
      scrollWidth: { configurable: true, value: 1000 },
      clientWidth: { configurable: true, value: 400 }
    });
    act(() => zoomIn.click());
    await act(async () => new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined))));

    expect(zoomInput.getAttribute("aria-valuetext")).toBe("150% zoom, 00:20:00 visible");
    expect(zoomInput.max).toBe("12");
    expect(viewport.scrollLeft).toBe(373);
    act(() => root.unmount());
    host.remove();
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
    expect(markup).toContain("audio control changes are heard immediately during playback");
    expect(markup).toContain("Level, pan, cleanup, tone, compression, and output protection update live during Review playback");
    expect(markup).toContain('aria-label="Voice level" type="range" min="0" max="300"');
    expect(markup).toContain("Render final-quality preview");
    expect(markup).toContain("Apply to all mics");
    expect(markup).toContain("Reset track");
  });

  it("exposes Audio Mix directly and labels silent microphone lanes truthfully", () => {
    const draft = createTimelineDraft({
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } }
    });
    const silentMedia = {
      ...media,
      program: { ...media.program, audioSignal: "silent" as const },
      audio: media.audio.map((asset) => ({ ...asset, waveformUrl: undefined, audioSignal: "silent" as const }))
    };
    const markup = renderToStaticMarkup(<TimelineReview draft={{ ...draft, selectedTrackId: "mic-morganMic" }} media={silentMedia} onDraftChange={vi.fn()} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);

    expect(markup).toContain("Audio Mix");
    expect(markup).toContain("No audio signal captured");
    expect(markup).toContain("No audible signal was captured on this microphone track");
    expect(markup).not.toContain("microphone-stems");
  });

  it("shows source-level camera framing and finishing controls", () => {
    const draft = createTimelineDraft({
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } }
    });
    const markup = renderToStaticMarkup(<TimelineReview draft={{ ...draft, selectedTrackId: "camera-camera1" }} media={media} onDraftChange={vi.fn()} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);

    expect(markup).toContain("Frame and position");
    expect(markup).toContain("Zoom");
    expect(markup).toContain('max="400"');
    expect(markup).toContain("Camera finishing");
    expect(markup).toContain("Temperature");
    expect(markup).toContain("Video denoise");
    expect(markup).toContain("Sharpness");
    expect(markup).toContain("Camera changes");
    expect(markup).toContain("Clean cut");
    expect(markup).toContain("Fade through black");
    expect(markup).toContain("rendered in the final export");
    expect(markup).toContain("Apply to all cameras");
    expect(markup).toContain('min="-30000"');
    expect(markup).toContain('max="30000"');
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

  it("falls back to audible Program audio when microphone stems cannot play", async () => {
    const draft = createTimelineDraft({
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } },
      durationMs: 30000
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<TimelineReview draft={draft} media={media} onDraftChange={vi.fn()} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);
    });
    const video = host.querySelector("video") as HTMLVideoElement;
    const audio = host.querySelector("audio") as HTMLAudioElement;
    video.play = vi.fn().mockResolvedValue(undefined);
    video.pause = vi.fn();
    audio.play = vi.fn().mockRejectedValue(new Error("decode failed"));
    audio.pause = vi.fn();

    await act(async () => {
      (host.querySelector(".transport-play") as HTMLButtonElement).click();
    });

    expect(audio.play).toHaveBeenCalled();
    expect(video.play).toHaveBeenCalled();
    expect(video.muted).toBe(false);
    expect(host.textContent).toContain("Using recorded Program audio");
    act(() => root.unmount());
    host.remove();
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
    const clip = lane.querySelector(".timeline-clip") as HTMLButtonElement;
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
      clip.dispatchEvent(pointer("pointerdown", 100));
      clip.dispatchEvent(pointer("pointermove", 400));
      clip.dispatchEvent(pointer("pointerup", 400));
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
    const clip = lane.querySelector(".timeline-clip") as HTMLButtonElement;
    lane.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 54, width: 1000, height: 54, toJSON: () => ({}) });
    act(() => splitButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const event = new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 500 });
    Object.defineProperty(event, "pointerId", { value: 2 });
    act(() => clip.dispatchEvent(event));

    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({
      editLog: [expect.objectContaining({ type: "split", timestampMs: 15000, targetTrackId: "program" })]
    }));
    act(() => root.unmount());
    host.remove();
  });

  it("supports J and L transport shortcuts for fast podcast review", () => {
    const draft = {
      ...createTimelineDraft({
        deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } },
        durationMs: 30000
      }),
      selection: { timestampMs: 10000, trackId: "program", source: "timeline" as const }
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(<TimelineReview draft={draft} media={media} onDraftChange={vi.fn()} onSaveDraft={vi.fn()} onExport={vi.fn()} onAutoEdit={vi.fn()} />);
    });
    const playhead = host.querySelector('input[aria-label="Episode playhead"]') as HTMLInputElement;

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true })));
    expect(playhead.value).toBe("5000");
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true })));
    expect(playhead.value).toBe("10000");

    act(() => root.unmount());
    host.remove();
  });
});
