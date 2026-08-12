import type { MicrophoneInputChannel } from "../../../shared/types";

const processedStreamCleanups = new WeakMap<MediaStream, () => void>();

export interface AudioStreamDiagnostics {
  deviceId?: string;
  groupId?: string;
  channelCount?: number;
  sampleRate?: number;
  sampleSize?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}

export function highQualityAudioConstraint(deviceId?: string): MediaTrackConstraints | boolean {
  const constraints: MediaTrackConstraints & { latency?: { ideal: number } } = {
    ...(deviceId ? { deviceId: deviceId === "default" || deviceId === "communications" ? { ideal: deviceId } : { exact: deviceId } } : {}),
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

export async function openAudioStreamWithFallback(
  openStream: (constraints: MediaTrackConstraints | boolean) => Promise<MediaStream>,
  deviceId?: string
) {
  const preferred = highQualityAudioConstraint(deviceId);
  const deviceOnly: MediaTrackConstraints = deviceId
    ? { deviceId: deviceId === "default" || deviceId === "communications" ? { ideal: deviceId } : { exact: deviceId } }
    : {};
  const channelPreserving: MediaTrackConstraints = {
    ...deviceOnly,
    channelCount: { ideal: 2 },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  };

  try {
    return await openStream(preferred);
  } catch (preferredError) {
    try {
      return await openStream(channelPreserving);
    } catch {
      try {
        return await openStream(deviceOnly);
      } catch {
        throw preferredError;
      }
    }
  }
}

export function createStudioAudioContext(outputDeviceId?: string) {
  const options: AudioContextOptions & { sinkId?: string } = {
    latencyHint: "interactive",
    sampleRate: 48000,
    ...(outputDeviceId ? { sinkId: outputDeviceId } : {})
  };
  try {
    return new AudioContext(options);
  } catch {
    return new AudioContext({ latencyHint: "interactive" });
  }
}

export function connectInputChannelSource(
  audioContext: AudioContext,
  source: AudioNode,
  channel: MicrophoneInputChannel = "mix",
  availableChannelCount?: number
) {
  const monoBus = audioContext.createGain();
  const trim = audioContext.createGain();

  monoBus.channelCount = 1;
  monoBus.channelCountMode = "explicit";
  monoBus.channelInterpretation = "speakers";
  trim.gain.value = channel === "mix" ? 1 : 0.95;

  const inputIndex = getMicrophoneInputIndex(channel);
  assertMicrophoneInputAvailable(channel, availableChannelCount);
  const splitter = inputIndex === undefined ? undefined : audioContext.createChannelSplitter(Math.max(availableChannelCount ?? 2, inputIndex + 1));
  if (splitter) {
    source.connect(splitter);
    splitter.connect(monoBus, inputIndex, 0);
  } else {
    // Explicit mono downmix keeps laptop microphones centered and includes every driver-visible channel.
    source.connect(monoBus);
  }
  monoBus.connect(trim);

  return {
    output: trim,
    disconnect() {
      try {
        if (splitter) {
          source.disconnect(splitter);
          splitter.disconnect();
        } else {
          source.disconnect(monoBus);
        }
        monoBus.disconnect();
        trim.disconnect();
      } catch {
        // Nodes may already be disconnected when their AudioContext closes.
      }
    }
  };
}

export function getMicrophoneInputIndex(channel: MicrophoneInputChannel) {
  if (channel === "mix") return undefined;
  return Number(channel.replace("input-", "")) - 1;
}

export function assertMicrophoneInputAvailable(channel: MicrophoneInputChannel, availableChannelCount?: number) {
  const inputIndex = getMicrophoneInputIndex(channel);
  if (inputIndex !== undefined && availableChannelCount !== undefined && inputIndex >= availableChannelCount) {
    throw new Error(`Only ${availableChannelCount} input channel${availableChannelCount === 1 ? " is" : "s are"} available from this browser.`);
  }
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
  const diagnostics = getAudioStreamDiagnostics(inputStream);
  const centered = connectInputChannelSource(audioContext, source, channel, diagnostics.channelCount);
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

export function getAudioStreamDiagnostics(stream: MediaStream): AudioStreamDiagnostics {
  const track = stream.getAudioTracks()[0];
  if (!track) return {};
  const settings = typeof track.getSettings === "function" ? track.getSettings() : {};
  const capabilities = typeof track.getCapabilities === "function" ? track.getCapabilities() : undefined;
  const channelCapability = capabilities?.channelCount;
  const channelCount = settings.channelCount
    ?? (typeof channelCapability === "object" && channelCapability ? channelCapability.max : undefined);

  return {
    deviceId: settings.deviceId,
    groupId: settings.groupId,
    channelCount,
    sampleRate: settings.sampleRate,
    sampleSize: settings.sampleSize,
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl
  };
}

export function calculateAudioLevel(samples: Uint8Array) {
  let squareTotal = 0;
  let peak = 0;
  for (const sample of samples) {
    const normalized = Math.abs((sample - 128) / 128);
    squareTotal += normalized * normalized;
    peak = Math.max(peak, normalized);
  }
  const rms = Math.sqrt(squareTotal / Math.max(samples.length, 1));
  return {
    rms: Math.min(100, Math.round(rms * 260)),
    peak: Math.min(100, Math.round(peak * 100))
  };
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
