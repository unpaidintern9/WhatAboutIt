import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingSession } from "../shared/recording";
const paths = vi.hoisted(() => ({ root: "" }));
vi.mock("./config-service", () => ({ getEpisodesRoot: () => paths.root }));
vi.mock("./logger", () => ({ logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const defaults = { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } };

describe("durable episode recording parts", () => {
  beforeEach(async () => { vi.resetModules(); paths.root = await fs.mkdtemp(path.join(os.tmpdir(), "wai-parts-")); });
  afterEach(async () => { await fs.rm(paths.root, { recursive: true, force: true }); });
  async function capture(session: RecordingSession, camera: boolean | "camera2" = true, misleadingFrameRate = false) {
    const { runFfmpeg } = await import("./ffmpeg-tools");
    const { beginRecordingMedia, appendRecordingChunk } = await import("./recording-session-store");
    const source = path.join(paths.root, "fixture.webm");
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=red:size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "0.6", "-c:v", "libvpx", "-c:a", "libopus", "-shortest", "-live", "1", source]);
    const folder = session.captureFolderPath!;
    await beginRecordingMedia(folder);
    const bytes = await fs.readFile(source);
    if (misleadingFrameRate) {
      // Keep the actual frame timestamps, but reproduce the millisecond
      // default-frame duration reported by Chromium VFR recordings.
      const duration = bytes.indexOf(Buffer.from([0x23, 0xe3, 0x83, 0x84]));
      expect(duration).toBeGreaterThanOrEqual(0);
      bytes.writeUInt32BE(1_000_000, duration + 4);
    }
    const sourceStartedAt = new Date().toISOString();
    await appendRecordingChunk(folder, { target: "program", kind: "program", sourceStartedAt, sequence: 1, mimeType: "video/webm", bytes });
    if (camera) await appendRecordingChunk(folder, { target: camera === "camera2" ? "camera2" : "camera1", kind: "camera", sourceStartedAt, sequence: 1, mimeType: "video/webm", bytes });
    await appendRecordingChunk(folder, { target: "morganMic", kind: "audio", sourceStartedAt: new Date(Date.parse(sourceStartedAt) - 125).toISOString(), sequence: 1, mimeType: "audio/webm", bytes });
  }
  it("pauses, reloads, resumes twice in one episode, and combines only recorded time", async () => {
    let store = await import("./recording-session-store");
    const first = await store.createRecordingSession({ episodeId: "episode-a", episodeTitle: "Interview", deviceDefaults: defaults });
    await capture(first);
    const paused = await store.checkpointRecordingSession(first.folderPath, true);
    expect(paused.session).toMatchObject({ id: first.id, episodeId: first.episodeId, durablePaused: true, status: "paused" });
    const original = await fs.readFile(path.join(first.captureFolderPath!, "Program", "program.webm"));
    expect((await store.checkpointRecordingSession(first.folderPath, true)).session.elapsedMs).toBe(paused.session.elapsedMs);
    vi.resetModules();
    store = await import("./recording-session-store");
    expect(await store.listUnfinishedRecordingSessions()).toEqual(expect.arrayContaining([expect.objectContaining({ id: first.id, status: "paused", durablePaused: true })]));
    const second = await store.createRecordingSession({ episodeId: first.episodeId, deviceDefaults: defaults, resume: true });
    expect(second.folderPath).toBe(first.folderPath);
    expect(second.id).toBe(first.id);
    expect(second.captureFolderPath).not.toBe(first.captureFolderPath);
    expect(second.elapsedMs).toBe(paused.session.elapsedMs);
    await capture(second);
    const pausedAgain = await store.checkpointRecordingSession(first.folderPath, true);
    const third = await store.createRecordingSession({ episodeId: first.episodeId, deviceDefaults: defaults, resume: true });
    await capture(third);
    const complete = await store.checkpointRecordingSession(first.folderPath, false);
    const { getMediaDurationMs, validatePlayableMedia } = await import("./ffmpeg-tools");
    expect(complete.session.elapsedMs).toBeGreaterThan(pausedAgain.session.elapsedMs!);
    expect(complete.result?.integrity.programPlayable).toBe(true);
    expect(Math.abs((await getMediaDurationMs(complete.result!.programPath!)) - complete.session.elapsedMs!)).toBeLessThan(100);
    expect(await validatePlayableMedia(complete.result!.programPath!, undefined, { video: true, audio: true, decode: true })).toBe(true);
    for (const track of complete.result!.tracks) expect(Math.abs((await getMediaDurationMs(track.filePath!)) - complete.session.elapsedMs!)).toBeLessThan(120);
    expect(await fs.readFile(path.join(first.captureFolderPath!, "Program", "program.webm"))).toEqual(original);
    expect(await store.listUnfinishedRecordingSessions()).toHaveLength(0);
    expect((await store.createRecordingSession({ episodeId: first.episodeId, deviceDefaults: defaults })).folderPath).not.toBe(first.folderPath);
  }, 60000);
  it("withholds incomplete isolated tracks and keeps their part originals", async () => {
    const store = await import("./recording-session-store");
    const first = await store.createRecordingSession({ episodeId: "episode-gap", deviceDefaults: defaults });
    await capture(first, "camera2");
    await store.checkpointRecordingSession(first.folderPath, true);
    const second = await store.createRecordingSession({ episodeId: first.episodeId, deviceDefaults: defaults, resume: true });
    await capture(second, false);
    const complete = await store.checkpointRecordingSession(first.folderPath, false);
    expect(complete.result!.tracks.map((track) => track.slot)).not.toContain("camera2");
    expect(complete.result!.integrity.warnings.join(" ")).toContain("camera2 is incomplete");
    await expect(fs.stat(path.join(first.captureFolderPath!, "Cameras", "camera-2.webm"))).resolves.toBeTruthy();
  }, 40000);
  it("reuses the assembled Program when every paused Camera 1 source shares that original", async () => {
    const store = await import("./recording-session-store");
    const first = await store.createRecordingSession({ episodeId: "episode-shared-camera", deviceDefaults: defaults });
    await capture(first, false);
    await store.checkpointRecordingSession(first.folderPath, true);
    const second = await store.createRecordingSession({ episodeId: first.episodeId, deviceDefaults: defaults, resume: true });
    await capture(second, false);
    const complete = await store.checkpointRecordingSession(first.folderPath, false);
    const camera = complete.result!.tracks.find((track) => track.slot === "camera1")!;
    expect(await fs.readFile(camera.filePath!)).toEqual(await fs.readFile(complete.result!.programPath!));
    const [programStat, cameraStat] = await Promise.all([fs.stat(complete.result!.programPath!), fs.stat(camera.filePath!)]);
    expect(cameraStat.ino).toBe(programStat.ino);
    expect(complete.result?.integrity.programPlayable).toBe(true);
  }, 40000);
  it("bounds fallback rendering when resumed video reports a 1000 fps time base", async () => {
    const store = await import("./recording-session-store");
    const first = await store.createRecordingSession({ episodeId: "episode-vfr", deviceDefaults: defaults });
    await capture(first, true, true);
    await store.checkpointRecordingSession(first.folderPath, true);
    const original = await fs.readFile(path.join(first.captureFolderPath!, "Program", "program.webm"));
    const second = await store.createRecordingSession({ episodeId: first.episodeId, deviceDefaults: defaults, resume: true });
    await capture(second);
    const result = await store.checkpointRecordingSession(first.folderPath, false);
    const { runFfprobe } = await import("./ffmpeg-tools");
    const videoFiles = [result.result!.programPath!, ...result.result!.tracks.filter((track) => track.kind === "camera").map((track) => track.filePath!)];
    for (const file of videoFiles) {
      const output = JSON.parse((await runFfprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate,r_frame_rate", "-of", "json", file])).stdout);
      const [numerator, denominator] = output.streams[0].avg_frame_rate.split("/").map(Number);
      expect(numerator / denominator).toBeGreaterThanOrEqual(1);
      expect(numerator / denominator).toBeLessThanOrEqual(60);
    }
    expect(result.result?.integrity.programPlayable).toBe(true);
    expect(await fs.readFile(path.join(first.captureFolderPath!, "Program", "program.webm"))).toEqual(original);
  }, 40000);
  it("recovers after part finalization was interrupted before journal completion", async () => {
    const store = await import("./recording-session-store");
    const session = await store.createRecordingSession({ episodeId: "episode-crash", deviceDefaults: defaults });
    await capture(session);
    await store.finalizeRecordingMedia(session.captureFolderPath!);
    vi.resetModules();
    const recovered = await (await import("./recording-session-store")).recoverRecordingSession(session.folderPath);
    expect(recovered.integrity.programPlayable).toBe(true);
    expect(recovered.tracks).toHaveLength(2);
    await expect(fs.stat(path.join(session.captureFolderPath!, "Program", "program.source.webm"))).resolves.toBeTruthy();
  }, 30000);
  it("continues a paused episode automatically and recovers a device reopen that wrote no media", async () => {
    const store = await import("./recording-session-store");
    const first = await store.createRecordingSession({ episodeId: "episode-empty-retry", deviceDefaults: defaults });
    await capture(first);
    await store.checkpointRecordingSession(first.folderPath, true);
    const retry = await store.createRecordingSession({ episodeId: first.episodeId, deviceDefaults: defaults });
    expect(retry.folderPath).toBe(first.folderPath);
    await store.beginRecordingMedia(retry.captureFolderPath!);
    const recovered = await store.recoverRecordingSession(first.folderPath);
    expect(recovered.integrity.programPlayable).toBe(true);
    await expect(fs.stat(retry.captureFolderPath!)).resolves.toBeTruthy();
    const journal = JSON.parse(await fs.readFile(path.join(first.folderPath, "Session", "recording-parts.json"), "utf8"));
    expect(journal.parts).toHaveLength(1);
    expect(journal.abandonedEmptyParts).toHaveLength(1);
  }, 30000);
  it("rejects simultaneous resume claims and refuses to resume a finished episode", async () => {
    const store = await import("./recording-session-store");
    const first = await store.createRecordingSession({ episodeId: "episode-exclusive", deviceDefaults: defaults });
    await capture(first);
    await store.checkpointRecordingSession(first.folderPath, true);
    const claims = await Promise.allSettled([1, 2].map(() => store.createRecordingSession({ episodeId: first.episodeId, deviceDefaults: defaults, resume: true })));
    expect(claims.filter((claim) => claim.status === "fulfilled")).toHaveLength(1);
    const second = claims.find((claim) => claim.status === "fulfilled") as PromiseFulfilledResult<RecordingSession>;
    await capture(second.value);
    await store.checkpointRecordingSession(first.folderPath, false);
    await expect(store.createRecordingSession({ episodeId: first.episodeId, deviceDefaults: defaults, resume: true })).rejects.toThrow("not saved as a paused recording");
  }, 40000);
});
