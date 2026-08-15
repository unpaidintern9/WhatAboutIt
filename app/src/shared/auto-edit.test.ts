import { describe, expect, it } from "vitest";
import { createTimelineDraft, updateTimelineCameraTransition, updateTimelineTrackMix } from "./timeline";
import { learnAutoEditProfile, runOfflineAutoEdit } from "./auto-edit";

describe("offline auto edit", () => {
  it("creates a non-destructive draft and report", () => {
    const draft = createTimelineDraft({
      episodeId: "episode-a",
      deviceDefaults: {
        cameras: { camera1: "camera-a" },
        microphones: { morganMic: "mic-a" }
      },
      markers: [
        {
          id: "marker-a",
          label: "Highlight",
          timestampMs: 42000,
          createdAt: "2026-06-27T10:00:00.000Z"
        }
      ],
      durationMs: 180000
    });
    const result = runOfflineAutoEdit({
      draft,
      mode: "balanced",
      now: "2026-06-27T10:00:00.000Z"
    });

    expect(result.draft.nonDestructive).toBe(true);
    expect(result.draft.editLog.at(-1)?.type).toBe("auto-edit-suggestion");
    expect(result.report.mode).toBe("balanced");
    expect(result.report.originalRecordingSafe).toBe(true);
    expect(result.report.chaptersGenerated.length).toBeGreaterThan(0);
    expect(result.report.clipsSuggested[0].reason).toContain("marker");
    expect(result.report.runtimeReductionMs).toBe(0);
    expect(result.report.editedLengthMs).toBe(result.report.originalLengthMs);
    expect(result.draft.cameraTransition).toBe("cut");
    expect(result.draft.tracks.find((track) => track.id === "mic-morganMic")).toMatchObject({
      audioPreset: "warm",
      noiseReduction: 24,
      noiseGateDb: -54,
      deEsser: 32,
      compression: 45,
      limiterEnabled: true
    });
    expect(result.draft.tracks.find((track) => track.id === "camera-camera1")).toMatchObject({
      denoise: 14,
      sharpness: 18,
      contrast: 104,
      saturation: 103
    });
    expect(result.report.changesMade.map((change) => change.id)).toEqual(expect.arrayContaining(["voice-polish", "camera-polish", "camera-transitions"]));
  });

  it("uses soft camera changes for the gentle production profile", () => {
    const draft = createTimelineDraft({
      deviceDefaults: {
        cameras: { camera1: "camera-a" },
        microphones: { morganMic: "mic-a" }
      }
    });
    const result = runOfflineAutoEdit({ draft, mode: "gentle" });

    expect(result.draft.cameraTransition).toBe("fade");
    expect(result.draft.cameraTransitionMs).toBe(300);
    expect(result.draft.tracks.find((track) => track.id === "mic-morganMic")?.audioPreset).toBe("clean");
  });

  it("keeps manual edits and markers", () => {
    const draft = createTimelineDraft({
      deviceDefaults: { cameras: {}, microphones: {} },
      markers: [
        {
          id: "marker-a",
          label: "Sponsor",
          timestampMs: 90000,
          createdAt: "2026-06-27T10:00:00.000Z"
        }
      ]
    });
    const result = runOfflineAutoEdit({
      draft: {
        ...draft,
        editLog: [
          {
            id: "manual",
            type: "split",
            label: "Split here",
            timestampMs: 10,
            createdAt: "now"
          }
        ]
      },
      mode: "clip-hunter"
    });

    expect(result.draft.markers).toHaveLength(1);
    expect(result.draft.editLog.map((edit) => edit.id)).toContain("manual");
    expect(result.report.chaptersGenerated.map((chapter) => chapter.title)).toContain("Sponsor");
  });

  it("learns production treatment from an explicitly approved manual draft", () => {
    const base = createTimelineDraft({
      deviceDefaults: {
        cameras: { camera1: "camera-a" },
        microphones: { morganMic: "mic-a" }
      }
    });
    const audioTuned = updateTimelineTrackMix(base, "mic-morganMic", {
      audioPreset: "broadcast",
      noiseReduction: 80,
      compression: 76
    });
    const pictureTuned = updateTimelineTrackMix(audioTuned, "camera-camera1", {
      contrast: 116,
      sharpness: 40
    });
    const approved = updateTimelineCameraTransition(pictureTuned, "fade", 450);
    const profile = learnAutoEditProfile(approved, undefined, "balanced", "2026-06-27T10:00:00.000Z");
    const result = runOfflineAutoEdit({
      draft: base,
      mode: "balanced",
      learningProfile: { ...profile, sampleCount: 5 }
    });

    expect(profile).toMatchObject({
      sampleCount: 1,
      preferredMode: "balanced",
      cameraTransition: "fade",
      cameraTransitionMs: 450
    });
    expect(result.draft.tracks.find((track) => track.id === "mic-morganMic")?.noiseReduction).toBeGreaterThan(50);
    expect(result.draft.cameraTransition).toBe("fade");
    expect(result.report.learningSummary).toContain("approved manual drafts");
    expect(result.report.changesMade.map((change) => change.id)).toContain("learning-profile");
  });

  it("holds camera choices long enough to avoid rapid switching", () => {
    const draft = createTimelineDraft({
      deviceDefaults: {
        cameras: { camera1: "camera-a", camera2: "camera-b" },
        microphones: { morganMic: "mic-a", guestMic: "mic-b" }
      },
      durationMs: 20000
    });
    const result = runOfflineAutoEdit({
      draft,
      mode: "balanced",
      activitySegments: [
        {
          startMs: 0,
          endMs: 900,
          microphoneTrackId: "mic-morganMic",
          cameraTrackId: "camera-camera1",
          averageDb: -18
        },
        {
          startMs: 1000,
          endMs: 2200,
          microphoneTrackId: "mic-guestMic",
          cameraTrackId: "camera-camera2",
          averageDb: -16
        },
        {
          startMs: 4200,
          endMs: 6200,
          microphoneTrackId: "mic-guestMic",
          cameraTrackId: "camera-camera2",
          averageDb: -15
        }
      ]
    });

    expect(result.draft.cameraDecisions.map((decision) => decision.startMs)).toEqual([0, 4200]);
  });

  it("turns detected long silence into reviewable Program cuts", () => {
    const draft = createTimelineDraft({
      deviceDefaults: { cameras: {}, microphones: {} },
      durationMs: 60000
    });
    const result = runOfflineAutoEdit({
      draft,
      mode: "balanced",
      silenceSegments: [
        { startMs: 5000, endMs: 5700 },
        { startMs: 12000, endMs: 16000 }
      ]
    });

    expect(result.report.silenceSuggestions).toHaveLength(1);
    expect(result.report.silenceRemovedMs).toBe(3400);
    expect(result.report.editedLengthMs).toBe(56600);
    expect(result.draft.editLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "auto-silence-0-12000",
          type: "delete-section",
          targetTrackId: "program",
          timestampMs: 12300,
          endTimestampMs: 15700
        })
      ])
    );
  });
});
