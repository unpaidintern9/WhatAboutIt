const processedStreamCleanups = new WeakMap<MediaStream, () => void>();

export function highQualityAudioConstraint(deviceId?: string): MediaTrackConstraints | boolean {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    sampleRate: { ideal: 48000 },
    sampleSize: { ideal: 24 },
    channelCount: { ideal: 2 },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  };
}

export function createStudioAudioContext() {
  try {
    return new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
  } catch {
    return new AudioContext({ latencyHint: "interactive" });
  }
}

export function connectCenteredMonoSource(audioContext: AudioContext, source: AudioNode) {
  const splitter = audioContext.createChannelSplitter(2);
  const monoBus = audioContext.createGain();
  const trim = audioContext.createGain();

  monoBus.channelCount = 1;
  monoBus.channelCountMode = "explicit";
  monoBus.channelInterpretation = "speakers";
  trim.gain.value = 0.9;

  source.connect(splitter);
  splitter.connect(monoBus, 0, 0);
  splitter.connect(monoBus, 1, 0);
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

export function createCenteredMonoStream(inputStream: MediaStream, options: { preserveVideo?: boolean } = {}) {
  const audioTracks = inputStream.getAudioTracks();
  if (audioTracks.length === 0 || typeof window === "undefined" || !window.AudioContext) return inputStream;

  const audioContext = createStudioAudioContext();
  const source = audioContext.createMediaStreamSource(inputStream);
  const centered = connectCenteredMonoSource(audioContext, source);
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

export function stopStudioMediaStream(stream?: MediaStream | null) {
  if (!stream) return;
  processedStreamCleanups.get(stream)?.();
  processedStreamCleanups.delete(stream);
  stream.getTracks().forEach(stopTrack);
}

function stopTrack(track: MediaStreamTrack) {
  if (track.readyState !== "ended") track.stop();
}
