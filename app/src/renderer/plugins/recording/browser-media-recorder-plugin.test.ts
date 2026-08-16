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
  static isTypeSupported() {
    return true;
  }

  state: RecordingState = "inactive";
  mimeType: string;
  ondataavailable: ((event: BlobEvent) => void) | null = null;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    super();
    this.mimeType = options?.mimeType ?? "video/webm";
  }

  start() {
    this.state = "recording";
    this.ondataavailable?.({ data: new Blob(["recorded"], { type: this.mimeType }) } as BlobEvent);
  }

  pause() {
    this.state = "paused";
  }

  resume() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.dispatchEvent(new Event("stop"));
  }
}

function streamWith(track: FakeTrack) {
  return new FakeMediaStream([track as unknown as MediaStreamTrack]) as unknown as MediaStream;
}

describe("BrowserMediaRecorderPlugin", () => {
  beforeEach(() => {
    vi.stubGlobal("MediaStream", FakeMediaStream);
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
    expect(result.persisted).toBe(true);
    expect(result.bytes).toBeUndefined();
  });

  it("blocks recording when the same physical source route is assigned twice", async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia }
    });
    const plugin = new BrowserMediaRecorderPlugin();

    await expect(plugin.start({
      deviceDefaults: {
        cameras: { camera1: "sony-a", camera2: "sony-a" },
        microphones: { morganMic: "audiobox", guestMic: "audiobox" },
        microphoneChannels: { morganMic: "input-1", guestMic: "input-1" }
      }
    })).rejects.toThrow("Source routing needs attention");
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
