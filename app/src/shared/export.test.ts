import { describe, expect, it } from "vitest";
import {
  cancelExportJob,
  completeExportJob,
  createExportJob,
  createExportSummary,
  defaultExportSettings,
  exportFriendlyErrorCopy,
  failExportJob
} from "./export";

describe("export jobs", () => {
  it("creates an export job", () => {
    const job = createExportJob({
      episodeId: "episode-a",
      type: "full-episode-video",
      qualityPreset: "standard",
      outputFolder: "Episode/Exports",
      now: "2026-06-27T10:00:00.000Z"
    });

    expect(job.status).toBe("queued");
    expect(job.outputFolder).toBe("Episode/Exports");
    expect(job.message).toBe("Save a finished copy");
  });

  it("creates an export summary that keeps originals safe", () => {
    const job = completeExportJob(
      createExportJob({
        episodeId: "episode-a",
        type: "audio-only",
        qualityPreset: "high",
        outputFolder: "Episode/Exports"
      }),
      "audio.txt",
      "2026-06-27T10:10:00.000Z"
    );
    const summary = createExportSummary(job);

    expect(summary.status).toBe("complete");
    expect(summary.outputFileName).toBe("audio.txt");
    expect(summary.originalRecordingSafe).toBe(true);
  });

  it("supports cancel and friendly error states", () => {
    const job = createExportJob({
      episodeId: "episode-a",
      type: "archive-master",
      qualityPreset: "archive",
      outputFolder: "Episode/Exports"
    });
    const canceled = cancelExportJob(job);
    const failed = failExportJob(job, "recording-missing");

    expect(canceled.status).toBe("canceled");
    expect(canceled.message).toBe("Export was canceled");
    expect(failed.status).toBe("error");
    expect(failed.message).toBe("We couldn't find the recording file");
    expect(exportFriendlyErrorCopy["not-enough-space"]).toBe("There isn't enough space");
  });

  it("sets default export settings", () => {
    expect(defaultExportSettings.defaultExportFolder).toBe("Exports");
    expect(defaultExportSettings.defaultExportType).toBe("full-episode-video");
    expect(defaultExportSettings.qualityPreset).toBe("standard");
  });
});
