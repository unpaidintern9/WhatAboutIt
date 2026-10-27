import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { EpisodeMetadata } from "../shared/types";
import { withEpisodeLibraryStatus } from "./episode-library-status";
let folder: string;
let episode: EpisodeMetadata;
beforeEach(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "wai-library-status-"));
  episode = { id: "episode", title: "Episode", status: "draft", createdAt: "2026-10-25T10:00:00Z", updatedAt: "2026-10-25T10:00:00Z", folderPath: folder, phase: "phase-1-shell" };
  await fs.mkdir(path.join(folder, "Session"));
});
afterEach(async () => { await fs.rm(folder, { recursive: true, force: true }); });
it("distinguishes a durable saved pause from a completed recording without rewriting metadata", async () => {
  await fs.writeFile(path.join(folder, "Session", "recording-state.json"), JSON.stringify({ status: "paused", elapsedMs: 12000 }));
  await fs.writeFile(path.join(folder, "Session", "recording-session.json"), JSON.stringify({ durablePaused: true }));
  expect(await withEpisodeLibraryStatus(episode)).toMatchObject({ resumeAvailable: true, durationMs: 12000, status: "draft" });
  await fs.writeFile(path.join(folder, "Session", "recording-state.json"), JSON.stringify({ status: "stopped", elapsedMs: 17000 }));
  expect(await withEpisodeLibraryStatus(episode)).toMatchObject({ resumeAvailable: false, durationMs: 17000, status: "recorded" });
  await fs.writeFile(path.join(folder, "Session", "recording-session.json"), JSON.stringify({ durablePaused: false, captureFolderPath: "Recordings/part-1" }));
  expect(await withEpisodeLibraryStatus(episode)).toMatchObject({ resumeAvailable: true, durationMs: 17000, status: "recorded" });
  expect(episode.status).toBe("draft");
});
it("uses a completed export, skipping a newer failed job", async () => {
  for (const [name, status] of [["2026-10-25-a", "complete"], ["2026-10-25-b", "error"]]) {
    const destination = path.join(folder, "Exports", name); await fs.mkdir(destination, { recursive: true });
    await fs.writeFile(path.join(destination, "export-job.json"), JSON.stringify({ status, completedAt: "2026-10-25T12:00:00Z" }));
  }
  expect(await withEpisodeLibraryStatus(episode)).toMatchObject({ status: "exported", updatedAt: "2026-10-25T12:00:00Z" });
});
it("keeps a new episode usable when journals are missing or invalid", async () => {
  await fs.writeFile(path.join(folder, "Session", "recording-state.json"), "interrupted write");
  expect((await withEpisodeLibraryStatus(episode)).status).toBe("draft");
});
