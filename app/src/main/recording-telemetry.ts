import { summarizePcmSignal } from "./pcm-signal-diagnostics";
import path from "node:path";
import { logger, withLogContext } from "./logger";
import { mediaWorkStatus } from "./media-work-scheduler";
import type { RecordingChunkInput, RecordingSession } from "../shared/recording";

const sessions = new Map<number, Record<string, unknown>>();
const writes = new Map<string, { context: Record<string, unknown>; lastAt: number; sources: Record<string, {
  receivedChunks: number; acknowledgedChunks: number; failures: number; latestSequence: number; durableBytes: number; maximumWriteMs: number;
  pcm?: { frames: number; sumSquares: number; sum: number; peak: number; nearFullScaleSamples: number; minimumBlockRmsDbfs: number; maximumAnalysisMs: number };
}> }>();
export function registerRecordingContext(sender: number, session: RecordingSession) {
  sessions.set(sender, { episodeId: session.episodeId, sessionId: session.id,
    capturePart: session.captureFolderPath ? path.basename(session.captureFolderPath) : undefined, webContentsId: sender, recordingActive: false });
}
export function markRecordingActive(sender: number, active: boolean) { const state = sessions.get(sender); if (state) state.recordingActive = active; }
export function finishRecordingTelemetry(folder: string) {
  for (const key of writes.keys()) if (key === folder || key.startsWith(`${folder}${path.sep}`)) summarizeRecordingWrites(key, true);
}
export function forgetRecordingContext(sender: number) { sessions.delete(sender); }
export function inRecordingContext<T>(sender: number, operation: () => T): T {
  return withLogContext(sessions.get(sender) ?? { webContentsId: sender }, operation);
}
export async function observeChunk<T extends { bytesWritten: number }>(sender: number, folder: string, chunk: RecordingChunkInput, operation: () => Promise<T>): Promise<T> {
  return inRecordingContext(sender, async () => {
    let state = writes.get(folder);
    if (!state) { state = { context: sessions.get(sender) ?? {}, lastAt: Date.now(), sources: {} }; writes.set(folder, state); }
    const source = state.sources[chunk.target] ??= { receivedChunks: 0, acknowledgedChunks: 0, failures: 0,
      latestSequence: -1, durableBytes: 0, maximumWriteMs: 0 };
    source.receivedChunks++;
    const started = performance.now();
    try {
      const result = await operation();
      const newSequence = chunk.sequence > source.latestSequence;
      source.acknowledgedChunks++; source.latestSequence = Math.max(source.latestSequence, chunk.sequence); source.durableBytes = result.bytesWritten;
      const analysisStarted = performance.now();
      try {
        const signal = newSequence ? summarizePcmSignal(chunk.bytes, chunk.mimeType) : undefined;
        if (signal) {
          const pcm = source.pcm ??= { frames: 0, sumSquares: 0, sum: 0, peak: 0, nearFullScaleSamples: 0, minimumBlockRmsDbfs: 0, maximumAnalysisMs: 0 };
          pcm.frames += signal.frames; pcm.sumSquares += signal.sumSquares; pcm.sum += signal.sum;
          pcm.peak = Math.max(pcm.peak, signal.peak); pcm.nearFullScaleSamples += signal.nearFullScaleSamples;
          pcm.minimumBlockRmsDbfs = Math.min(pcm.minimumBlockRmsDbfs, signal.rmsDbfs);
          pcm.maximumAnalysisMs = Math.max(pcm.maximumAnalysisMs, performance.now() - analysisStarted);
        }
      } catch { /* Passive diagnostics never turn a successful media write into a failure. */ }
      return result;
    } catch (error) {
      source.failures++;
      void logger.error("RecordingDisk", "Recording chunk write failed.", { ...state.context, target: chunk.target,
        sequence: chunk.sequence, chunkBytes: chunk.bytes.length, writeMs: Math.round(performance.now() - started), error });
      throw error;
    } finally {
      source.maximumWriteMs = Math.max(source.maximumWriteMs, Math.round(performance.now() - started));
      if (Date.now() - state.lastAt >= 15000) summarizeRecordingWrites(folder);
    }
  });
}
export function summarizeRecordingWrites(folder: string, finished = false) {
  const state = writes.get(folder);
  if (!state) return;
  void logger.info("RecordingDisk", "Recording disk write summary.", { ...state.context, sources: Object.fromEntries(Object.entries(state.sources).map(([key, value]) => {
    const { pcm, ...disk } = value;
    return [key, { ...disk, pcm: pcm ? { measurementPoint: "acknowledged-mono-24-bit-PCM", frames: pcm.frames,
      rmsDbfs: Math.round(Math.max(-120, 10 * Math.log10(Math.max(pcm.sumSquares / pcm.frames, 1e-12))) * 10) / 10,
      peakDbfs: Math.round(Math.max(-120, 20 * Math.log10(Math.max(pcm.peak, 1e-6))) * 10) / 10,
      dcOffset: Math.round(pcm.sum / pcm.frames * 1e6) / 1e6, nearFullScaleSamples: pcm.nearFullScaleSamples,
      minimumBlockRmsDbfs: Math.round(pcm.minimumBlockRmsDbfs * 10) / 10,
      maximumAnalysisMs: Math.round(pcm.maximumAnalysisMs * 100) / 100 } : undefined }];
  })), scheduler: mediaWorkStatus(), finished });
  state.lastAt = Date.now();
  if (finished) writes.delete(folder);
}
export function recordingTelemetryContexts() { return [...sessions.values()].filter((state) => state.recordingActive); }
