import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { createDefaultPodcastToolsState } from "../../shared/podcast-tools";
import type { DeviceDefaults } from "../../shared/types";
import { RecordingStudio } from "./RecordingStudio";

const defaults: DeviceDefaults = {
  cameras: { camera1: "camera-a" },
  cameraMicrophones: { camera1: "morganMic", camera2: "guestMic", camera3: "extraMic" },
  microphones: { morganMic: "mic-a" },
  audioOutputId: "speaker-a"
};

function renderStudio(overrides: Partial<ComponentProps<typeof RecordingStudio>> = {}) {
  const onPodcastToolsChange = vi.fn();
  const props: ComponentProps<typeof RecordingStudio> = {
    defaults,
    detection: {
      cameras: [
        { id: "camera-a", label: "Main Camera", kind: "camera", camera: { connectionType: "usb", signal: "good", maxResolution: "1080p", maxFps: 30 } }
      ],
      microphones: [{ id: "mic-a", label: "Morgan Mic", kind: "microphone" }],
      speakers: [{ id: "speaker-a", label: "Studio Headphones", kind: "speaker" }],
      permissionNeeded: false
    },
    snapshot: {
      status: "idle",
      elapsedMs: 0,
      localSaveMessage: "Everything is saving locally",
      trackStatuses: []
    },
    unfinishedSessions: [],
    podcastTools: createDefaultPodcastToolsState("episode-a", "2026-06-28T12:00:00.000Z"),
    onStart: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onAutoEdit: vi.fn(),
    onExport: vi.fn(),
    onDismissRecovery: vi.fn(),
    onNext: vi.fn(),
    onDefaultsChange: vi.fn(),
    onPodcastToolsChange,
    onPlayTestSound: vi.fn(),
    onOpenCameraPreview: vi.fn(async () => {
      throw new Error("No camera in jsdom");
    }),
    onOpenMicrophoneStream: vi.fn(async () => {
      throw new Error("No mic in jsdom");
    }),
    onReleaseCameraPreview: vi.fn(),
    onReleaseMicrophoneStream: vi.fn(),
    ...overrides
  };

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  act(() => {
    root.render(<RecordingStudio {...props} />);
  });

  return { host, props, root, onPodcastToolsChange };
}

function click(host: HTMLElement, label: string) {
  const button = Array.from(host.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes(label));
  expect(button).toBeTruthy();
  act(() => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("RecordingStudio", () => {
  it("renders the live control room with camera cards and mic meter states", () => {
    const { host } = renderStudio();

    expect(host.textContent).toContain("Live Recording Studio");
    expect(host.textContent).toContain("Camera 1");
    expect(host.textContent).toContain("Live");
    expect(host.textContent).toContain("1080p");
    expect(host.textContent).toContain("30 fps");
    expect(host.textContent).toContain("Morgan Mic");
    expect(host.textContent).toContain("Audio input");
    expect(host.textContent).toContain("Input");
    expect(host.textContent).toContain("Output");
    expect(host.textContent).toContain("We can't hear you yet");
    expect(host.textContent).toContain("Cameras Ready");
    expect(host.textContent).toContain("Microphones Ready");
    expect(host.textContent).toContain("Recording Healthy");
    expect(host.textContent).toContain("Episode");
    expect(host.textContent).toContain("Markers");
  });

  it("keeps camera cards, audio feedback, readiness, and sticky controls in the primary stack", () => {
    const { host } = renderStudio();
    const board = host.querySelector(".live-studio-board");
    const cameraStrip = host.querySelector(".camera-strip");
    const audioDeck = host.querySelector(".live-audio-deck");
    const readiness = host.querySelector(".studio-readiness-strip");
    const controls = host.querySelector(".giant-control-row");
    const tools = host.querySelector(".secondary-studio-tools");

    expect(cameraStrip?.querySelectorAll(".camera-live-card")).toHaveLength(3);
    expect(audioDeck?.textContent).toContain("Morgan Mic");
    expect(readiness?.textContent).toContain("Cameras Ready");
    expect(controls?.textContent).toContain("Record");
    expect(controls?.textContent).toContain("Stop");
    expect(host.textContent).toContain("Studio Ready");
    expect(host.textContent).toContain("Ready to record");

    const stack = Array.from(board?.children ?? []);
    expect(stack.indexOf(cameraStrip as Element)).toBeLessThan(stack.indexOf(audioDeck as Element));
    expect(stack.indexOf(audioDeck as Element)).toBeLessThan(stack.indexOf(readiness as Element));
    expect(stack.indexOf(readiness as Element)).toBeLessThan(stack.indexOf(controls as Element));
    expect(stack.indexOf(controls as Element)).toBeLessThan(stack.indexOf(tools as Element));
  });

  it("toggles per-mic monitoring and plays the test sound", async () => {
    const onPlayTestSound = vi.fn(async () => undefined);
    const { host } = renderStudio({ onPlayTestSound });

    expect(host.textContent).toContain("Monitoring starts Off");
    expect(host.textContent).toContain("Output");
    expect(host.textContent).toContain("Hear Morgan");
    expect(host.textContent).toContain("Off");
    expect(host.textContent).toContain("Use headphones to avoid echo");

    click(host, "Hear Morgan");
    expect(host.textContent).toContain("On");

    await act(async () => {
      click(host, "Play Test Sound");
    });
    expect(onPlayTestSound).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Test sound played");
  });

  it("calls real recording controls for record, pause, resume, and stop", () => {
    const onStart = vi.fn();
    const onPause = vi.fn();
    const onResume = vi.fn();
    const onStop = vi.fn();
    const { host: idleHost } = renderStudio({ onStart });
    click(idleHost, "Record");
    expect(onStart).toHaveBeenCalledTimes(1);

    const { host: recordingHost } = renderStudio({ snapshot: { status: "recording", elapsedMs: 1000, localSaveMessage: "Everything is saving locally", trackStatuses: [] }, onPause, onStop });
    click(recordingHost, "Pause");
    click(recordingHost, "Stop");
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);

    const { host: pausedHost } = renderStudio({ snapshot: { status: "paused", elapsedMs: 1000, localSaveMessage: "Everything is saving locally", trackStatuses: [] }, onResume });
    click(pausedHost, "Resume");
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("saves layout selection, markers, and notes through podcast tools state", () => {
    const { host, onPodcastToolsChange } = renderStudio();

    click(host, "Triple");
    expect(onPodcastToolsChange).toHaveBeenLastCalledWith(expect.objectContaining({ cameraLayout: "triple" }));

    click(host, "Funny");
    expect(onPodcastToolsChange).toHaveBeenLastCalledWith(expect.objectContaining({ markers: [expect.objectContaining({ label: "Funny" })] }));
    expect(host.textContent).toContain("Funny moment saved.");

    const teleprompter = host.querySelector('textarea[aria-label="Teleprompter"]') as HTMLTextAreaElement;
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      valueSetter?.call(teleprompter, "Cold open");
      teleprompter.dispatchEvent(new InputEvent("input", { bubbles: true, data: "Cold open", inputType: "insertText" }));
    });
    expect(onPodcastToolsChange.mock.calls).toContainEqual([
      expect.objectContaining({ teleprompter: expect.objectContaining({ script: "Cold open" }) })
    ]);
  });

  it("makes mixer channel controls tactile and local", () => {
    const onDefaultsChange = vi.fn();
    const { host } = renderStudio({
      onDefaultsChange,
      detection: {
        cameras: [
          { id: "camera-a", label: "Main Camera", kind: "camera", camera: { connectionType: "usb", signal: "good", maxResolution: "1080p", maxFps: 30 } }
        ],
        microphones: [
          { id: "mic-a", label: "Morgan Mic", kind: "microphone" },
          { id: "mic-b", label: "M-Audio Input 2", kind: "microphone" }
        ],
        speakers: [{ id: "speaker-a", label: "Studio Headphones", kind: "speaker" }],
        permissionNeeded: false
      }
    });

    click(host, "Mute");
    expect(host.textContent).toContain("Muted");

    const gain = host.querySelector('input[aria-label="Morgan Mic gain"]') as HTMLInputElement;
    expect(gain).toBeTruthy();
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(gain, "42");
      gain.dispatchEvent(new InputEvent("input", { bubbles: true, data: "42", inputType: "insertText" }));
    });
    expect(gain.value).toBe("42");

    const input = host.querySelector('select[aria-label="Morgan Mic input"]') as HTMLSelectElement;
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      valueSetter?.call(input, "mic-b");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onDefaultsChange).toHaveBeenCalledWith(expect.objectContaining({
      microphones: expect.objectContaining({ morganMic: "mic-b" })
    }));
  });

  it("routes camera audio to Morgan, Guest, or Extra mic slots", () => {
    const onDefaultsChange = vi.fn();
    const { host } = renderStudio({ onDefaultsChange });
    const route = host.querySelector('select[aria-label="Camera 1 audio input"]') as HTMLSelectElement;

    expect(route).toBeTruthy();
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      valueSetter?.call(route, "guestMic");
      route.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onDefaultsChange).toHaveBeenCalledWith(expect.objectContaining({
      cameraMicrophones: expect.objectContaining({ camera1: "guestMic" })
    }));
  });

  it("shows note autosave confidence and teleprompter display controls", () => {
    const { host, onPodcastToolsChange } = renderStudio();

    expect(host.textContent).toContain("Saved");

    const notes = host.querySelector('textarea:not([aria-label="Teleprompter"])') as HTMLTextAreaElement;
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      valueSetter?.call(notes, "Keep intro tight");
      notes.dispatchEvent(new InputEvent("input", { bubbles: true, data: "Keep intro tight", inputType: "insertText" }));
    });
    expect(host.textContent).toContain("Saving...");

    expect((host.querySelector('textarea[aria-label="Teleprompter"]') as HTMLTextAreaElement).className).toContain("dark-mode");

    click(host, "Remote resume");
    expect(onPodcastToolsChange.mock.calls).toContainEqual([
      expect.objectContaining({ teleprompter: expect.objectContaining({ isScrolling: true }) })
    ]);

    click(host, "Hide");
    expect(host.querySelector('textarea[aria-label="Teleprompter"]')).toBeNull();
    expect(host.textContent).toContain("Show");
  });

  it("shows truthful setup states for empty soundboard, Auto Edit, and Export", () => {
    const onAutoEdit = vi.fn();
    const onExport = vi.fn();
    const { host } = renderStudio({ onAutoEdit, onExport });

    click(host, "Intro");
    expect(host.textContent).toContain("Add a sound");

    click(host, "Auto Edit");
    click(host, "Export");
    expect(onAutoEdit).not.toHaveBeenCalled();
    expect(onExport).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Record something first");
  });

  it("renders helpful unavailable states", () => {
    const { host } = renderStudio({
      defaults: { cameras: {}, microphones: {}, audioOutputId: "speaker-a" },
      detection: {
        cameras: [],
        microphones: [],
        speakers: [{ id: "speaker-a", label: "Studio Headphones", kind: "speaker" }],
        permissionNeeded: false
      }
    });

    expect(host.textContent).toContain("Pick a camera first");
    expect(host.textContent).toContain("Pick Morgan Mic");
    expect(host.textContent).toContain("Check the items above");
  });

  it("shows truthful sidecar save states for recorded tracks", () => {
    const { host } = renderStudio({
      defaults: {
        cameras: { camera1: "camera-a", camera2: "camera-b" },
        cameraMicrophones: { camera1: "morganMic", camera2: "guestMic", camera3: "extraMic" },
        microphones: { morganMic: "mic-a", guestMic: "mic-b" },
        audioOutputId: "speaker-a"
      },
      detection: {
        cameras: [
          { id: "camera-a", label: "Main Camera", kind: "camera", camera: { connectionType: "usb", signal: "good", maxResolution: "1080p", maxFps: 30 } },
          { id: "camera-b", label: "Guest Camera", kind: "camera", camera: { connectionType: "usb", signal: "good", maxResolution: "1080p", maxFps: 30 } }
        ],
        microphones: [
          { id: "mic-a", label: "Morgan Mic", kind: "microphone" },
          { id: "mic-b", label: "Guest Mic", kind: "microphone" }
        ],
        speakers: [{ id: "speaker-a", label: "Studio Headphones", kind: "speaker" }],
        permissionNeeded: false
      },
      snapshot: {
        status: "stopped",
        elapsedMs: 30000,
        localSaveMessage: "Everything is saving locally",
        trackStatuses: [
          { slot: "camera1", kind: "camera", status: "saved", filePath: "C:/episode/Cameras/camera-1.webm", message: "Saved" },
          { slot: "camera2", kind: "camera", status: "preview-only", message: "This device can preview but could not save separately" },
          { slot: "guestMic", kind: "audio", status: "needs-attention", message: "This device can preview but could not save separately" }
        ]
      }
    });

    expect(host.textContent).toContain("Saved");
    expect(host.textContent).toContain("Preview only");
    expect(host.textContent).toContain("Needs Attention");
  });

  it("keeps advanced studio tools secondary and collapsed", () => {
    const { host } = renderStudio();
    const tools = host.querySelector(".secondary-studio-tools") as HTMLDetailsElement;

    expect(tools).toBeTruthy();
    expect(tools.open).toBe(false);
    expect(tools.querySelector("summary")?.textContent).toContain("Show notes, markers, teleprompter, and soundboard");
  });

  it("offers pop-out and monitor assignment for major studio panels", () => {
    const onPopOutPanel = vi.fn();
    const { host } = renderStudio({
      displays: [
        { id: 1, label: "Primary monitor", primary: true, bounds: { x: 0, y: 0, width: 1280, height: 720 }, workArea: { x: 0, y: 0, width: 1280, height: 680 }, scaleFactor: 1 },
        { id: 2, label: "Monitor 2", primary: false, bounds: { x: 1280, y: 0, width: 1920, height: 1080 }, workArea: { x: 1280, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 }
      ],
      onPopOutPanel
    });

    click(host, "Move Teleprompter to Monitor 2");
    expect(onPopOutPanel).toHaveBeenCalledWith("teleprompter", 2);
  });

  it("shows pop-out state and returns panels to Studio", () => {
    const onReturnPanel = vi.fn();
    const { host } = renderStudio({
      poppedOutPanels: { soundboard: true },
      onReturnPanel
    });

    expect(host.textContent).toContain("Popped Out");
    click(host, "Return to Studio");
    expect(onReturnPanel).toHaveBeenCalledWith("soundboard");
  });

  it("explains camera settings instead of leaving the gear button dead", () => {
    const { host } = renderStudio();

    const gearButton = host.querySelector('button[aria-label="Camera 1 advanced settings"]');
    expect(gearButton).toBeTruthy();

    act(() => {
      gearButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.textContent).toContain("Camera 1 settings live in Studio Setup");
  });

  it("routes Auto Edit and Export when a session exists", () => {
    const onAutoEdit = vi.fn();
    const onExport = vi.fn();
    const { host } = renderStudio({
      snapshot: {
        status: "stopped",
        elapsedMs: 2000,
        localSaveMessage: "Everything is saving locally",
        trackStatuses: [],
        session: {
          id: "session-a",
          episodeId: "episode-a",
          episodeTitle: "Episode",
          folderPath: "episode/session-a",
          startedAt: "2026-06-28T12:00:00.000Z",
          status: "stopped",
          practice: false
        }
      },
      onAutoEdit,
      onExport
    });

    click(host, "Auto Edit");
    click(host, "Export");
    expect(onAutoEdit).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Review Episode");
  });

  it("keeps the copied reference asset out of the packaged file list", () => {
    const repoRoot = path.resolve(__dirname, "../../../..");
    expect(fs.existsSync(path.join(repoRoot, "assets/references/ui/live-studio-target-reference.png"))).toBe(true);

    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "app/package.json"), "utf8")) as { build: { files: string[] } };
    expect(packageJson.build.files).not.toContain("assets/**/*");
    expect(packageJson.build.files).not.toContain("../assets/**/*");
  });
});
