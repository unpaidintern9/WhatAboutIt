import type { RecordingEngineHealth, RecordingEnginePlugin, RecordingStartRequest } from "./types";
import type { RecordingMediaTarget, RecordingSession, RecordingTrackKind, RecordingTrackSaveInput, RecordingTrackSlot } from "../../../shared/recording";
import type { MicrophoneInputChannel } from "../../../shared/types";
import { normalizeSharedMicrophoneRoutes } from "../../../shared/device-config";
import { createRoutedMonoStream, getAudioStreamDiagnostics, openAudioStreamWithFallback, stopStudioMediaStream } from "../audio/studio-audio";

interface ActiveTrackRecorder {
  slot: RecordingTrackSlot;
  kind: RecordingTrackKind;
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  writeQueue: Promise<void>;
  startedAtMs: number;
  sequence: number;
  bytesWritten: number;
  lastChunkAt?: string;
  writeError?: string;
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
  private expectedCameraTracks = 0;
  private expectedAudioTracks = 0;
  private practiceActive = false;
  private programMicSlot: RecordingTrackSlot = "morganMic";
  private diskSession?: RecordingSession;
  private programWriteQueue: Promise<void> = Promise.resolve();
  private programStartedAtMs = 0;
  private programSequence = 0;
  private programBytesWritten = 0;
  private programLastChunkAt?: string;
  private programWriteError?: string;
  private captureGeneration = 0;

  constructor(private readonly streams: BrowserMediaRecorderStreamResolver = {}) {}

  async start(request: RecordingStartRequest) {
    await this.shutdown();
    const generation = ++this.captureGeneration;
    const normalizedRequest = {
      ...request,
      deviceDefaults: normalizeSharedMicrophoneRoutes(request.deviceDefaults)
    };

    if (request.practice) {
      this.chunks = [];
      this.trackResults = [];
      this.practiceActive = true;
      return;
    }

    this.expectedCameraTracks = Object.values(normalizedRequest.deviceDefaults.cameras).filter(Boolean).length;
    this.expectedAudioTracks = Object.values(normalizedRequest.deviceDefaults.microphones).filter(Boolean).length;
    this.diskSession = normalizedRequest.session && window.studio.beginRecordingMedia && window.studio.appendRecordingChunk
      ? normalizedRequest.session
      : undefined;
    if (this.diskSession) await window.studio.beginRecordingMedia?.(this.diskSession.folderPath);

    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera needs attention");
    const videoDeviceId = normalizedRequest.deviceDefaults.cameras.camera1;
    const programMicSlot = normalizedRequest.deviceDefaults.cameraMicrophones?.camera1 ?? "morganMic";
    this.programMicSlot = programMicSlot;
    const audioDeviceId = normalizedRequest.deviceDefaults.microphones[programMicSlot] ?? normalizedRequest.deviceDefaults.microphones.morganMic;
    const audioChannel = normalizedRequest.deviceDefaults.microphoneChannels?.[programMicSlot] ?? "mix";

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
      if (event.data.size > 0) this.queueProgramChunk(event.data, this.recorder?.mimeType || "video/webm");
    };
    this.programStartedAtMs = Date.now();
    this.recorder.start(1000);

    // Program recording is the only mandatory startup path. Isolated cameras
    // and microphones attach in the background so a sleeping USB endpoint can
    // never hold the Record button for several seconds.
    void this.startTrackRecorders(normalizedRequest, generation);
  }

  getHealth(): RecordingEngineHealth {
    const activeStates = new Set(["recording", "paused"]);
    const now = Date.now();
    const programRecorderActive = Boolean(this.recorder && activeStates.has(this.recorder.state) && streamIsLive(this.stream));
    const programFirstChunkReceived = this.programBytesWritten > 0;
    const programSourceActive = this.practiceActive || sourceIsWriting(programRecorderActive, programFirstChunkReceived, this.programLastChunkAt, this.programStartedAtMs, now);
    const sources = [
      {
        target: "program" as const,
        kind: "program" as const,
        active: programSourceActive,
        firstChunkReceived: this.practiceActive || programFirstChunkReceived,
        bytesWritten: this.programBytesWritten,
        lastChunkAt: this.programLastChunkAt,
        message: this.programWriteError ?? sourceHealthMessage(programRecorderActive, programFirstChunkReceived, programSourceActive)
      },
      ...this.trackRecorders.map((track) => {
        const recorderActive = activeStates.has(track.recorder.state) && streamIsLive(track.stream);
        const firstChunkReceived = track.bytesWritten > 0;
        const active = sourceIsWriting(recorderActive, firstChunkReceived, track.lastChunkAt, track.startedAtMs, now);
        return {
          target: track.slot,
          kind: track.kind,
          active,
          firstChunkReceived,
          bytesWritten: track.bytesWritten,
          lastChunkAt: track.lastChunkAt,
          message: track.writeError ?? sourceHealthMessage(recorderActive, firstChunkReceived, active)
        };
      })
    ];
    const sourceWarnings = sources.filter((source) => !source.active || source.message.includes("failed")).map((source) => `${source.target}: ${source.message}`);
    const recentTimestamps = sources.map((source) => source.lastChunkAt ? new Date(source.lastChunkAt).getTime() : undefined).filter((timestamp): timestamp is number => timestamp !== undefined);
    if (recentTimestamps.length > 1 && Math.max(...recentTimestamps) - Math.min(...recentTimestamps) > 2500) {
      sourceWarnings.push("Camera and audio chunk timing has drifted by more than 2.5 seconds.");
    }
    return {
      programActive: programSourceActive,
      activeCameraTracks: this.trackRecorders.filter((track) => track.kind === "camera" && activeStates.has(track.recorder.state) && streamIsLive(track.stream)).length,
      activeAudioTracks: this.trackRecorders.filter((track) => track.kind === "audio" && activeStates.has(track.recorder.state) && streamIsLive(track.stream)).length,
      expectedCameraTracks: this.expectedCameraTracks,
      expectedAudioTracks: this.expectedAudioTracks,
      warnings: [...this.trackResults.map((track) => track.message).filter((message): message is string => Boolean(message)), ...sourceWarnings],
      sources
    };
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
    this.captureGeneration += 1;
    if (!this.recorder) {
      this.stopStream();
      return {
        warning: "Practice recording stopped without writing media."
      };
    }

    const recorder = this.recorder;
    const stopped = stopMediaRecorder(recorder);

    const trackResults = await Promise.all(this.trackRecorders.map((trackRecorder) => stopTrackRecorder(trackRecorder, Boolean(this.diskSession))));
    const programStopTimedOut = await stopped;
    if (programStopTimedOut) {
      this.programWriteError = appendWarning(this.programWriteError, "recorder stop event timed out; protected chunks were finalized");
      logRecorderEvent("warning", "Program recorder stop event timed out; continuing with protected chunks.");
    }
    const programWriteTimedOut = await waitForQueue(this.programWriteQueue);
    if (programWriteTimedOut) this.programWriteError = appendWarning(this.programWriteError, "final disk write timed out; recovery chunks were preserved");
    this.stopStream();
    const previewResults = [...this.trackResults];

    if (this.diskSession) {
      const warning = [this.programWriteError, ...this.trackRecorders.map((track) => track.writeError)].filter(Boolean).join(" ") || undefined;
      this.resetRecorder();
      return {
        persisted: true,
        tracks: [...previewResults, ...trackResults],
        warning
      };
    }

    const blob = new Blob(this.chunks, { type: recorder.mimeType || "video/webm" });
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    this.resetRecorder();

    return {
      bytes,
      mimeType: blob.type,
      tracks: [...previewResults, ...trackResults]
    };
  }

  async shutdown() {
    this.captureGeneration += 1;
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

  private async startTrackRecorders(request: RecordingStartRequest, generation: number) {
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
      ...cameraEntries.map((entry) => this.startCameraTrackRecorder(entry.slot, entry.deviceId, generation)),
      ...micEntries.map((entry) => this.startMicTrackRecorder(entry.slot, entry.deviceId, entry.channel, generation))
    ]);
  }

  private async startCameraTrackRecorder(slot: RecordingTrackSlot, deviceId: string | undefined, generation: number) {
    if (!deviceId) return;

    try {
      const stream = await this.openCameraTrackStream(slot, deviceId);
      if (generation !== this.captureGeneration || !this.recorder || this.recorder.state === "inactive") {
        stopStudioMediaStream(stream);
        return;
      }
      this.trackRecorders.push(createTrackRecorder(slot, "camera", stream, pickMimeType(), (track, blob) => this.queueTrackChunk(track, blob)));
    } catch {
      if (generation !== this.captureGeneration) return;
      this.trackResults.push({
        slot,
        kind: "camera",
        status: "preview-only",
        message: "This device can preview but could not save separately"
      });
    }
  }

  private async startMicTrackRecorder(slot: RecordingTrackSlot, deviceId: string | undefined, channel: MicrophoneInputChannel, generation: number) {
    if (!deviceId) return;

    try {
      const stream = await this.openMicTrackStream(slot, deviceId, channel);
      if (generation !== this.captureGeneration || !this.recorder || this.recorder.state === "inactive") {
        stopStudioMediaStream(stream);
        return;
      }
      this.trackResults = this.trackResults.filter((result) => !(result.slot === slot && result.message?.includes("attaching as a separate track")));
      this.trackRecorders.push(createTrackRecorder(slot, "audio", stream, pickAudioMimeType(), (track, blob) => this.queueTrackChunk(track, blob)));
    } catch {
      if (generation !== this.captureGeneration) return;
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
    if (needsVideo) {
      const fallbackVideo = await openMediaStreamWithTimeout(
        () => navigator.mediaDevices.getUserMedia({ video: deviceConstraint(videoDeviceId), audio: false }),
        "camera"
      );
      tracks.push(...fallbackVideo.getVideoTracks());
    }
    if (!activeAudioTrack && audioDeviceId) {
      this.trackResults.push({
        slot: this.programMicSlot,
        kind: "audio",
        status: "preview-only",
        message: "Program video started immediately; this microphone is attaching as a separate track"
      });
    }

    const programSource = new MediaStream(tracks);
    if (audioDeviceId) logAudioCapture(this.programMicSlot, audioDeviceId, channel, programSource);
    return createRoutedMonoStream(programSource, channel, { preserveVideo: true });
  }

  private async openCameraTrackStream(slot: RecordingTrackSlot, deviceId: string) {
    const activeTrack = cloneLiveTrack(this.streams.getCameraStream?.(deviceId)?.getVideoTracks()[0]);
    if (activeTrack) return this.withSyncAudio(activeTrack);

    const programTrack = slot === "camera1" ? cloneLiveTrack(this.stream?.getVideoTracks()[0]) : undefined;
    if (programTrack) return this.withSyncAudio(programTrack);

    const stream = await openMediaStreamWithTimeout(
      () => navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } }, audio: false }),
      `${slot} camera`
    );
    const videoTrack = stream.getVideoTracks()[0];
    return videoTrack ? this.withSyncAudio(videoTrack) : stream;
  }

  private withSyncAudio(videoTrack: MediaStreamTrack) {
    const syncAudioTrack = cloneLiveTrack(this.stream?.getAudioTracks()[0]);
    return new MediaStream([videoTrack, ...(syncAudioTrack ? [syncAudioTrack] : [])]);
  }

  private async openMicTrackStream(slot: RecordingTrackSlot, deviceId: string, channel: MicrophoneInputChannel) {
    const activeTrack = cloneLiveTrack(this.streams.getMicrophoneStream?.(deviceId)?.getAudioTracks()[0]);
    if (activeTrack) {
      const stream = new MediaStream([activeTrack]);
      logAudioCapture(slot, deviceId, channel, stream);
      return createRoutedMonoStream(stream, channel);
    }

    const programTrack = slot === this.programMicSlot ? cloneLiveTrack(this.stream?.getAudioTracks()[0]) : undefined;
    if (programTrack) return new MediaStream([programTrack]);

    const stream = await openRecordingAudioStream(deviceId);
    logAudioCapture(slot, deviceId, channel, stream);
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
    this.expectedCameraTracks = 0;
    this.expectedAudioTracks = 0;
    this.practiceActive = false;
    this.programMicSlot = "morganMic";
    this.diskSession = undefined;
    this.programWriteQueue = Promise.resolve();
    this.programStartedAtMs = 0;
    this.programSequence = 0;
    this.programBytesWritten = 0;
    this.programLastChunkAt = undefined;
    this.programWriteError = undefined;
  }

  private queueProgramChunk(blob: Blob, mimeType: string) {
    if (!this.diskSession) {
      this.chunks.push(blob);
      this.programBytesWritten += blob.size;
      this.programLastChunkAt = new Date().toISOString();
      return;
    }
    const sequence = this.programSequence++;
    const session = this.diskSession;
    this.programWriteQueue = this.programWriteQueue.then(async () => {
      const result = await persistChunk(session, "program", "program", mimeType, sequence, blob);
      this.programBytesWritten = result.bytesWritten;
      this.programLastChunkAt = result.lastChunkAt;
      if (sequence === 0) logRecorderEvent("info", "Program wrote its first protected chunk.", { bytesWritten: result.bytesWritten, lastChunkAt: result.lastChunkAt });
    }).catch((error) => {
      this.programWriteError = `disk write failed: ${String(error)}`;
      logRecorderEvent("error", "Program disk write failed.", { error: String(error) });
    });
  }

  private queueTrackChunk(track: ActiveTrackRecorder, blob: Blob) {
    track.lastChunkAt = new Date().toISOString();
    if (!this.diskSession) {
      track.chunks.push(blob);
      track.bytesWritten += blob.size;
      return;
    }
    const sequence = track.sequence++;
    const session = this.diskSession;
    track.writeQueue = track.writeQueue.then(async () => {
      const result = await persistChunk(session, track.slot, track.kind, track.recorder.mimeType, sequence, blob);
      track.bytesWritten = result.bytesWritten;
      track.lastChunkAt = result.lastChunkAt;
      if (sequence === 0) logRecorderEvent("info", "Isolated source wrote its first protected chunk.", { slot: track.slot, kind: track.kind, bytesWritten: result.bytesWritten, lastChunkAt: result.lastChunkAt });
    }).catch((error) => {
      track.writeError = `disk write failed: ${String(error)}`;
      logRecorderEvent("error", "Isolated source disk write failed.", { slot: track.slot, kind: track.kind, error: String(error) });
    });
  }
}

function logAudioCapture(slot: RecordingTrackSlot, deviceId: string, channel: MicrophoneInputChannel, stream: MediaStream) {
  const details = { slot, deviceId, channel, ...getAudioStreamDiagnostics(stream) };
  void window.studio?.writeRuntimeLog?.({
    level: "info",
    source: "AudioCapture",
    message: "Opened isolated recording route.",
    details
  }).catch(() => undefined);
  try {
    if (window.localStorage.getItem("waiDeviceDebug") !== "1") return;
    console.info("[AudioCapture] recording route", details);
  } catch {
    // Diagnostics must never interrupt recording.
  }
}

function cloneLiveTrack(track?: MediaStreamTrack) {
  return track?.readyState === "live" ? track.clone() : undefined;
}

function deviceConstraint(deviceId?: string) {
  return deviceId ? { deviceId: { exact: deviceId } } : true;
}

function openRecordingAudioStream(deviceId?: string) {
  return openMediaStreamWithTimeout(
    () => openAudioStreamWithFallback(
      (audio) => navigator.mediaDevices.getUserMedia({ audio, video: false }),
      deviceId
    ),
    "microphone"
  );
}

function openMediaStreamWithTimeout(request: () => Promise<MediaStream>, sourceLabel: string, timeoutMs = 8000) {
  return new Promise<MediaStream>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${sourceLabel} did not respond within ${Math.round(timeoutMs / 1000)} seconds`));
    }, timeoutMs);

    void request().then((stream) => {
      if (settled) {
        stopStudioMediaStream(stream);
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      resolve(stream);
    }).catch((error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(error);
    });
  });
}

function createTrackRecorder(
  slot: RecordingTrackSlot,
  kind: RecordingTrackKind,
  stream: MediaStream,
  mimeType: string,
  onChunk: (track: ActiveTrackRecorder, blob: Blob) => void
): ActiveTrackRecorder {
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, { mimeType });
  const track: ActiveTrackRecorder = { slot, kind, recorder, stream, chunks, writeQueue: Promise.resolve(), startedAtMs: Date.now(), sequence: 0, bytesWritten: 0 };
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) onChunk(track, event.data);
  };
  recorder.start(1000);
  return track;
}

async function stopTrackRecorder(trackRecorder: ActiveTrackRecorder, persisted: boolean): Promise<RecordingTrackSaveInput> {
  const { recorder } = trackRecorder;
  if (await stopMediaRecorder(recorder)) {
    trackRecorder.writeError = appendWarning(trackRecorder.writeError, "recorder stop event timed out; protected chunks were finalized");
    logRecorderEvent("warning", "Isolated recorder stop event timed out; continuing with protected chunks.", { slot: trackRecorder.slot, kind: trackRecorder.kind });
  }
  if (await waitForQueue(trackRecorder.writeQueue)) {
    trackRecorder.writeError = appendWarning(trackRecorder.writeError, "final disk write timed out; recovery chunks were preserved");
  }
  recorder.ondataavailable = null;
  stopStudioMediaStream(trackRecorder.stream);
  if (persisted) {
    return trackRecorder.writeError
      ? { slot: trackRecorder.slot, kind: trackRecorder.kind, status: "needs-attention", message: trackRecorder.writeError }
      : { slot: trackRecorder.slot, kind: trackRecorder.kind, status: "saved", message: "Written safely to disk" };
  }
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

/**
 * Chromium on Windows can occasionally leave MediaRecorder in a state where
 * stop() was accepted but the stop event never arrives. Flush once, then use a
 * bounded wait so disk-first chunks can still be finalized and recovered.
 */
function stopMediaRecorder(recorder: MediaRecorder, timeoutMs = RECORDER_STOP_TIMEOUT_MS) {
  if (recorder.state === "inactive") return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (timedOut: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      recorder.removeEventListener("stop", onStop);
      recorder.removeEventListener("error", onError);
      resolve(timedOut);
    };
    const onStop = () => finish(false);
    const onError = () => finish(true);
    const timer = window.setTimeout(() => finish(true), timeoutMs);
    recorder.addEventListener("stop", onStop, { once: true });
    recorder.addEventListener("error", onError, { once: true });
    try {
      if (typeof recorder.requestData === "function") recorder.requestData();
      recorder.stop();
    } catch {
      finish(true);
    }
  });
}

function waitForQueue(queue: Promise<void>, timeoutMs = FINAL_WRITE_TIMEOUT_MS) {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (timedOut: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(timedOut);
    };
    const timer = window.setTimeout(() => finish(true), timeoutMs);
    void queue.then(() => finish(false), () => finish(false));
  });
}

function appendWarning(current: string | undefined, warning: string) {
  return current ? `${current} ${warning}` : warning;
}

function logRecorderEvent(level: "info" | "warning" | "error", message: string, details?: Record<string, unknown>) {
  void window.studio?.writeRuntimeLog?.({ level, source: "BrowserMediaRecorder", message, details }).catch(() => undefined);
}

async function persistChunk(
  session: RecordingSession | undefined,
  target: RecordingMediaTarget,
  kind: "program" | RecordingTrackKind,
  mimeType: string,
  sequence: number,
  blob: Blob
) {
  if (!session || !window.studio.appendRecordingChunk) throw new Error("Recording disk writer is unavailable.");
  return window.studio.appendRecordingChunk(session.folderPath, {
    target,
    kind,
    mimeType,
    sequence,
    bytes: new Uint8Array(await blob.arrayBuffer())
  });
}

function streamIsLive(stream?: MediaStream | null) {
  if (!stream) return false;
  const tracks = stream.getTracks();
  return tracks.length > 0 && tracks.every((track) => track.readyState === "live" && !track.muted);
}

function chunkIsRecent(lastChunkAt: string | undefined, now: number) {
  if (!lastChunkAt) return false;
  return now - new Date(lastChunkAt).getTime() < 6000;
}

const FIRST_CHUNK_GRACE_MS = 8000;
const RECORDER_STOP_TIMEOUT_MS = 5000;
const FINAL_WRITE_TIMEOUT_MS = 10000;

function sourceIsWriting(recorderActive: boolean, firstChunkReceived: boolean, lastChunkAt: string | undefined, startedAtMs: number, now: number) {
  if (!recorderActive) return false;
  if (firstChunkReceived) return chunkIsRecent(lastChunkAt, now);
  return startedAtMs > 0 && now - startedAtMs < FIRST_CHUNK_GRACE_MS;
}

function sourceHealthMessage(recorderActive: boolean, firstChunkReceived: boolean, active: boolean) {
  if (!recorderActive) return "Source stopped";
  if (!firstChunkReceived) return active ? "Starting disk writer" : "No media data was written";
  return active ? "Writing to disk" : "Media data stopped arriving";
}

function pickMimeType() {
  const options = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return options.find((option) => MediaRecorder.isTypeSupported(option)) ?? "video/webm";
}

function pickAudioMimeType() {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return options.find((option) => MediaRecorder.isTypeSupported(option)) ?? "audio/webm";
}
