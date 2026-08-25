import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { ReviewMediaInventory } from "../shared/review-media";
import { createTimelineDraft, updateTimelineCameraTransition } from "../shared/timeline";
import { TimelineReview } from "./components/TimelineReview";

const media: ReviewMediaInventory = {
  episodeId: "episode-a",
  episodeFolder: "C:/episode-a",
  loadedAt: "2026-08-25T12:00:00.000Z",
  program: { id: "program", label: "Program video", kind: "program", relativePath: "Program/program.webm", playbackUrl: "wai-media://program", status: "ready", message: "Ready" },
  cameras: [
    { id: "camera-1", label: "Camera 1", kind: "camera", relativePath: "Cameras/camera-1.webm", playbackUrl: "wai-media://camera-1", status: "ready", message: "Ready" },
    { id: "camera-2", label: "Camera 2", kind: "camera", relativePath: "Cameras/camera-2.webm", playbackUrl: "wai-media://camera-2", status: "ready", message: "Ready" }
  ],
  audio: [],
  hasPlayableProgram: true,
  message: "Ready"
};

function RealtimePreviewHarness() {
  const [draft, setDraft] = useState(() =>
    updateTimelineCameraTransition(
      createTimelineDraft({
        episodeId: "episode-a",
        durationMs: 30_000,
        deviceDefaults: {
          cameras: { camera1: "camera-a", camera2: "camera-b", camera3: "" },
          microphones: { morganMic: "", guestMic: "", extraMic: "" },
          cameraSettings: {},
          cameraMicrophones: {},
          audioOutputId: ""
        }
      }),
      "fade",
      300
    )
  );
  return (
    <TimelineReview
      draft={draft}
      media={media}
      onDraftChange={setDraft}
      onSaveDraft={vi.fn()}
      onExport={vi.fn()}
      onAutoEdit={vi.fn()}
      onTranscribeLocally={vi.fn()}
      onCancelTranscription={vi.fn()}
    />
  );
}

describe("real-time editor preview flow", () => {
  it("preloads camera layers and switches the visible Program source without remounting them", async () => {
    const pauseMock = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => root.render(<RealtimePreviewHarness />));

    const before = [...host.querySelectorAll<HTMLVideoElement>(".realtime-preview-layer")];
    expect(before).toHaveLength(3);
    expect(before.find((video) => video.getAttribute("aria-hidden") === "false")?.src).toContain("wai-media://program");

    const cameraTwoButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.getAttribute("aria-label")?.startsWith("Use Camera 2 in Program")
    );
    expect(cameraTwoButton).toBeTruthy();
    await act(async () => cameraTwoButton!.click());

    const after = [...host.querySelectorAll<HTMLVideoElement>(".realtime-preview-layer")];
    expect(after.find((video) => video.getAttribute("aria-hidden") === "false")?.src).toContain("wai-media://camera-2");
    expect(after).toEqual(before);
    expect(after.find((video) => video.src.includes("wai-media://program"))?.classList.contains("outgoing")).toBe(true);

    root.unmount();
    host.remove();
    pauseMock.mockRestore();
  });
});
