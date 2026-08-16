import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { createTimelineDraft } from "../../shared/timeline";
import { TimelineCaptionPanel } from "./TimelineCaptionPanel";

describe("TimelineCaptionPanel", () => {
  it("auto-times a pasted transcript across the selected range in one undoable draft change", () => {
    const draft = createTimelineDraft({ deviceDefaults: { cameras: {}, microphones: {} }, durationMs: 30000 });
    const onDraftChange = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(<TimelineCaptionPanel draft={draft} playheadMs={5000} rangeStartMs={5000} rangeEndMs={15000} hasSelectedRange onDraftChange={onDraftChange} />);
    });

    const textarea = host.querySelector('textarea[aria-label="Transcript to auto-time"]') as HTMLTextAreaElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    act(() => {
      valueSetter?.call(textarea, "Welcome to the show. Today we have a much longer second line for our guest.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const autoTimeButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Auto-time transcript")) as HTMLButtonElement;
    act(() => autoTimeButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({
      captions: [
        expect.objectContaining({ startMs: 5000, text: "Welcome to the show." }),
        expect.objectContaining({ endMs: 15000, text: "Today we have a much longer second line for our guest." })
      ],
      history: [expect.objectContaining({ label: "Auto-time transcript" })]
    }));

    act(() => root.unmount());
    host.remove();
  });
});
