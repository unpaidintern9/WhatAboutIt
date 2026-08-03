import type { MicrophoneInputChannel } from "../../../shared/types";

const processedStreamCleanups = new WeakMap<MediaStream, () => void>();

export function highQualityAudioConstraint(deviceId?: string): MediaTrackConstraints | boolean {
  const constraints: MediaTrackConstraints & { latency?: { ideal: number } } = {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    sampleRate: { ideal: 48000 },
    sampleSize: { ideal: 24 },
    channelCount: { ideal: 2 },
    latency: { ideal: 0.01 },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  };

  return constraints;
}

export function createStudioAudioContext() {
  try {
    return new AudioContext({ latencyHint: 0.01, sampleRate: 48000 });
  } catch {
    return new AudioContext({ latencyHint: "interactive" });
  }
}

export function connectInputChannelSource(
  audioContext: AudioContext,
  source: AudioNode,
  channel: MicrophoneInputChannel = "mix"
) {
  const splitter = audioContext.createChannelSplitter(2);
  const monoBus = audioContext.createGain();
  const trim = audioContext.createGain();

  monoBus.channelCount = 1;
  monoBus.channelCountMode = "explicit";
  monoBus.channelInterpretation = "speakers";
  trim.gain.value = channel === "mix" ? 0.5 : 0.95;

  source.connect(splitter);
  if (channel !== "input-2") splitter.connect(monoBus, 0, 0);
  if (channel !== "input-1") splitter.connect(monoBus, 1, 0);
  monoBus.connect(trim);

  return {
    output: trim,
    disconnect() {
      try {
        source.disconnect(splitter);
        splitter.disconnect();
        monoBus.disconnect();
        trim.disconnect();
      } catch {
        // Nodes may already be disconnected when their AudioContext closes.
      }
    }
  };
}

export function connectCenteredMonoSource(audioContext: AudioContext, source: AudioNode) {
  return connectInputChannelSource(audioContext, source, "mix");
}

export function createRoutedMonoStream(
  inputStream: MediaStream,
  channel: MicrophoneInputChannel = "mix",
  options: { preserveVideo?: boolean } = {}
) {
  const audioTracks = inputStream.getAudioTracks();
  if (audioTracks.length === 0 || typeof window === "undefined" || !window.AudioContext) return inputStream;

  const audioContext = createStudioAudioContext();
  const source = audioContext.createMediaStreamSource(inputStream);
  const centered = connectInputChannelSource(audioContext, source, channel);
  const destination = audioContext.createMediaStreamDestination();

  centered.output.connect(destination);

  const outputStream = new MediaStream([
    ...(options.preserveVideo ? inputStream.getVideoTracks() : []),
    ...destination.stream.getAudioTracks()
  ]);

  processedStreamCleanups.set(outputStream, () => {
    centered.disconnect();
    destination.stream.getTracks().forEach(stopTrack);
    inputStream.getAudioTracks().forEach(stopTrack);
    void audioContext.close();
  });

  return outputStream;
}

export function createCenteredMonoStream(inputStream: MediaStream, options: { preserveVideo?: boolean } = {}) {
  return createRoutedMonoStream(inputStream, "mix", options);
}

export function stopStudioMediaStream(stream?: MediaStream | null) {
  if (!stream) return;
  processedStreamCleanups.get(stream)?.();
  processedStreamCleanups.delete(stream);
  stream.getTracks().forEach(stopTrack);
}

function stopTrack(track: MediaStreamTrack) {
  if (track.readyState !== "ended") track.stop();
}
