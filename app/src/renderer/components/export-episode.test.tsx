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
      onTypeChange={vi.fn()}
      onQualityChange={vi.fn()}
      onStartExport={vi.fn()}
      onCancelExport={vi.fn()}
      onOpenFolder={vi.fn()}
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
      outputFileName: "video.txt"
    });

    expect(markup).toContain("Export complete");
    expect(markup).toContain("Open export folder");
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
