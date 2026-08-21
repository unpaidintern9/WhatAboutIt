import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { createDefaultPodcastToolsState } from "../../shared/podcast-tools";
import type { DeviceDefaults } from "../../shared/types";
import { defaultRecordingPreferences } from "../../shared/types";
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
    recordingPreferences: { ...defaultRecordingPreferences, countdownSeconds: 0 },
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

    expect(host.textContent).toContain("CAM 1");
    expect(host.textContent).toContain("MORGAN");
    expect(host.textContent).toContain("View Layouts");
    expect(host.textContent).toContain("Morgan Mic");
    expect(host.textContent).toContain("Audio input");
    expect(host.textContent).toContain("Input");
    expect(host.textContent).toContain("Output");
    expect(host.textContent).toContain("Voice Polish");
    expect(host.textContent).toContain("Warm Podcast");
    expect(host.textContent).toContain("CHECKING");
    expect(host.textContent).toContain("Audio Diagnostics");
    expect(host.textContent).toContain("Cameras Ready");
    expect(host.textContent).toContain("Microphones Ready");
    expect(host.textContent).toContain("Recording Healthy");
    expect(host.textContent).toContain("Episode");
    expect(host.textContent).toContain("Markers");
  });

  it("keeps camera cards, audio feedback, notes, markers, and controls in the compact command center", () => {
    const { host } = renderStudio();
    const workbench = host.querySelector(".reference-workbench");
    const mainColumn = host.querySelector(".reference-main-column");
    const sideStack = host.querySelector(".studio-side-stack");
    const cameraStrip = host.querySelector(".camera-strip");
    const audioDeck = host.querySelector(".live-audio-deck");
    const soundboard = host.querySelector(".compact-soundboard-panel");
    const markers = host.querySelector(".compact-markers-panel");
    const controls = host.querySelector(".giant-control-row");
    const tools = host.querySelector(".secondary-studio-tools");

    expect(workbench).toBeTruthy();
    expect(mainColumn?.contains(cameraStrip)).toBe(true);
    expect(mainColumn?.contains(audioDeck)).toBe(true);
    expect(mainColumn?.contains(controls)).toBe(true);
    expect(cameraStrip).toBeTruthy();
    expect(audioDeck).toBeTruthy();
    expect(controls).toBeTruthy();
    expect((cameraStrip as Element).compareDocumentPosition(controls as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((controls as Element).compareDocumentPosition(audioDeck as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sideStack?.textContent).toContain("Episode Notes");
    expect(sideStack?.textContent).toContain("Teleprompter");
    expect(cameraStrip?.querySelectorAll(".camera-live-card")).toHaveLength(3);
    expect(audioDeck?.textContent).toContain("Morgan Mic");
    expect(soundboard?.textContent).toContain("Add Sound");
    expect(markers?.textContent).toContain("Funny");
    expect(controls?.textContent).toContain("Record");
    expect(controls?.textContent).toContain("Stop");
    expect(host.textContent).toContain("Studio Ready");
    expect(host.textContent).toContain("Ready to record");
    expect(tools?.querySelector("summary")?.textContent).toContain("Show notes, markers, teleprompter, and soundboard");
  });

  it("toggles per-mic monitoring and plays the test sound", async () => {
    const onPlayTestSound = vi.fn(async () => undefined);
    const { host } = renderStudio({ onPlayTestSound });

    expect(host.textContent).toContain("Direct software monitor");
    expect(host.textContent).toContain("Hardware direct monitoring is zero-delay");
    expect(host.textContent).toContain("Output");
    expect(host.textContent).toContain("Hear Morgan");
    expect(host.textContent).toContain("Off");
    expect(host.textContent).toContain("Use headphones to avoid echo");

    click(host, "Hear Off");
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
    click(idleHost, "Record Full Episode");
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

  it("shows honest starting and saving states while recorder work is pending", async () => {
    let finishStart: (() => void) | undefined;
    let finishStop: (() => void) | undefined;
    const onStart = vi.fn(() => new Promise<void>((resolve) => { finishStart = resolve; }));
    const onStop = vi.fn(() => new Promise<void>((resolve) => { finishStop = resolve; }));
    const { host: idleHost } = renderStudio({ onStart });

    click(idleHost, "Record Full Episode");
    expect(idleHost.textContent).toContain("Starting the Program recording now");
    expect(idleHost.textContent).toContain("Starting");
    await act(async () => finishStart?.());

    const { host: recordingHost } = renderStudio({
      snapshot: { status: "recording", elapsedMs: 1000, localSaveMessage: "Everything is saving locally", trackStatuses: [] },
      onStop
    });
    click(recordingHost, "Stop");
    expect(recordingHost.textContent).toContain("Verifying the program, each camera, each microphone, and the optional backup copy");
    expect(recordingHost.textContent).toContain("Saving");
    await act(async () => finishStop?.());
  });

  it("allows a full recording retry after a failed attempt and shows the returned failure", async () => {
    const failedSnapshot = {
      status: "error" as const,
      elapsedMs: 0,
      localSaveMessage: "Ready to save directly to this computer",
      trackStatuses: [],
      friendlyError: "The camera did not start."
    };
    const onStart = vi.fn(async () => failedSnapshot);
    const { host } = renderStudio({ snapshot: failedSnapshot, onStart });
    const recordButton = Array.from(host.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes("Record Full Episode")) as HTMLButtonElement;

    expect(recordButton.disabled).toBe(false);
    expect(host.textContent).toContain("Recording Needs Attention");
    await act(async () => click(host, "Record Full Episode"));

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("The camera did not start.");
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

    const gain = host.querySelector('input[aria-label="Morgan Mic headphone monitoring level"]') as HTMLInputElement;
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
      cameraMicrophones: expect.objectContaining({ camera1: "guestMic", camera2: "morganMic" })
    }));
    expect(host.textContent).toContain("Guest Mic moved to Camera 1");
  });

  it("splits one multichannel interface into distinct physical input routes", () => {
    const onDefaultsChange = vi.fn();
    const { host } = renderStudio({
      onDefaultsChange,
      defaults: {
        cameras: { camera1: "camera-a" },
        cameraMicrophones: { camera1: "morganMic", camera2: "guestMic", camera3: "extraMic" },
        microphones: { morganMic: "mic-a", guestMic: "mic-b" },
        audioOutputId: "speaker-a"
      },
      detection: {
        cameras: [
          { id: "camera-a", label: "Main Camera", kind: "camera", camera: { connectionType: "usb", signal: "good", maxResolution: "1080p", maxFps: 30 } }
        ],
        microphones: [
          { id: "mic-a", label: "Morgan Mic", kind: "microphone" },
          { id: "mic-b", label: "M-Audio Box Input 2", kind: "microphone" }
        ],
        speakers: [{ id: "speaker-a", label: "Studio Headphones", kind: "speaker" }],
        permissionNeeded: false
      }
    });

    const input = host.querySelector('select[aria-label="Morgan Mic input"]') as HTMLSelectElement;
    expect(input.textContent).toContain("M-Audio Box Input 2 - choose another input channel");

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      valueSetter?.call(input, "mic-b");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onDefaultsChange).toHaveBeenCalledWith(expect.objectContaining({
      microphones: expect.objectContaining({ morganMic: "mic-b", guestMic: "mic-b" }),
      microphoneChannels: expect.objectContaining({ guestMic: "input-1", morganMic: "input-2" })
    }));
    expect(host.textContent).toContain("inputs were assigned to separate mixer channels");
  });

  it("does not reopen the mic stream when mixer controls change", async () => {
    const OriginalAudioContext = window.AudioContext;
    const audioParam = (value = 0) => ({ value, setTargetAtTime: vi.fn() });
    const node = () => ({
      channelCount: 2,
      channelCountMode: "max" as ChannelCountMode,
      channelInterpretation: "speakers" as ChannelInterpretation,
      gain: audioParam(1),
      connect: vi.fn(),
      disconnect: vi.fn()
    });
    class TestAudioContext {
      static instances = 0;
      destination = node();
      currentTime = 0;

      constructor() {
        TestAudioContext.instances += 1;
      }

      createAnalyser() {
        return {
          frequencyBinCount: 8,
          getByteTimeDomainData: (samples: Uint8Array) => samples.fill(130),
          connect: vi.fn(),
          disconnect: vi.fn()
        };
      }
      createMediaStreamSource() {
        return node();
      }
      createChannelSplitter() {
        return node();
      }
      createGain() {
        return node();
      }
      createBiquadFilter() {
        return { ...node(), type: "lowpass", frequency: audioParam(), Q: audioParam(), gain: audioParam() };
      }
      createDynamicsCompressor() {
        return {
          ...node(),
          threshold: audioParam(),
          knee: audioParam(),
          ratio: audioParam(),
          attack: audioParam(),
          release: audioParam()
        };
      }
      setSinkId = vi.fn(async () => undefined);
      resume = vi.fn(async () => undefined);
      close = vi.fn(async () => undefined);
    }
    Object.defineProperty(window, "AudioContext", { configurable: true, writable: true, value: TestAudioContext });

    const stream = {
      getTracks: () => [{ stop: vi.fn(), readyState: "live" }],
      getAudioTracks: () => [{ stop: vi.fn(), readyState: "live" }]
    } as unknown as MediaStream;
    const onOpenMicrophoneStream = vi.fn(async () => stream);
    const { host, root } = renderStudio({ onOpenMicrophoneStream });

    await act(async () => {
      await Promise.resolve();
    });
    expect(onOpenMicrophoneStream).toHaveBeenCalledTimes(1);
    expect(TestAudioContext.instances).toBe(1);

    click(host, "Hear Off");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(TestAudioContext.instances).toBe(2);

    const gain = host.querySelector('input[aria-label="Morgan Mic headphone monitoring level"]') as HTMLInputElement;
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(gain, "52");
      gain.dispatchEvent(new InputEvent("input", { bubbles: true, data: "52", inputType: "insertText" }));
    });

    const polish = host.querySelector('select[aria-label="Morgan Mic voice polish"]') as HTMLSelectElement;
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      valueSetter?.call(polish, "broadcast");
      polish.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(onOpenMicrophoneStream).toHaveBeenCalledTimes(1);
    expect(TestAudioContext.instances).toBe(2);

    act(() => root.unmount());
    Object.defineProperty(window, "AudioContext", { configurable: true, writable: true, value: OriginalAudioContext });
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

    click(host, "A+");
    expect(onPodcastToolsChange.mock.calls).toContainEqual([
      expect.objectContaining({ teleprompter: expect.objectContaining({ fontSize: 36 }) })
    ]);
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
    expect(host.textContent).toContain("Video-only is ready; mics are optional");
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

  it("starts recording in one click without a preflight, countdown, or drive picker", () => {
    const onStart = vi.fn();
    const { host } = renderStudio({
      onStart,
      defaults: { cameras: { camera1: "camera-a" }, microphones: {} },
      detection: {
        cameras: [
          { id: "camera-a", label: "Main Camera", kind: "camera", camera: { connectionType: "usb", signal: "good", maxResolution: "1080p", maxFps: 30 } }
        ],
        microphones: [],
        speakers: [],
        permissionNeeded: false
      },
      recordingPreferences: { ...defaultRecordingPreferences, countdownSeconds: 3 }
    });

    click(host, "Record Full Episode");
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("Ready to record?");
    expect(host.textContent).not.toContain("Countdown");
    expect(host.textContent).not.toContain("Choose Primary Drive");
    expect(host.textContent).not.toContain("Choose Backup Drive");
  });

  it("keeps storage automatic even when an older setup saved a custom path", () => {
    const onStart = vi.fn();
    const { host } = renderStudio({
      recordingPreferences: { ...defaultRecordingPreferences, countdownSeconds: 0, primaryFolderPath: "D:/What About It Recordings" },
      onStart
    });

    click(host, "Record Full Episode");
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("D:/What About It Recordings");
    expect(host.textContent).not.toContain("Choose Primary Drive");
  });

  it("protects a long episode from an accidental stop", () => {
    const onStop = vi.fn();
    const { host } = renderStudio({
      snapshot: { status: "recording", elapsedMs: 60000, localSaveMessage: "Writing to disk", trackStatuses: [] },
      onStop
    });

    click(host, "Stop");
    expect(host.textContent).toContain("Stop this episode?");
    expect(onStop).not.toHaveBeenCalled();
    click(host, "Stop & Verify Files");
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("offers one-click recovery and session-folder access for interrupted media", async () => {
    const session = {
      id: "interrupted-session",
      episodeId: "episode-recovery",
      episodeTitle: "Recovery Episode",
      folderPath: "C:/episodes/recovery",
      startedAt: "2026-08-15T12:00:00.000Z",
      status: "interrupted" as const,
      practice: false,
      recoverableBytes: 12 * 1024 * 1024
    };
    const onRecoverSession = vi.fn(async () => undefined);
    const onOpenSessionFolder = vi.fn();
    const { host } = renderStudio({ unfinishedSessions: [session], onRecoverSession, onOpenSessionFolder });

    expect(host.textContent).toContain("12 MB protected");
    await act(async () => click(host, "Recover Recording"));
    expect(onRecoverSession).toHaveBeenCalledWith(session);
    click(host, "Open Folder");
    expect(onOpenSessionFolder).toHaveBeenCalledWith(session);
  });

  it("keeps the copied reference asset out of the packaged file list", () => {
    const repoRoot = path.resolve(__dirname, "../../../..");
    expect(fs.existsSync(path.join(repoRoot, "assets/references/ui/live-studio-target-reference.png"))).toBe(true);

    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "app/package.json"), "utf8")) as { build: { files: string[] } };
    expect(packageJson.build.files).not.toContain("assets/**/*");
    expect(packageJson.build.files).not.toContain("../assets/**/*");
  });
});
