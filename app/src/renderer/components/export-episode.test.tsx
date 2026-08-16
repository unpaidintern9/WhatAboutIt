import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ExportJob } from "../../shared/export";
import { ExportEpisode } from "./ExportEpisode";

function render(job?: ExportJob) {
  return renderToStaticMarkup(
    <ExportEpisode
      selectedType="full-episode-video"
      qualityPreset="standard"
      job={job}
      mediaToolsStatus={{ ready: true, message: "Media tools are ready" }}
      onTypeChange={vi.fn()}
      onQualityChange={vi.fn()}
      onStartExport={vi.fn()}
      onCancelExport={vi.fn()}
      onOpenFolder={vi.fn()}
      onBackToReview={vi.fn()}
      onFinish={vi.fn()}
    />
  );
}

describe("ExportEpisode", () => {
  it("renders export options and original-safe messaging", () => {
    const markup = render();

    expect(markup).toContain("Export your episode");
    expect(markup).toContain("Save a finished copy");
    expect(markup).toContain("Your original recording stays safe");
    expect(markup).toContain("Full Episode Video");
    expect(markup).toContain("Ready for YouTube");
    expect(markup).toContain("Audio Only");
    expect(markup).toContain("Audio file for podcast platforms");
    expect(markup).toContain("Archive Master");
    expect(markup).toContain("Social Clip");
    expect(markup).toContain("Vertical video from the selected timeline range");
    expect(markup).toContain("Editor Handoff");
    expect(markup).toContain("Premiere, Resolve, Final Cut, or CapCut");
    expect(markup).toContain("Media tools are ready");
    expect(markup).toContain("1080p video, 320 kbps audio");
    expect(markup).toContain("Recommended");
    expect(markup).toContain("Extra source masters are optional");
    expect(markup).toContain("Camera masters");
    expect(markup).toContain("24-bit audio masters");
    expect(markup).toContain("Measured mastering analyzes the complete mix");
    expect(markup).toContain("Back to Review");
    expect(markup).toContain("Mix sources");
  });

  it("explains the universal editor package and requires a destination", () => {
    const missingDestination = renderToStaticMarkup(
      <ExportEpisode selectedType="editor-handoff" qualityPreset="high" mediaToolsStatus={{ ready: true, message: "Media tools are ready" }} onTypeChange={vi.fn()} onQualityChange={vi.fn()} onChooseDestination={vi.fn()} onStartExport={vi.fn()} onCancelExport={vi.fn()} onOpenFolder={vi.fn()} onBackToReview={vi.fn()} onFinish={vi.fn()} />
    );
    const ready = renderToStaticMarkup(
      <ExportEpisode selectedType="editor-handoff" qualityPreset="high" destinationFolderPath={"E:\\Podcast Deliveries"} mediaToolsStatus={{ ready: true, message: "Media tools are ready" }} onTypeChange={vi.fn()} onQualityChange={vi.fn()} onChooseDestination={vi.fn()} onStartExport={vi.fn()} onCancelExport={vi.fn()} onOpenFolder={vi.fn()} onBackToReview={vi.fn()} onFinish={vi.fn()} />
    );

    expect(missingDestination).toContain("Universal editor package");
    expect(missingDestination).toContain("48 kHz, 24-bit WAV");
    expect(missingDestination).toContain("SHA-256 checksums");
    expect(missingDestination).toContain("Choose destination");
    expect(missingDestination).toContain("disabled");
    expect(ready).toContain("E:\\Podcast Deliveries");
    expect(ready).toContain("Build editor handoff");
    expect(ready).not.toContain("Quality preset");
  });

  it("requires a selected range for social clips and describes a ready vertical clip", () => {
    const missingRange = renderToStaticMarkup(
      <ExportEpisode selectedType="social-clip-placeholder" qualityPreset="high" mediaToolsStatus={{ ready: true, message: "Media tools are ready" }} onTypeChange={vi.fn()} onQualityChange={vi.fn()} onStartExport={vi.fn()} onCancelExport={vi.fn()} onOpenFolder={vi.fn()} onBackToReview={vi.fn()} onFinish={vi.fn()} />
    );
    const ready = renderToStaticMarkup(
      <ExportEpisode selectedType="social-clip-placeholder" selectedRangeMs={12500} qualityPreset="high" mediaToolsStatus={{ ready: true, message: "Media tools are ready" }} onTypeChange={vi.fn()} onQualityChange={vi.fn()} onStartExport={vi.fn()} onCancelExport={vi.fn()} onOpenFolder={vi.fn()} onBackToReview={vi.fn()} onFinish={vi.fn()} />
    );

    expect(missingRange).toContain("drag across the Program timeline");
    expect(missingRange).toContain("disabled");
    expect(ready).toContain("Selected clip: 12.5 seconds");
    expect(ready).toContain("1080×1920 vertical video");
  });

  it("renders progress and complete state", () => {
    const markup = render({
      id: "job-a",
      episodeId: "episode-a",
      type: "full-episode-video",
      qualityPreset: "standard",
      status: "complete",
      progress: 100,
      createdAt: "2026-06-27T10:00:00.000Z",
      updatedAt: "2026-06-27T10:05:00.000Z",
      outputFolder: "Episode/Exports",
      message: "Export complete",
      outputFileName: "video.mp4",
      outputFileNames: ["video.mp4", "Camera Masters/camera-1-with-morgan-mic.mp4"]
    });

    expect(markup).toContain("Export complete");
    expect(markup).toContain("Open export folder");
    expect(markup).toContain("Your export includes");
    expect(markup).toContain("camera-1-with-morgan-mic.mp4");
    expect(markup).toContain("Finish");
    expect(markup).toContain("Export again");
  });

  it("renders live export percentage and stage", () => {
    const markup = render({
      id: "job-running",
      episodeId: "episode-a",
      type: "full-episode-video",
      qualityPreset: "standard",
      status: "running",
      progress: 38,
      createdAt: "2026-06-27T10:00:00.000Z",
      updatedAt: "2026-06-27T10:00:10.000Z",
      outputFolder: "Episode/Exports",
      message: "Exporting your episode"
    });

    expect(markup).toContain("Exporting your episode");
    expect(markup).toContain("38%");
    expect(markup).toContain('aria-valuenow="38"');
    expect(markup).toContain('class="active"');
  });

  it("renders friendly export errors", () => {
    const markup = render({
      id: "job-a",
      episodeId: "episode-a",
      type: "full-episode-video",
      qualityPreset: "standard",
      status: "error",
      progress: 45,
      createdAt: "2026-06-27T10:00:00.000Z",
      updatedAt: "2026-06-27T10:05:00.000Z",
      outputFolder: "Episode/Exports",
      message: "We couldn't find the recording file",
      error: "recording-missing"
    });

    expect(markup).toContain("Something needs attention before export");
    expect(markup).toContain("We couldn&#x27;t find the recording file");
  });
});
