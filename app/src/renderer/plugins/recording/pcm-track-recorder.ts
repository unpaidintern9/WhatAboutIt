import { MediaClock } from "../../../shared/media-clock";
import { createStudioAudioContext } from "../audio/studio-audio";

export interface CaptureRecorder extends EventTarget {
  readonly state: RecordingState;
  readonly mimeType: string;
  readonly clockRateRatio?: number;
  readonly sampleFrames?: number;
  ondataavailable: ((event: BlobEvent) => void) | null;
  start: (timeslice?: number) => void;
  pause: () => void;
  resume: () => void;
  requestData: () => void;
  stop: () => void;
}

// Runs on the audio rendering thread. Transfer buffers, never copy a whole session.
export const pcmWorkletSource = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.active = false; this.used = 0; this.frames = 0;
    this.bytes = new Uint8Array(Math.round(sampleRate) * 3);
    this.port.onmessage = ({data}) => {
      if (data === 'start' || data === 'resume') this.active = true;
      if (data === 'pause') { this.active = false; this.flush(); }
      if (data === 'flush') this.flush();
      if (data === 'stop') { this.active = false; this.flush(); this.port.postMessage({stopped: true}); }
    };
  }
  flush() {
    if (!this.used) return;
    const bytes = this.bytes.slice(0, this.used);
    this.port.postMessage({bytes, frames: this.frames}, [bytes.buffer]); this.used = 0;
  }
  process(inputs) {
    const samples = inputs[0] && inputs[0][0];
    if (!this.active || !samples) return true;
    for (const value of samples) {
      const sample = Math.max(-8388608, Math.min(8388607, Math.round(value * 8388608)));
      this.bytes[this.used++] = sample & 255;
      this.bytes[this.used++] = (sample >> 8) & 255;
      this.bytes[this.used++] = (sample >> 16) & 255;
      this.frames++;
      if (this.used === this.bytes.length) this.flush();
    }
    return true;
  }
}
registerProcessor('wai-pcm-capture', PcmCapture);
`;

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

  private constructor(
    private readonly context: AudioContext,
    private readonly source: MediaStreamAudioSourceNode,
    private readonly node: AudioWorkletNode,
    private readonly silence: GainNode,
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

  static async create(stream: MediaStream) {
    const context = createStudioAudioContext(
      undefined,
      stream.getAudioTracks()[0]?.getSettings?.().sampleRate,
    );
    if (!context.audioWorklet || typeof AudioWorkletNode === "undefined") {
      await context.close();
      throw new Error(
        "Lossless audio capture is unavailable. Update the app before recording.",
      );
    }
    const url = URL.createObjectURL(
      new Blob([pcmWorkletSource], { type: "text/javascript" }),
    );
    try {
      await context.audioWorklet.addModule(url);
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, "wai-pcm-capture", {
        channelCount: 1,
        channelCountMode: "explicit",
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const silence = context.createGain();
      silence.gain.value = 0;
      source.connect(node).connect(silence).connect(context.destination);
      await context.resume();
      return new PcmTrackRecorder(context, source, node, silence);
    } catch (error) {
      await context.close();
      throw error;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  start() {
    this.state = "recording";
    this.node.port.postMessage("start");
  }
  pause() {
    this.state = "paused";
    this.node.port.postMessage("pause");
  }
  resume() {
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
    this.source.disconnect();
    this.node.disconnect();
    this.node.port.close();
    this.silence.disconnect();
    void this.context.close();
  }
}
