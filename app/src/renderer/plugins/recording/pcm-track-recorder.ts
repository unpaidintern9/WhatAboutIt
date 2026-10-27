import { MediaClock } from "../../../shared/media-clock";
import { createStudioAudioContext } from "../audio/studio-audio";
const loadedWorklets = new WeakMap<AudioContext, Promise<void>>();

export interface CaptureRecorder extends EventTarget {
  readonly state: RecordingState;
  readonly mimeType: string;
  readonly clockRateRatio?: number;
  readonly sampleFrames?: number;
  readonly timingErrorMs?: number;
  ondataavailable: ((event: BlobEvent) => void) | null;
  start: (timeslice?: number) => void;
  pause: () => void;
  resume: () => void;
  requestData: () => void;
  stop: () => void;
}

/** 24-bit PCM from the browser-visible input; actual device precision is logged separately. */
export class PcmTrackRecorder extends EventTarget implements CaptureRecorder {
  state: RecordingState = "inactive";
  readonly mimeType: string;
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  sampleFrames = 0;
  clockRateRatio = 1;
  private clock = new MediaClock();
  private stopping = false;
  private stopTimer?: number;
  private released = false;
  private startedWallMs = 0;
  private startedContextSeconds = 0;

  get timingErrorMs() {
    if (this.state !== "recording") return 0;
    const elapsed = performance.now() - this.startedWallMs;
    // Read the render clock directly: late renderer/IPC message delivery must
    // not be mistaken for missing audio. Leave time for the start barrier.
    if (elapsed < 10_000) return 0;
    return Math.max(0, elapsed - (this.context.currentTime - this.startedContextSeconds) * 1000);
  }

  private resetTiming() {
    this.startedWallMs = performance.now();
    this.startedContextSeconds = this.context.currentTime;
  }

  private constructor(
    private readonly context: AudioContext,
    private readonly source: AudioNode,
    private readonly node: AudioWorkletNode,
    private readonly silence: GainNode,
    private readonly ownsContext: boolean,
  ) {
    super();
    this.mimeType = `audio/x-pcm;rate=${context.sampleRate};channels=1`;
    node.port.onmessage = ({
      data,
    }: MessageEvent<{
      bytes?: Uint8Array;
      frames?: number;
      stopped?: boolean;
    }>) => {
      if (data.bytes) {
        this.sampleFrames = data.frames ?? this.sampleFrames;
        this.clockRateRatio = this.clock.observe(
          (this.sampleFrames * 1000) / context.sampleRate,
          performance.now(),
        );
        const event = new BlobEvent("dataavailable", {
          data: new Blob([new Uint8Array(data.bytes)], { type: this.mimeType }),
        });
        this.ondataavailable?.(event);
        this.dispatchEvent(event);
      }
      if (data.stopped) {
        this.release();
        this.dispatchEvent(new Event("stop"));
      }
    };
    node.onprocessorerror = () => {
      this.release();
      this.dispatchEvent(new Event("error"));
    };
  }

  static async create(stream: MediaStream, sharedContext?: AudioContext, routedSource?: AudioNode) {
    const context = sharedContext ?? createStudioAudioContext(
      undefined,
      stream.getAudioTracks()[0]?.getSettings?.().sampleRate,
      "playback",
    );
    if (!context.audioWorklet || typeof AudioWorkletNode === "undefined") {
      if (!sharedContext) await context.close();
      throw new Error(
        "Lossless audio capture is unavailable. Update the app before recording.",
      );
    }
    const url = new URL("pcm-capture-worklet.js", document.baseURI).href;
    let source: AudioNode | undefined;
    let node: AudioWorkletNode | undefined;
    let silence: GainNode | undefined;
    try {
      let loading = loadedWorklets.get(context);
      if (!loading) {
        loading = context.audioWorklet.addModule(url).catch((error) => { loadedWorklets.delete(context); throw error; });
        loadedWorklets.set(context, loading);
      }
      await loading;
      // Feed the worklet directly from the interface graph. Routing out through
      // a MediaStream and back into the same context adds a second clock buffer.
      source = routedSource ?? context.createMediaStreamSource(stream);
      node = new AudioWorkletNode(context, "wai-pcm-capture", {
        channelCount: 1,
        channelCountMode: "explicit",
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      silence = context.createGain();
      silence.gain.value = 0;
      source.connect(node).connect(silence).connect(context.destination);
      await context.resume();
      return new PcmTrackRecorder(context, source, node, silence, !sharedContext);
    } catch (error) {
      if (source && node) source.disconnect(node);
      node?.disconnect();
      node?.port.close();
      silence?.disconnect();
      if (!sharedContext) await context.close();
      throw error;
    }
  }
  start() {
    this.resetTiming();
    this.state = "recording";
    this.node.port.postMessage("start");
  }
  pause() {
    this.state = "paused";
    this.node.port.postMessage("pause");
  }
  resume() {
    this.resetTiming();
    this.clock = new MediaClock();
    this.state = "recording";
    this.node.port.postMessage("resume");
  }
  requestData() {
    this.node.port.postMessage("flush");
  }
  stop() {
    if (this.stopping || this.state === "inactive") return;
    this.stopping = true;
    this.stopTimer = window.setTimeout(() => {
      this.release();
      this.dispatchEvent(new Event("error"));
    }, 4500);
    this.node.port.postMessage("stop");
  }
  private release() {
    if (this.released) return;
    this.released = true;
    this.state = "inactive";
    window.clearTimeout(this.stopTimer);
    this.source.disconnect(this.node);
    this.node.disconnect();
    this.node.port.close();
    this.silence.disconnect();
    if (this.ownsContext) void this.context.close();
  }
}
