import { describe, expect, it } from "vitest";
import { createTimelineDraft, updateTimelineTrackMix } from "../../shared/timeline";
import { getReviewVideoUniforms, needsReviewVideoCompositor } from "./review-video-compositor";

describe("Review video compositor", () => {
  it("maps the complete camera treatment range into stable shader uniforms", () => {
    const base = createTimelineDraft({ deviceDefaults: { cameras: { camera1: "cam" }, microphones: {} } });
    const treated = updateTimelineTrackMix(base, "camera-camera1", { brightness: 80, contrast: 180, saturation: 25, temperature: -50, tint: 40, sharpness: 70, denoise: 60 });
    expect(getReviewVideoUniforms(treated.tracks.find((track) => track.id === "camera-camera1"))).toEqual({
      brightness: 0.8,
      contrast: 1.8,
      saturation: 0.25,
      temperature: -0.5,
      tint: 0.4,
      sharpness: 0.7,
      denoise: 0.6
    });
  });

  it("does not spend GPU time compositing an untreated camera", () => {
    const base = createTimelineDraft({ deviceDefaults: { cameras: { camera1: "cam" }, microphones: {} } });
    const camera = base.tracks.find((track) => track.id === "camera-camera1");
    expect(needsReviewVideoCompositor(camera)).toBe(false);
    expect(needsReviewVideoCompositor(camera ? { ...camera, denoise: 1 } : undefined)).toBe(true);
    expect(needsReviewVideoCompositor(camera ? { ...camera, sharpness: 1 } : undefined)).toBe(true);
  });
});
