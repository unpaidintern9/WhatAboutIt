import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserMediaRecorderPlugin } from "./browser-media-recorder-plugin";
import type { RecordingChunkInput } from "../../../shared/recording";

class FakeTrack {
  readyState: MediaStreamTrackState = "live";

  constructor(readonly kind: "audio" | "video", readonly id: string) {}

  clone() {
    return new FakeTrack(this.kind, `${this.id}-clone`) as unknown as MediaStreamTrack;
  }

  stop() {
    this.readyState = "ended";
  }

  getSettings() {
    return this.kind === "audio" ? { channelCount: 2, sampleRate: 48000 } : {};
  }
}

class FakeMediaStream {
  constructor(private readonly tracks: MediaStreamTrack[] = []) {}

  getTracks() {
    return this.tracks;
  }

  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === "video");
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }
}

class FakeMediaRecorder extends EventTarget {
  static streams: MediaStream[] = [];
  static emitData = true;
  static emitStop = true;

  static isTypeSupported() {
    return true;
  }

  state: RecordingState = "inactive";
  mimeType: string;
  ondataavailable: ((event: BlobEvent) => void) | null = null;

  constructor(stream: MediaStream, options?: MediaRecorderOptions) {
    super();
    FakeMediaRecorder.streams.push(stream);
    this.mimeType = options?.mimeType ?? "video/webm";
  }

  start() {
    this.state = "recording";
    if (FakeMediaRecorder.emitData) this.ondataavailable?.({ data: new Blob(["recorded"], { type: this.mimeType }) } as BlobEvent);
  }

  pause() {
    this.state = "paused";
  }

  resume() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    if (FakeMediaRecorder.emitStop) this.dispatchEvent(new Event("stop"));
  }
}

class FakeAudioNode {
  connect(destination?: FakeAudioNode) {
    return destination ?? this;
  }

  disconnect() {
    return undefined;
  }
}

class FakeAudioContext {
  destination = new FakeAudioNode();

  createGain() {
    return Object.assign(new FakeAudioNode(), { gain: { value: 1 } });
  }

  createOscillator() {
    return Object.assign(new FakeAudioNode(), { start: vi.fn(), stop: vi.fn() });
  }

  createChannelSplitter() {
    return new FakeAudioNode();
  }

  createMediaStreamSource() {
    return new FakeAudioNode();
  }

  createMediaStreamDestination() {
    return Object.assign(new FakeAudioNode(), {
      stream: streamWith(new FakeTrack("audio", "program-audio-bridge"))
    });
  }

  async resume() {
    return undefined;
  }

  async close() {
    return undefined;
  }
}

function streamWith(track: FakeTrack) {
  return new FakeMediaStream([track as unknown as MediaStreamTrack]) as unknown as MediaStream;
}

describe("BrowserMediaRecorderPlugin", () => {
  beforeEach(() => {
    FakeMediaRecorder.streams = [];
    FakeMediaRecorder.emitData = true;
    FakeMediaRecorder.emitStop = true;
    vi.stubGlobal("MediaStream", FakeMediaStream);
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    Reflect.deleteProperty(window, "studio");
  });

  it("records every already-live selected camera without reopening the camera devices", async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia }
    });
    const activeStreams = {
      camera1: streamWith(new FakeTrack("video", "camera-1")),
      camera2: streamWith(new FakeTrack("video", "camera-2")),
      camera3: streamWith(new FakeTrack("video", "camera-3")),
      morganMic: streamWith(new FakeTrack("audio", "morgan-mic"))
    };
    const plugin = new BrowserMediaRecorderPlugin({
      getCameraStream: (deviceId) => {
        if (deviceId === "camera-a") return activeStreams.camera1;
        if (deviceId === "camera-b") return activeStreams.camera2;
        if (deviceId === "camera-c") return activeStreams.camera3;
        return undefined;
      },
      getMicrophoneStream: (deviceId) => deviceId === "mic-a" ? activeStreams.morganMic : undefined
    });

    await plugin.start({
      deviceDefaults: {
        cameras: { camera1: "camera-a", camera2: "camera-b", camera3: "camera-c" },
        cameraMicrophones: { camera1: "morganMic", camera2: "guestMic", camera3: "extraMic" },
        microphones: { morganMic: "mic-a" }
      }
    });
    expect(plugin.getHealth()).toMatchObject({
      programActive: true,
      activeCameraTracks: 3,
      activeAudioTracks: 1,
      expectedCameraTracks: 3,
      expectedAudioTracks: 1,
      warnings: []
    });
    const isolatedCameraStreams = FakeMediaRecorder.streams.slice(1).filter((stream) => stream.getVideoTracks().length > 0);
    expect(isolatedCameraStreams).toHaveLength(3);
    expect(isolatedCameraStreams.every((stream) => stream.getAudioTracks().length === 1)).toBe(true);
    const result = await plugin.stop();

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.bytes?.length).toBeGreaterThan(0);
    expect(result.tracks).toEqual(expect.arrayContaining([
      expect.objectContaining({ slot: "camera1", kind: "camera" }),
      expect.objectContaining({ slot: "camera2", kind: "camera" }),
      expect.objectContaining({ slot: "camera3", kind: "camera" }),
      expect.objectContaining({ slot: "morganMic", kind: "audio" })
    ]));
  });

  it("marks a selected source unhealthy when its first media chunk never arrives", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T12:00:00.000Z"));
    FakeMediaRecorder.emitData = false;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() }
    });
    const plugin = new BrowserMediaRecorderPlugin({
      getCameraStream: () => streamWith(new FakeTrack("video", "camera-1")),
      getMicrophoneStream: () => streamWith(new FakeTrack("audio", "mic-1"))
    });

    await plugin.start({
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } }
    });
    expect(plugin.getHealth().sources.every((source) => source.active && !source.firstChunkReceived)).toBe(true);

    await vi.advanceTimersByTimeAsync(8001);
    expect(plugin.getHealth().sources.every((source) => !source.active && source.message === "No media data was written")).toBe(true);
    await plugin.stop();
  });

  it("uses the camera one mic route for the program recording", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() }
    });
    const getMicrophoneStream = vi.fn((deviceId?: string) =>
      deviceId === "guest-input" ? streamWith(new FakeTrack("audio", "guest-input")) : undefined
    );
    const plugin = new BrowserMediaRecorderPlugin({
      getCameraStream: () => streamWith(new FakeTrack("video", "camera-1")),
      getMicrophoneStream
    });

    await plugin.start({
      deviceDefaults: {
        cameras: { camera1: "camera-a" },
        cameraMicrophones: { camera1: "guestMic" },
        microphones: { morganMic: "morgan-input", guestMic: "guest-input" }
      }
    });
    await plugin.stop();

    expect(getMicrophoneStream).toHaveBeenCalledWith("guest-input");
  });

  it("starts a recoverable Program video when an optional microphone cannot open", async () => {
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      if (constraints.audio) throw new DOMException("Microphone unavailable", "NotReadableError");
      return streamWith(new FakeTrack("video", "fallback-camera"));
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia }
    });
    const plugin = new BrowserMediaRecorderPlugin({
      getCameraStream: () => streamWith(new FakeTrack("video", "camera-1")),
      getMicrophoneStream: () => undefined
    });

    await plugin.start({
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } }
    });

    expect(plugin.getHealth()).toMatchObject({
      programActive: true,
      activeCameraTracks: 1,
      activeAudioTracks: 0,
      expectedAudioTracks: 1
    });
    expect(plugin.getHealth().warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("Program video started immediately")
    ]));
    const result = await plugin.stop();
    expect(result.bytes?.length).toBeGreaterThan(0);
  });

  it("does not wait for a sleeping optional microphone before reporting Program recording active", async () => {
    let resolveMicrophone: ((stream: MediaStream) => void) | undefined;
    const lateMicrophone = streamWith(new FakeTrack("audio", "late-mic"));
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => {
      resolveMicrophone = resolve;
    }));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia }
    });
    const plugin = new BrowserMediaRecorderPlugin({
      getCameraStream: () => streamWith(new FakeTrack("video", "camera-1")),
      getMicrophoneStream: () => undefined
    });

    await plugin.start({
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } }
    });

    expect(plugin.getHealth().programActive).toBe(true);
    expect(getUserMedia).toHaveBeenCalled();
    await plugin.stop();
    resolveMicrophone?.(lateMicrophone);
    await vi.waitFor(() => expect(lateMicrophone.getTracks()[0]?.readyState).toBe("ended"));
  });

  it("starts the Program with an audio track immediately and attaches a late host mic without delaying Record", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const hostMic = streamWith(new FakeTrack("audio", "late-host-mic"));
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      if (constraints.audio) return hostMic;
      return streamWith(new FakeTrack("video", "fallback-camera"));
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia }
    });
    const plugin = new BrowserMediaRecorderPlugin({
      getCameraStream: () => streamWith(new FakeTrack("video", "camera-1")),
      getMicrophoneStream: () => undefined
    });

    await plugin.start({
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } }
    });

    expect(FakeMediaRecorder.streams[0]?.getAudioTracks()).toHaveLength(1);
    expect(plugin.getHealth().programActive).toBe(true);
    await vi.waitFor(() => expect(plugin.getHealth().activeAudioTracks).toBe(1));
    expect(plugin.getHealth().warnings.join(" ")).not.toContain("connecting in the background");
    await plugin.stop();
  });

  it("keeps a silent audio carrier in a video-only Program so review and export remain playable", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() }
    });
    const plugin = new BrowserMediaRecorderPlugin({
      getCameraStream: () => streamWith(new FakeTrack("video", "camera-1"))
    });

    await plugin.start({ deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: {} } });

    expect(FakeMediaRecorder.streams[0]?.getVideoTracks()).toHaveLength(1);
    expect(FakeMediaRecorder.streams[0]?.getAudioTracks()).toHaveLength(1);
    expect(plugin.getHealth().programActive).toBe(true);
    await plugin.stop();
  });

  it("streams program and source chunks to disk instead of retaining the episode in renderer memory", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() }
    });
    const beginRecordingMedia = vi.fn(async () => undefined);
    const appendRecordingChunk = vi.fn(async (_folderPath: string, chunk: RecordingChunkInput) => ({
      bytesWritten: chunk.bytes.length,
      lastChunkAt: "2026-08-15T12:00:00.000Z"
    }));
    Object.defineProperty(window, "studio", {
      configurable: true,
      value: { beginRecordingMedia, appendRecordingChunk }
    });
    const plugin = new BrowserMediaRecorderPlugin({
      getCameraStream: () => streamWith(new FakeTrack("video", "camera-1")),
      getMicrophoneStream: () => streamWith(new FakeTrack("audio", "mic-1"))
    });

    await plugin.start({
      session: {
        id: "session-disk",
        episodeId: "episode-disk",
        episodeTitle: "Disk First",
        folderPath: "C:/recording/episode-disk",
        startedAt: "2026-08-15T12:00:00.000Z",
        status: "recording",
        practice: false
      },
      deviceDefaults: {
        cameras: { camera1: "camera-a" },
        microphones: { morganMic: "mic-a" }
      }
    });
    const result = await plugin.stop();

    expect(beginRecordingMedia).toHaveBeenCalledWith("C:/recording/episode-disk");
    expect(appendRecordingChunk.mock.calls.map((call) => call[1].target)).toEqual(expect.arrayContaining(["program", "camera1", "morganMic"]));
    const sourceStarts = new Set(appendRecordingChunk.mock.calls.map((call) => call[1].sourceStartedAt));
    expect(sourceStarts.size).toBe(1);
    expect([...sourceStarts][0]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.persisted).toBe(true);
    expect(result.bytes).toBeUndefined();
  });

  it("does not block the Program recording when optional source routes are duplicated", async () => {
    const getUserMedia = vi.fn(async () => {
      throw new DOMException("Optional source unavailable", "NotReadableError");
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia }
    });
    const plugin = new BrowserMediaRecorderPlugin({
      getCameraStream: () => streamWith(new FakeTrack("video", "sony-a"))
    });

    await plugin.start({
      deviceDefaults: {
        cameras: { camera1: "sony-a", camera2: "sony-a" },
        microphones: { morganMic: "audiobox", guestMic: "audiobox" },
        microphoneChannels: { morganMic: "input-1", guestMic: "input-1" }
      }
    });
    expect(plugin.getHealth().programActive).toBe(true);
    const result = await plugin.stop();
    expect(result.bytes?.length).toBeGreaterThan(0);
  });

  it("finishes Stop after a bounded wait when Chromium never emits recorder stop events", async () => {
    vi.useFakeTimers();
    FakeMediaRecorder.emitStop = false;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() }
    });
    const plugin = new BrowserMediaRecorderPlugin({
      getCameraStream: () => streamWith(new FakeTrack("video", "camera-1")),
      getMicrophoneStream: () => streamWith(new FakeTrack("audio", "mic-1"))
    });
    await plugin.start({
      deviceDefaults: { cameras: { camera1: "camera-a" }, microphones: { morganMic: "mic-a" } }
    });

    const stopping = plugin.stop();
    await vi.advanceTimersByTimeAsync(5001);

    await expect(stopping).resolves.toMatchObject({ bytes: expect.any(Uint8Array) });
  });
});
