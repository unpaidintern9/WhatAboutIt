import type { RecordingEnginePlugin, RecordingStartRequest } from "./types";

export class BrowserMediaRecorderPlugin implements RecordingEnginePlugin {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];

  async start(request: RecordingStartRequest) {
    await this.shutdown();

    if (request.practice) {
      this.chunks = [];
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera needs attention");

    const videoDeviceId = request.deviceDefaults.cameras.camera1;
    const audioDeviceId = request.deviceDefaults.microphones.morganMic;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: videoDeviceId ? { deviceId: { exact: videoDeviceId } } : true,
        audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true
      });
    } catch (error) {
      const message = String(error);
      if (message.includes("audio") || message.includes("microphone")) throw new Error("Mic needs attention", { cause: error });
      throw new Error("Camera needs attention", { cause: error });
    }

    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, { mimeType: pickMimeType() });
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start(1000);
  }

  async pause() {
    if (this.recorder?.state === "recording") this.recorder.pause();
  }

  async resume() {
    if (this.recorder?.state === "paused") this.recorder.resume();
  }

  async stop() {
    if (!this.recorder) {
      this.stopStream();
      return {
        warning: "Practice recording stopped without writing media."
      };
    }

    const recorder = this.recorder;
    const stopped = recorder.state === "inactive"
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          recorder.addEventListener("stop", () => resolve(), { once: true });
          recorder.stop();
        });

    await stopped;
    this.stopStream();

    const blob = new Blob(this.chunks, { type: recorder.mimeType || "video/webm" });
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    this.resetRecorder();

    return {
      bytes,
      mimeType: blob.type
    };
  }

  async shutdown() {
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch {
        // The stream cleanup below is the important part during shutdown.
      }
    }
    this.stopStream();
    this.resetRecorder();
  }

  private stopStream() {
    this.stream?.getTracks().forEach((track) => {
      if (track.readyState !== "ended") track.stop();
    });
    this.stream = null;
  }

  private resetRecorder() {
    if (this.recorder) {
      this.recorder.ondataavailable = null;
    }
    this.recorder = null;
    this.chunks = [];
  }
}

function pickMimeType() {
  const options = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return options.find((option) => MediaRecorder.isTypeSupported(option)) ?? "video/webm";
}
