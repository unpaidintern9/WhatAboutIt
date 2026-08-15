import { describe, expect, it } from "vitest";
import { deriveActivitySegments, parseEbur128Levels, parseSilenceSegments } from "./audio-activity-analysis";

describe("audio activity analysis", () => {
  it("parses real ebur128 frame log lines", () => {
    const levels = parseEbur128Levels(["[Parsed_ebur128_0] t: 0.500 TARGET:-23 LUFS M: -31.2 S:-120.7", "[Parsed_ebur128_0] t: 1.500 TARGET:-23 LUFS M: -18.4 S: -29.0"].join("\n"));

    expect(levels).toEqual([
      { timestampMs: 500, db: -31.2 },
      { timestampMs: 1500, db: -18.4 }
    ]);
  });

  it("switches cameras only after a microphone stays strongest", () => {
    const sourceA = {
      cameraTrackId: "camera-camera1",
      microphoneTrackId: "mic-morganMic"
    };
    const sourceB = {
      cameraTrackId: "camera-camera2",
      microphoneTrackId: "mic-guestMic"
    };
    const segments = deriveActivitySegments([
      {
        source: sourceA,
        levels: [0, 1000, 2000, 3000].map((timestampMs) => ({
          timestampMs,
          db: timestampMs < 2000 ? -12 : -35
        }))
      },
      {
        source: sourceB,
        levels: [0, 1000, 2000, 3000].map((timestampMs) => ({
          timestampMs,
          db: timestampMs < 2000 ? -38 : -10
        }))
      }
    ]);

    expect(segments.map((segment) => segment.cameraTrackId)).toEqual(["camera-camera1", "camera-camera2"]);
    expect(segments[1].startMs).toBe(2000);
  });

  it("parses complete silence ranges from ffmpeg output", () => {
    expect(
      parseSilenceSegments(
        [
          "[silencedetect] silence_start: 4.2",
          "[silencedetect] silence_end: 7.6 | silence_duration: 3.4",
          "[silencedetect] silence_start: 15",
          "[silencedetect] silence_end: 17.5 | silence_duration: 2.5"
        ].join("\n")
      )
    ).toEqual([
      { startMs: 4200, endMs: 7600 },
      { startMs: 15000, endMs: 17500 }
    ]);
  });
});
