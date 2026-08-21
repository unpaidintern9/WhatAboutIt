import { describe, expect, it, vi } from "vitest";

vi.mock("./config-service", () => ({
  getAppDataRoot: () => "/tmp/what-about-it-test-data",
  getEpisodesRoot: () => "/tmp/what-about-it-test-episodes",
}));

vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  createTranscriptionAudioArguments,
  LOCAL_WHISPER_MODEL,
  LOCAL_WHISPER_RUNTIME,
  LOCAL_WHISPER_RUNTIME_FILES,
} from "./local-transcription-store";

describe("local transcription setup", () => {
  it("pins the free model and Windows runtime to verified SHA-256 digests", () => {
    expect(LOCAL_WHISPER_MODEL.url).toContain(
      "/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/",
    );
    expect(LOCAL_WHISPER_MODEL.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(LOCAL_WHISPER_RUNTIME.url).toContain("/v1.9.2/");
    expect(LOCAL_WHISPER_RUNTIME.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(LOCAL_WHISPER_RUNTIME_FILES)).toContain(
      "whisper-cli.exe",
    );
    expect(
      Object.values(LOCAL_WHISPER_RUNTIME_FILES).every((digest) =>
        /^[a-f0-9]{64}$/.test(digest),
      ),
    ).toBe(true);
  });

  it("prepares one audio track as a 16 kHz mono PCM WAV", () => {
    expect(
      createTranscriptionAudioArguments(["morgan.m4a"], "episode.wav"),
    ).toEqual([
      "-y",
      "-i",
      "morgan.m4a",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      "episode.wav",
    ]);
  });

  it("mixes all microphone tracks so guests are not left out", () => {
    const args = createTranscriptionAudioArguments(
      ["morgan.m4a", "guest.m4a", "extra.m4a"],
      "episode.wav",
    );
    expect(args).toEqual(
      expect.arrayContaining([
        "-i",
        "morgan.m4a",
        "-i",
        "guest.m4a",
        "-i",
        "extra.m4a",
      ]),
    );
    expect(args.join(" ")).toContain("amix=inputs=3:duration=longest");
    expect(args).toEqual(expect.arrayContaining(["-ac", "1", "-ar", "16000"]));
  });
});
