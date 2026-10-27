import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { PcmTrackRecorder } from "./pcm-track-recorder";
import fs from "node:fs";
import path from "node:path";
const pcmWorkletSource = fs.readFileSync(
  path.join(process.cwd(), "public", "pcm-capture-worklet.js"),
  "utf8",
);

describe("lossless audio rendering-thread capture", () => {
  it("shares the interface context and worklet module without closing other live channels", async () => {
    const nodes: Array<{ port: { onmessage?: (event: { data: { stopped: boolean } }) => void } }> = [];
    const audioNode = () => ({ connect(next: unknown) { return next; }, disconnect: vi.fn() });
    const close = vi.fn(async () => undefined);
    const addModule = vi.fn(async () => undefined);
    const context = { sampleRate: 48000, audioWorklet: { addModule }, createMediaStreamSource: () => audioNode(), createGain: () => ({ ...audioNode(), gain: { value: 1 } }), resume: async () => undefined, close, destination: audioNode() } as unknown as AudioContext;
    vi.stubGlobal("AudioWorkletNode", class {
      port = { onmessage: undefined as ((event: { data: { stopped: boolean } }) => void) | undefined, postMessage: vi.fn(), close: vi.fn() };
      constructor() { nodes.push(this); }
      connect(next: unknown) { return next; }
      disconnect() {}
    });
    try {
      const input = { getAudioTracks: () => [] } as unknown as MediaStream;
      const first = await PcmTrackRecorder.create(input, context);
      const second = await PcmTrackRecorder.create(input, context);
      first.start(); second.start(); first.stop();
      nodes[0].port.onmessage?.({ data: { stopped: true } });
      expect(first.state).toBe("inactive");
      expect(second.state).toBe("recording");
      expect(addModule).toHaveBeenCalledTimes(1);
      expect(close).not.toHaveBeenCalled();
      second.stop(); nodes[1].port.onmessage?.({ data: { stopped: true } });
    } finally { vi.unstubAllGlobals(); }
  });
  it("uses the routed node directly and detects render-clock loss without mistaking message backlog for drift", async () => {
    const disconnect = vi.fn();
    const route = { connect(next: unknown) { return next; }, disconnect } as unknown as AudioNode;
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    const context = { currentTime: 5, sampleRate: 48000, audioWorklet: { addModule: async () => undefined }, createMediaStreamSource: vi.fn(), createGain: () => ({ connect(next: unknown) { return next; }, disconnect: vi.fn(), gain: { value: 1 } }), resume: async () => undefined, destination: {} } as unknown as AudioContext;
    const nodes: Array<{ port: { onmessage?: (event: { data: { stopped: boolean } }) => void } }> = [];
    vi.stubGlobal("AudioWorkletNode", class {
      port = { onmessage: undefined, postMessage: vi.fn(), close: vi.fn() };
      constructor() { nodes.push(this); }
      connect(next: unknown) { return next; }
      disconnect() {}
    });
    try {
      const capture = await PcmTrackRecorder.create({ getAudioTracks: () => [] } as unknown as MediaStream, context, route);
      capture.start();
      now.mockReturnValue(21_000);
      Object.assign(context, { currentTime: 25 });
      expect(capture.timingErrorMs).toBe(0); // No worklet messages delivered, audio itself kept up.
      Object.assign(context, { currentTime: 23 });
      expect(capture.timingErrorMs).toBe(2000);
      capture.pause(); expect(capture.timingErrorMs).toBe(0);
      capture.resume(); expect(capture.timingErrorMs).toBe(0);
      capture.stop(); nodes[0].port.onmessage?.({ data: { stopped: true } });
      expect(context.createMediaStreamSource).not.toHaveBeenCalled();
      expect(disconnect).toHaveBeenCalledWith(nodes[0]); // Other mic/Program connections survive.
    } finally { now.mockRestore(); vi.unstubAllGlobals(); }
  });

  it("preserves signed 24-bit samples, flushes before stop, and excludes paused audio", () => {
    const messages: Array<{
      bytes?: Uint8Array;
      frames?: number;
      stopped?: boolean;
    }> = [];
    interface Processor {
      active: boolean;
      port: { onmessage: (event: { data: string }) => void };
      process: (inputs: Float32Array[][]) => void;
    }
    let processor: Processor | undefined;
    runInNewContext(pcmWorkletSource, {
      sampleRate: 48000,
      AudioWorkletProcessor: class {
        port = {
          postMessage: (data: (typeof messages)[number]) => messages.push(data),
        };
      },
      registerProcessor: (_name: string, Constructor: new () => Processor) => {
        processor = new Constructor();
      },
    });
    const capture = processor!;
    capture.port.onmessage({ data: "start" });
    capture.process([[new Float32Array([-1, 0, 0.5, 1])]]);
    capture.port.onmessage({ data: "pause" });
    capture.process([[new Float32Array([0.25])]]);
    capture.port.onmessage({ data: "resume" });
    capture.process([[new Float32Array([-0.5])]]);
    capture.process([]);
    capture.port.onmessage({ data: "stop" });
    const samples = messages.flatMap((message) =>
      message.bytes ? [...message.bytes] : [],
    );
    const decoded = Array.from({ length: samples.length / 3 }, (_, index) => {
      const value =
        samples[index * 3] |
        (samples[index * 3 + 1] << 8) |
        (samples[index * 3 + 2] << 16);
      return value & 0x800000 ? value - 0x1000000 : value;
    });
    expect(decoded.slice(0, 5)).toEqual([-8388608, 0, 4194304, 8388607, -4194304]);
    expect(decoded.slice(5)).toEqual(Array(128).fill(0));
    expect(messages.at(-1)).toEqual({ stopped: true });
    expect(messages.filter((message) => message.bytes).at(-1)?.frames).toBe(133);
  });
});
