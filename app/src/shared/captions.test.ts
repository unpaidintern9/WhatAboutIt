import { describe, expect, it } from "vitest";
import { autoTimeTranscript, parseTimedCaptionDocument } from "./captions";

describe("caption helpers", () => {
  it("parses SRT and WebVTT timestamps without uploading media", () => {
    const srt = parseTimedCaptionDocument("1\n00:00:01,250 --> 00:00:03,500\nHello <i>Morgan</i>.\n\n2\n00:03.500 --> 00:05.000 align:start\nWelcome back!");

    expect(srt).toEqual([
      { id: "caption-import-1", startMs: 1250, endMs: 3500, text: "Hello Morgan." },
      { id: "caption-import-2", startMs: 3500, endMs: 5000, text: "Welcome back!" }
    ]);
  });

  it("splits a plain transcript into readable cues and times them by word count", () => {
    const cues = autoTimeTranscript("A short opening. This second sentence has quite a few more words for the audience.", 1000, 11000, "local");

    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ id: "local-1", startMs: 1000, text: "A short opening." });
    expect(cues[0].endMs).toBeLessThan(5000);
    expect(cues[1]).toMatchObject({ id: "local-2", endMs: 11000 });
  });

  it("returns no cues for empty or malformed caption text", () => {
    expect(parseTimedCaptionDocument("WEBVTT\n\nnot a cue")).toEqual([]);
    expect(autoTimeTranscript("   ", 0, 10000)).toEqual([]);
  });
});
