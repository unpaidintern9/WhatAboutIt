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
    expect(markup).toContain("Saved for Version 2");
    expect(markup).toContain("Media tools are ready");
    expect(markup).toContain("1080p video, 320 kbps audio");
    expect(markup).toContain("Recommended");
    expect(markup).toContain("separate 24-bit audio masters");
    expect(markup).toContain("Back to Review");
    expect(markup).toContain("Mix sources");
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
