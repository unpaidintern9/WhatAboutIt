import type { RecordingEnginePlugin, RecordingStartRequest } from "./types";

export class BrowserMediaRecorderPlugin implements RecordingEnginePlugin {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];

  async start(request: RecordingStartRequest) {
    if (request.practice) {
      this.chunks = [];
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Permission needed before we can record.");
    }

    const videoDeviceId = request.deviceDefaults.cameras.camera1;
    const audioDeviceId = request.deviceDefaults.microphones.morganMic;

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: videoDeviceId ? { deviceId: { exact: videoDeviceId } } : true,
      audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true
    });

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
      return {
        warning: "Practice recording stopped without writing media."
      };
    }

    const recorder = this.recorder;
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    this.stream?.getTracks().forEach((track) => track.stop());

    const blob = new Blob(this.chunks, { type: recorder.mimeType || "video/webm" });
    const buffer = await blob.arrayBuffer();
    const bytes = Array.from(new Uint8Array(buffer));

    this.recorder = null;
    this.stream = null;
    this.chunks = [];

    return {
      bytes,
      mimeType: blob.type
    };
  }
}

function pickMimeType() {
  const options = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return options.find((option) => MediaRecorder.isTypeSupported(option)) ?? "video/webm";
}

