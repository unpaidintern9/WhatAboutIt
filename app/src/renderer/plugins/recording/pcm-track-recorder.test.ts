import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { pcmWorkletSource } from "./pcm-track-recorder";

describe("lossless audio rendering-thread capture", () => {
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
    expect(decoded).toEqual([-8388608, 0, 4194304, 8388607, -4194304]);
    expect(messages.at(-1)).toEqual({ stopped: true });
    expect(messages.filter((message) => message.bytes).at(-1)?.frames).toBe(5);
  });
});
