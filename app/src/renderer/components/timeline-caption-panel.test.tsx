import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { createTimelineDraft } from "../../shared/timeline";
import { TimelineCaptionPanel } from "./TimelineCaptionPanel";

describe("TimelineCaptionPanel", () => {
  it("auto-times a pasted transcript across the selected range in one undoable draft change", () => {
    const draft = createTimelineDraft({
      deviceDefaults: { cameras: {}, microphones: {} },
      durationMs: 30000,
    });
    const onDraftChange = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <TimelineCaptionPanel
          draft={draft}
          playheadMs={5000}
          rangeStartMs={5000}
          rangeEndMs={15000}
          hasSelectedRange
          onDraftChange={onDraftChange}
        />,
      );
    });

    const textarea = host.querySelector(
      'textarea[aria-label="Transcript to auto-time"]',
    ) as HTMLTextAreaElement;
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    act(() => {
      valueSetter?.call(
        textarea,
        "Welcome to the show. Today we have a much longer second line for our guest.",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const autoTimeButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Auto-time transcript"),
    ) as HTMLButtonElement;
    act(() =>
      autoTimeButton.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );

    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        captions: [
          expect.objectContaining({
            startMs: 5000,
            text: "Welcome to the show.",
          }),
          expect.objectContaining({
            endMs: 15000,
            text: "Today we have a much longer second line for our guest.",
          }),
        ],
        history: [expect.objectContaining({ label: "Auto-time transcript" })],
      }),
    );

    act(() => root.unmount());
    host.remove();
  });

  it("adds free local Whisper results as one undoable caption change", async () => {
    const draft = createTimelineDraft({
      deviceDefaults: { cameras: {}, microphones: {} },
      durationMs: 30000,
    });
    const onDraftChange = vi.fn();
    const onTranscribeLocally = vi.fn(async () => ({
      modelName: "Whisper base.en Q5_1",
      message: "2 caption cues created locally.",
      cues: [
        { id: "whisper-1", startMs: 1000, endMs: 3000, text: "Welcome back." },
        {
          id: "whisper-2",
          startMs: 3000,
          endMs: 6000,
          text: "Here is our guest.",
        },
      ],
    }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <TimelineCaptionPanel
          draft={draft}
          playheadMs={0}
          rangeStartMs={0}
          rangeEndMs={30000}
          hasSelectedRange={false}
          onDraftChange={onDraftChange}
          transcriptionStatus={{
            supported: true,
            ready: false,
            modelName: "Whisper base.en Q5_1",
            modelSizeBytes: 59721011,
            message: "First use downloads the free model.",
          }}
          onTranscribeLocally={onTranscribeLocally}
        />,
      );
    });

    const button = Array.from(host.querySelectorAll("button")).find(
      (candidate) =>
        candidate.textContent?.includes("Transcribe episode locally"),
    ) as HTMLButtonElement;
    await act(async () => button.click());

    expect(onTranscribeLocally).toHaveBeenCalledOnce();
    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        captions: expect.arrayContaining([
          expect.objectContaining({ text: "Welcome back." }),
        ]),
        history: [
          expect.objectContaining({ label: "Transcribe episode locally" }),
        ],
      }),
    );
    expect(host.textContent).toContain("2 caption cues created locally.");

    act(() => root.unmount());
    host.remove();
  });

  it("searches spoken text and turns one cue into a real Program cut", () => {
    const base = createTimelineDraft({
      deviceDefaults: { cameras: {}, microphones: {} },
      durationMs: 30000,
    });
    const draft = {
      ...base,
      captions: [
        {
          id: "cue-1",
          startMs: 4000,
          endMs: 6200,
          text: "Um, remove this line.",
        },
      ],
    };
    const onDraftChange = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <TimelineCaptionPanel
          draft={draft}
          playheadMs={0}
          rangeStartMs={0}
          rangeEndMs={30000}
          hasSelectedRange={false}
          onDraftChange={onDraftChange}
        />,
      );
    });

    expect(
      host.querySelector('input[aria-label="Search transcript"]'),
    ).toBeTruthy();
    expect(host.textContent).toContain("Review filler words (1)");
    const cutButton = host.querySelector(
      'button[title="Cut this spoken range from the finished episode"]',
    ) as HTMLButtonElement;
    act(() => cutButton.click());

    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        editLog: [
          expect.objectContaining({
            type: "delete-section",
            targetTrackId: "program",
            timestampMs: 4000,
            endTimestampMs: 6200,
          }),
        ],
      }),
    );

    act(() => root.unmount());
    host.remove();
  });
});
