import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ root: "", render: vi.fn() }));
vi.mock("./config-service", () => ({ getEpisodesRoot: () => state.root }));
vi.mock("./logger", () => ({ logger: { warning: vi.fn() } }));
vi.mock("./review-proxy-store", () => ({ prepareEpisodeReviewProxies: vi.fn(async () => []) }));
vi.mock("./ffmpeg-tools", () => ({
  runFfmpeg: (...args: unknown[]) => state.render(...args),
  runFfprobe: vi.fn(async () => ({ stdout: JSON.stringify({ streams: [{ codec_type: "video" }, { codec_type: "audio" }], format: { duration: "3600", size: "5" } }), stderr: "" }))
}));
describe("progressive Review loading", () => {
  it("returns playable media while full-track artwork is still blocked, then patches artwork only", async () => {
    state.root = await fs.mkdtemp(path.join(os.tmpdir(), "wai-progressive-"));
    const folder = path.join(state.root, "episode");
    await fs.mkdir(path.join(folder, "Program"), { recursive: true });
    await fs.writeFile(path.join(folder, "Program", "program.webm"), "video");
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    state.render.mockImplementation(async (args: string[]) => { await blocked; await fs.writeFile(args.at(-1)!, "artwork"); return { stdout: "", stderr: "" }; });
    const { loadReviewMedia, onReviewMediaUpdate, cancelReviewArtwork } = await import("./review-media-store");
    const { applyReviewMediaUpdate } = await import("../shared/review-media");
    const updates: import("../shared/review-media").ReviewMediaUpdate[] = [];
    const unsubscribe = onReviewMediaUpdate((update) => updates.push(update));
    try {
      const inventory = await loadReviewMedia("episode");
      expect(inventory.hasPlayableProgram).toBe(true);
      expect(inventory.program.waveformUrl).toBeUndefined();
      expect(inventory.program.playbackUrl).toBeTruthy();
      release();
      await vi.waitFor(() => expect(updates.some((update) => update.asset.waveformUrl && update.asset.posterUrl)).toBe(true));
      const merged = applyReviewMediaUpdate(inventory, updates.at(-1)!);
      expect(merged?.program.waveformUrl).toBeTruthy();
      expect(merged?.program.playbackUrl).toBe(inventory.program.playbackUrl);
      expect(applyReviewMediaUpdate(inventory, { ...updates[0], episodeId: "other" })).toBe(inventory);
      const replaced = { ...inventory, program: { ...inventory.program, sourceVersion: "replacement" } };
      expect(applyReviewMediaUpdate(replaced, updates[0])?.program.waveformUrl).toBeUndefined();
      const originalUrl = updates.at(-1)!.asset.waveformUrl;
      const source = path.join(folder, "Program", "program.webm");
      const future = new Date(Date.now() + 2000);
      await fs.utimes(source, future, future);
      const fresh = await loadReviewMedia("episode");
      expect(fresh.program.waveformUrl).toBeUndefined();
      await vi.waitFor(() => expect(updates.some((update) => update.asset.sourceVersion === fresh.program.sourceVersion && update.asset.waveformUrl !== originalUrl && update.asset.waveformUrl)).toBe(true));
    } finally { release(); unsubscribe(); await cancelReviewArtwork(); await fs.rm(state.root, { recursive: true, force: true }); }
  });
});
