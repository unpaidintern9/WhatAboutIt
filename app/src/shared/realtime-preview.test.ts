import { describe, expect, it } from "vitest";
import type { ReviewMediaInventory } from "./review-media";
import { getRealtimePreviewSourceTimeMs, resolveRealtimeProgramPreview } from "./realtime-preview";
import { addCameraDecision, applyTimelineEdit, createTimelineDraft, selectTimelinePoint, updateTimelineCameraTransition, updateTimelineTrackMix } from "./timeline";

const deviceDefaults = {
  cameras: { camera1: "camera-a", camera2: "camera-b", camera3: "" },
  microphones: { morganMic: "mic-a", guestMic: "", extraMic: "" },
  cameraSettings: {},
  cameraMicrophones: {},
  audioOutputId: ""
};

const media: ReviewMediaInventory = {
  episodeId: "episode-a",
  episodeFolder: "C:/episode-a",
  loadedAt: "2026-08-25T12:00:00.000Z",
  program: { id: "program", label: "Program", kind: "program", relativePath: "Program/program.webm", playbackUrl: "media://program", status: "ready", message: "Ready" },
  cameras: [
    { id: "camera-1", label: "Camera 1", kind: "camera", relativePath: "Cameras/camera-1.webm", playbackUrl: "media://camera-1", status: "ready", message: "Ready" },
    { id: "camera-2", label: "Camera 2", kind: "camera", relativePath: "Cameras/camera-2.webm", playbackUrl: "media://camera-2", status: "ready", message: "Ready" }
  ],
  audio: [],
  hasPlayableProgram: true,
  message: "Ready"
};

function draft() {
  return createTimelineDraft({ episodeId: "episode-a", durationMs: 60_000, deviceDefaults });
}

function cutToCamera(input: ReturnType<typeof draft>, trackId: string, timestampMs: number) {
  return addCameraDecision(
    selectTimelinePoint(input, { timestampMs, trackId, source: "timeline" }),
    trackId,
    "manual",
    "Test cut",
    "2026-08-25T12:00:00.000Z"
  );
}

describe("real-time Program preview", () => {
  it("uses the recorded Program until a camera decision becomes active", () => {
    const input = cutToCamera(draft(), "camera-camera2", 10_000);

    expect(resolveRealtimeProgramPreview(input, media, 9_999).layers[0].asset.id).toBe("program");
    expect(resolveRealtimeProgramPreview(input, media, 10_000).layers[0].asset.id).toBe("camera-2");
  });

  it("keeps the outgoing source available during a configured crossfade", () => {
    const input = updateTimelineCameraTransition(cutToCamera(draft(), "camera-camera2", 10_000), "fade", 500);
    const preview = resolveRealtimeProgramPreview(input, media, 10_200);

    expect(preview.layers.map((layer) => [layer.asset.id, layer.role])).toEqual([
      ["camera-2", "active"],
      ["program", "outgoing"]
    ]);
    expect(resolveRealtimeProgramPreview(input, media, 10_500).layers).toHaveLength(1);
  });

  it("applies each source sync offset without changing the timeline clock", () => {
    const synced = updateTimelineTrackMix(draft(), "camera-camera2", { syncOffsetMs: -240 });
    const input = cutToCamera(synced, "camera-camera2", 10_000);
    const preview = resolveRealtimeProgramPreview(input, media, 12_000);

    expect(preview.timelineTimeMs).toBe(12_000);
    expect(preview.layers[0].sourceTimeMs).toBe(11_760);
    expect(getRealtimePreviewSourceTimeMs(100, { ...input.tracks[0], syncOffsetMs: -500 })).toBe(0);
  });

  it("reports edit and camera boundaries so playback can switch without waiting for timeupdate", () => {
    const cut = cutToCamera(draft(), "camera-camera2", 10_000);
    const selected = selectTimelinePoint(cut, { timestampMs: 20_000, endTimestampMs: 25_000, trackId: "program", source: "timeline" });
    const edited = applyTimelineEdit(selected, "delete-section", "2026-08-25T12:00:01.000Z", "program");

    expect(resolveRealtimeProgramPreview(edited, media, 9_000).nextBoundaryMs).toBe(10_000);
    expect(resolveRealtimeProgramPreview(edited, media, 10_000).nextBoundaryMs).toBe(20_000);
    expect(resolveRealtimeProgramPreview(edited, media, 20_000).nextBoundaryMs).toBe(25_000);
  });

  it("falls back safely when a chosen camera is disabled or missing", () => {
    const cut = cutToCamera(draft(), "camera-camera2", 10_000);
    const disabled = updateTimelineTrackMix(cut, "camera-camera2", { includedInProgram: false });
    const missingMedia = { ...media, cameras: media.cameras.filter((asset) => asset.id !== "camera-2") };

    expect(resolveRealtimeProgramPreview(disabled, media, 12_000).layers[0].asset.id).toBe("program");
    expect(resolveRealtimeProgramPreview(cut, missingMedia, 12_000).layers[0].asset.id).toBe("program");
  });
});
