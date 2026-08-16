import { describe, expect, it } from "vitest";
import { parseWhisperJson } from "./local-transcription";

describe("local Whisper transcription", () => {
  it("turns verified Whisper JSON offsets into editable caption cues", () => {
    expect(parseWhisperJson({
      transcription: [
        { offsets: { from: 1250, to: 3440 }, text: "  Welcome   to the show. " },
        { offsets: { from: 3440, to: 6510 }, text: "Today we have a guest." }
      ] }, "episode-a"))
      .toEqual([
        { id: "episode-a-1", startMs: 1250, endMs: 3440, text: "Welcome to the show." },
        { id: "episode-a-2", startMs: 3440, endMs: 6510, text: "Today we have a guest." }
      ]);
  });

  it("accepts timestamp strings and ignores invalid or empty segments", () => {
    expect(parseWhisperJson({
      transcription: [
        { timestamps: { from: "00:00:02,500", to: "00:00:04,000" }, text: " Usable " },
        { offsets: { from: 5000, to: 4000 }, text: "Backwards" },
        { offsets: { from: 5000, to: 6000 }, text: " " }
      ] }))
      .toEqual([{ id: "caption-whisper-1", startMs: 2500, endMs: 4000, text: "Usable" }]);
  });
});
