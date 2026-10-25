import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTimelineDraft } from "../shared/timeline";
import { runFfmpeg } from "./ffmpeg-tools";
import { createAudioTreatment } from "./audio-treatment-filters";
const paths = vi.hoisted(() => ({ root: "" }));
vi.mock("./config-service", () => ({ getEpisodesRoot: () => paths.root }));
vi.mock("./logger", () => ({ logger: { warning: vi.fn() } }));

describe("export-matched audio cleanup", () => {
  beforeEach(async () => { paths.root = await fs.mkdtemp(path.join(os.tmpdir(), "wai-audio-match-")); });
  afterEach(async () => { await (await import("./review-audio-store")).cancelReviewAudioWork(); await fs.rm(paths.root, { recursive: true, force: true }); });
  it("compresses harsh high-band sound without applying a permanent treble cut to speech", async () => {
    const input = path.join(paths.root, "tones.wav");
    const wav = Buffer.alloc(44 + 96000 * 2);
    wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
    for (let i = 0; i < 96000; i++) wav.writeInt16LE(Math.round(0.7 * 32767 * Math.sin(i * 2 * Math.PI * (i < 48000 ? 440 : 8000) / 48000)), 44 + i * 2);
    await fs.writeFile(input, wav);
    const track = createTimelineDraft({ deviceDefaults: { cameras: {}, microphones: { morganMic: "usb" } } }).tracks.find((track) => track.kind === "microphone")!;
    const baseline = path.join(paths.root, "baseline.f32");
    const cleaned = path.join(paths.root, "cleaned.f32");
    for (const [target, amount] of [[baseline, 0], [cleaned, 100]] as const) await runFfmpeg(["-y", "-i", input, "-af", createAudioTreatment({ ...track, deEsser: amount }).replace(/,$/, ""), "-f", "f32le", target]);
    const db = (bytes: Buffer, start: number, end: number) => { let energy = 0; for (let i = start; i < end; i++) energy += bytes.readFloatLE(i * 4) ** 2; return 10 * Math.log10(energy / (end - start)); };
    const raw = await fs.readFile(baseline); const processed = await fs.readFile(cleaned);
    expect(Math.abs(db(processed, 12000, 36000) - db(raw, 12000, 36000))).toBeLessThan(1);
    expect(db(processed, 60000, 84000) - db(raw, 60000, 84000)).toBeLessThan(-5);
  }, 15000);
  it("caches a lossless processed source using the export filter chain and preserves originals", async () => {
    const { prepareReviewAudio } = await import("./review-audio-store");
    const folder = path.join(paths.root, "episode", "Audio");
    await fs.mkdir(folder, { recursive: true });
    const source = path.join(folder, "morgan-mic.flac");
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=6000:duration=0.4:sample_rate=48000", "-c:a", "flac", source]);
    const original = await fs.readFile(source);
    const track = { ...createTimelineDraft({ deviceDefaults: { cameras: {}, microphones: { morganMic: "usb" } } }).tracks.find((track) => track.kind === "microphone")!, deEsser: 70, noiseReduction: 15 };
    const first = await prepareReviewAudio("test", "episode", track);
    const second = await prepareReviewAudio("test", "episode", { ...track, volume: 150 });
    expect(first.playbackUrl).toBe(second.playbackUrl);
    expect(first.signature).toBe(second.signature);
    expect(await fs.readFile(source)).toEqual(original);
    expect(Buffer.from(first.playbackUrl.split("/").at(-1)!, "base64url").toString()).toContain("audio-treatment-");
  }, 15000);
});
