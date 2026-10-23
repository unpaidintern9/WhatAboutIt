import { describe, expect, it } from "vitest";
import { createEditorInterchange } from "./editor-interchange";
import { createTimelineDraft } from "./timeline";

describe("editable external editor timeline", () => {
  it("preserves cuts, selected cameras, isolated voices, offsets, mute and escaped markers", () => {
    const draft = createTimelineDraft({
      episodeId: "A & B",
      durationMs: 10000,
      deviceDefaults: {
        cameras: { camera1: "cam" },
        microphones: { morganMic: "mic", mic8: "interface" },
      },
    });
    draft.editLog = [
      {
        id: "cut",
        type: "delete-section",
        label: "Cut",
        timestampMs: 2000,
        endTimestampMs: 4000,
        createdAt: draft.createdAt,
      },
    ];
    draft.cameraDecisions = [
      {
        id: "switch",
        cameraTrackId: "camera-camera1",
        startMs: 4000,
        source: "manual",
        reason: "test",
      },
    ];
    draft.tracks.find((track) => track.sourceAssetId === "mic-8")!.muted = true;
    draft.tracks.find(
      (track) => track.sourceAssetId === "morgan-mic",
    )!.syncOffsetMs = -500;
    draft.markers = [
      {
        id: "marker",
        label: 'A < B & "C"',
        timestampMs: 6000,
        createdAt: draft.createdAt,
      },
    ];
    const result = createEditorInterchange(draft, [
      {
        assetId: "program",
        file: "02 Camera Video/Program Source.mp4",
        kind: "video",
        durationMs: 10000,
      },
      {
        assetId: "camera-1",
        file: "02 Camera Video/Camera 1.mp4",
        kind: "video",
        durationMs: 10000,
      },
      {
        assetId: "morgan-mic",
        file: "03 Isolated Audio/Morgan Mic.wav",
        kind: "audio",
        durationMs: 10000,
      },
      {
        assetId: "mic-8",
        file: "03 Isolated Audio/Mic 8.wav",
        kind: "audio",
        durationMs: 10000,
      },
    ]);
    for (const document of [result.fcpxml, result.premiereXml])
      expect(
        new DOMParser()
          .parseFromString(document, "application/xml")
          .querySelector("parsererror"),
      ).toBeNull();
    expect(result.durationMs).toBe(8000);
    expect(
      result.clips.find((clip) => clip.label === "Morgan Mic")?.timelineStart,
    ).toBe(500);
    expect(
      result.clips
        .filter((clip) => clip.source.assetId === "mic-8")
        .every((clip) => clip.gain === 0),
    ).toBe(true);
    expect(
      result.clips
        .filter((clip) => clip.lane > 0)
        .map((clip) => clip.source.assetId),
    ).toEqual(["program", "camera-1"]);
    expect(result.fcpxml).toContain(
      'start="120/30s" duration="1/30s" value="A &lt; B &amp; &quot;C&quot;"',
    );
    expect(result.fcpxml).toContain("../02%20Camera%20Video/Camera%201.mp4");
  });
});
