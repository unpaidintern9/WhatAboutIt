/* global AudioWorkletProcessor, registerProcessor, sampleRate */
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.used = 0;
    this.frames = 0;
    this.bytes = new Uint8Array(Math.round(sampleRate) * 3);
    this.port.onmessage = ({ data }) => {
      if (data === "start" || data === "resume") this.active = true;
      if (data === "pause") {
        this.active = false;
        this.flush();
      }
      if (data === "flush") this.flush();
      if (data === "stop") {
        this.active = false;
        this.flush();
        this.port.postMessage({ stopped: true });
      }
    };
  }
  flush() {
    if (!this.used) return;
    const bytes = this.bytes.slice(0, this.used);
    this.port.postMessage({ bytes, frames: this.frames }, [bytes.buffer]);
    this.used = 0;
  }
  process(inputs, outputs) {
    const samples = inputs[0] && inputs[0][0];
    if (!this.active) return true;
    // An empty input is a real silent render quantum, not time to remove from
    // the episode. Keep its samples so a disconnect cannot compress the track.
    const length = samples?.length ?? outputs?.[0]?.[0]?.length ?? 128;
    for (let index = 0; index < length; index++) {
      const value = samples?.[index] ?? 0;
      const sample = Math.max(
        -8388608,
        Math.min(8388607, Math.round(value * 8388608)),
      );
      this.bytes[this.used++] = sample & 255;
      this.bytes[this.used++] = (sample >> 8) & 255;
      this.bytes[this.used++] = (sample >> 16) & 255;
      this.frames++;
      if (this.used === this.bytes.length) this.flush();
    }
    return true;
  }
}
registerProcessor("wai-pcm-capture", PcmCapture);
