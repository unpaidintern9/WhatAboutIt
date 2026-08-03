import type { RecordingEnginePlugin, RecordingStartRequest } from "./types";
import type { RecordingTrackKind, RecordingTrackSaveInput, RecordingTrackSlot } from "../../../shared/recording";
import type { MicrophoneInputChannel } from "../../../shared/types";
import { createRoutedMonoStream, highQualityAudioConstraint, stopStudioMediaStream } from "../audio/studio-audio";

interface ActiveTrackRecorder {
  slot: RecordingTrackSlot;
  kind: RecordingTrackKind;
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
}

export interface BrowserMediaRecorderStreamResolver {
  getCameraStream?: (deviceId?: string) => MediaStream | undefined;
  getMicrophoneStream?: (deviceId?: string) => MediaStream | undefined;
}

export class BrowserMediaRecorderPlugin implements RecordingEnginePlugin {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private trackRecorders: ActiveTrackRecorder[] = [];
  private trackResults: RecordingTrackSaveInput[] = [];

  constructor(private readonly streams: BrowserMediaRecorderStreamResolver = {}) {}

  async start(request: RecordingStartRequest) {
    await this.shutdown();

    if (request.practice) {
      this.chunks = [];
      this.trackResults = [];
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera needs attention");

    const videoDeviceId = request.deviceDefaults.cameras.camera1;
    const programMicSlot = request.deviceDefaults.cameraMicrophones?.camera1 ?? "morganMic";
    const audioDeviceId = request.deviceDefaults.microphones[programMicSlot] ?? request.deviceDefaults.microphones.morganMic;
    const audioChannel = request.deviceDefaults.microphoneChannels?.[programMicSlot] ?? "mix";

    try {
      this.stream = await this.openProgramStream(videoDeviceId, audioDeviceId, audioChannel);
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

    await this.startTrackRecorders(request);
  }

  async pause() {
    if (this.recorder?.state === "recording") this.recorder.pause();
    for (const trackRecorder of this.trackRecorders) {
      if (trackRecorder.recorder.state === "recording") trackRecorder.recorder.pause();
    }
  }

  async resume() {
    if (this.recorder?.state === "paused") this.recorder.resume();
    for (const trackRecorder of this.trackRecorders) {
      if (trackRecorder.recorder.state === "paused") trackRecorder.recorder.resume();
    }
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

    const trackResults = await Promise.all(this.trackRecorders.map((trackRecorder) => stopTrackRecorder(trackRecorder)));
    await stopped;
    this.stopStream();

    const blob = new Blob(this.chunks, { type: recorder.mimeType || "video/webm" });
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    this.resetRecorder();

    return {
      bytes,
      mimeType: blob.type,
      tracks: [...this.trackResults, ...trackResults]
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

  private async startTrackRecorders(request: RecordingStartRequest) {
    const cameraEntries: Array<{ slot: RecordingTrackSlot; deviceId?: string }> = [
      { slot: "camera1", deviceId: request.deviceDefaults.cameras.camera1 },
      { slot: "camera2", deviceId: request.deviceDefaults.cameras.camera2 },
      { slot: "camera3", deviceId: request.deviceDefaults.cameras.camera3 }
    ];
    const micEntries: Array<{ slot: RecordingTrackSlot; deviceId?: string; channel: MicrophoneInputChannel }> = [
      { slot: "morganMic", deviceId: request.deviceDefaults.microphones.morganMic, channel: request.deviceDefaults.microphoneChannels?.morganMic ?? "mix" },
      { slot: "guestMic", deviceId: request.deviceDefaults.microphones.guestMic, channel: request.deviceDefaults.microphoneChannels?.guestMic ?? "mix" },
      { slot: "extraMic", deviceId: request.deviceDefaults.microphones.extraMic, channel: request.deviceDefaults.microphoneChannels?.extraMic ?? "mix" }
    ];

    await Promise.all([
      ...cameraEntries.map((entry) => this.startCameraTrackRecorder(entry.slot, entry.deviceId)),
      ...micEntries.map((entry) => this.startMicTrackRecorder(entry.slot, entry.deviceId, entry.channel))
    ]);
  }

  private async startCameraTrackRecorder(slot: RecordingTrackSlot, deviceId?: string) {
    if (!deviceId) return;

    try {
      const stream = await this.openCameraTrackStream(slot, deviceId);
      this.trackRecorders.push(createTrackRecorder(slot, "camera", stream, pickMimeType()));
    } catch {
      this.trackResults.push({
        slot,
        kind: "camera",
        status: "preview-only",
        message: "This device can preview but could not save separately"
      });
    }
  }

  private async startMicTrackRecorder(slot: RecordingTrackSlot, deviceId: string | undefined, channel: MicrophoneInputChannel) {
    if (!deviceId) return;

    try {
      const stream = await this.openMicTrackStream(slot, deviceId, channel);
      this.trackRecorders.push(createTrackRecorder(slot, "audio", stream, pickAudioMimeType()));
    } catch {
      this.trackResults.push({
        slot,
        kind: "audio",
        status: "preview-only",
        message: "This device can preview but could not save separately"
      });
    }
  }

  private async openProgramStream(videoDeviceId: string | undefined, audioDeviceId: string | undefined, channel: MicrophoneInputChannel) {
    const tracks: MediaStreamTrack[] = [];
    const activeVideoTrack = cloneLiveTrack(this.streams.getCameraStream?.(videoDeviceId)?.getVideoTracks()[0]);
    const activeAudioTrack = cloneLiveTrack(this.streams.getMicrophoneStream?.(audioDeviceId)?.getAudioTracks()[0]);

    if (activeVideoTrack) tracks.push(activeVideoTrack);
    if (activeAudioTrack) tracks.push(activeAudioTrack);

    const needsVideo = !activeVideoTrack;
    const needsAudio = !activeAudioTrack;
    if (needsVideo || needsAudio) {
      const fallback = await navigator.mediaDevices.getUserMedia({
        video: needsVideo ? deviceConstraint(videoDeviceId) : false,
        audio: needsAudio ? highQualityAudioConstraint(audioDeviceId) : false
      });
      tracks.push(...fallback.getTracks());
    }

    return createRoutedMonoStream(new MediaStream(tracks), channel, { preserveVideo: true });
  }

  private async openCameraTrackStream(slot: RecordingTrackSlot, deviceId: string) {
    const activeTrack = cloneLiveTrack(this.streams.getCameraStream?.(deviceId)?.getVideoTracks()[0]);
    if (activeTrack) return new MediaStream([activeTrack]);

    const programTrack = slot === "camera1" ? cloneLiveTrack(this.stream?.getVideoTracks()[0]) : undefined;
    if (programTrack) return new MediaStream([programTrack]);

    return navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } }, audio: false });
  }

  private async openMicTrackStream(slot: RecordingTrackSlot, deviceId: string, channel: MicrophoneInputChannel) {
    const activeTrack = cloneLiveTrack(this.streams.getMicrophoneStream?.(deviceId)?.getAudioTracks()[0]);
    if (activeTrack) return createRoutedMonoStream(new MediaStream([activeTrack]), channel);

    const programTrack = slot === "morganMic" ? cloneLiveTrack(this.stream?.getAudioTracks()[0]) : undefined;
    if (programTrack) return new MediaStream([programTrack]);

    const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: highQualityAudioConstraint(deviceId) });
    return createRoutedMonoStream(stream, channel);
  }

  private stopStream() {
    stopStudioMediaStream(this.stream);
    this.stream = null;
    this.trackRecorders.forEach((trackRecorder) => {
      stopStudioMediaStream(trackRecorder.stream);
    });
  }

  private resetRecorder() {
    if (this.recorder) {
      this.recorder.ondataavailable = null;
    }
    this.recorder = null;
    this.chunks = [];
    this.trackRecorders = [];
    this.trackResults = [];
  }
}

function cloneLiveTrack(track?: MediaStreamTrack) {
  return track?.readyState === "live" ? track.clone() : undefined;
}

function deviceConstraint(deviceId?: string) {
  return deviceId ? { deviceId: { exact: deviceId } } : true;
}

function createTrackRecorder(slot: RecordingTrackSlot, kind: RecordingTrackKind, stream: MediaStream, mimeType: string): ActiveTrackRecorder {
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, { mimeType });
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start(1000);
  return { slot, kind, recorder, stream, chunks };
}

async function stopTrackRecorder(trackRecorder: ActiveTrackRecorder): Promise<RecordingTrackSaveInput> {
  const { recorder } = trackRecorder;
  const stopped = recorder.state === "inactive"
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.stop();
      });

  await stopped;
  stopStudioMediaStream(trackRecorder.stream);
  const blob = new Blob(trackRecorder.chunks, { type: recorder.mimeType || (trackRecorder.kind === "audio" ? pickAudioMimeType() : pickMimeType()) });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return bytes.length > 0
    ? { slot: trackRecorder.slot, kind: trackRecorder.kind, bytes, mimeType: blob.type }
    : {
        slot: trackRecorder.slot,
        kind: trackRecorder.kind,
        status: "needs-attention",
        message: "This device can preview but could not save separately"
      };
}

function pickMimeType() {
  const options = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return options.find((option) => MediaRecorder.isTypeSupported(option)) ?? "video/webm";
}

function pickAudioMimeType() {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return options.find((option) => MediaRecorder.isTypeSupported(option)) ?? "audio/webm";
}
