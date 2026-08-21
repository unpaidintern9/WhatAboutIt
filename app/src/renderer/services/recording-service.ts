import type { DeviceDefaults } from "../../shared/types";
import type { RecordingIntegrityReport, RecordingSession, RecordingState, RecordingStatus, RecordingTrackSaveResult } from "../../shared/recording";
import { createInitialRecordingState, friendlyRecordingError } from "../../shared/recording";
import type { RecordingEngineHealth, RecordingEnginePlugin, RecordingEngineResult } from "../plugins/recording/types";

export interface RecordingServiceSnapshot {
  status: RecordingStatus;
  elapsedMs: number;
  session?: RecordingSession;
  friendlyError?: string;
  localSaveMessage: string;
  trackStatuses: RecordingTrackSaveResult[];
  health?: RecordingEngineHealth;
  integrity?: RecordingIntegrityReport;
}

export interface RecordingStartOptions {
  episodeId?: string;
  episodeTitle?: string;
  practice?: boolean;
  backupFolderPath?: string;
}

export class RecordingService {
  private status: RecordingStatus = "idle";
  private session?: RecordingSession;
  private startedAt = 0;
  private elapsedBeforePause = 0;
  private stateTimer?: number;
  private startupHealthTimer?: number;
  private friendlyError?: string;
  private trackStatuses: RecordingTrackSaveResult[] = [];
  private integrity?: RecordingIntegrityReport;
  private stopPromise?: Promise<RecordingServiceSnapshot>;

  constructor(private readonly plugin: RecordingEnginePlugin) {}

  getSnapshot(): RecordingServiceSnapshot {
    const health = this.plugin.getHealth?.();
    const activeSources = (health?.activeCameraTracks ?? 0) + (health?.activeAudioTracks ?? 0);
    const expectedSources = (health?.expectedCameraTracks ?? 0) + (health?.expectedAudioTracks ?? 0);
    const missingSources = Math.max(0, expectedSources - activeSources);
    const bytesWritten = health?.sources.reduce((total, source) => total + source.bytesWritten, 0) ?? 0;
    const localSaveMessage = (this.status === "recording" || this.status === "paused") && health
      ? health.warnings.length > 0 || missingSources > 0
        ? `${activeSources} source tracks recording; ${Math.max(health.warnings.length, missingSources)} need attention`
        : bytesWritten > 0
          ? `Program plus ${activeSources} source tracks are writing to disk · ${formatBytes(bytesWritten)} protected`
          : `Program plus ${activeSources} source tracks are starting their disk writers`
      : this.status === "stopped" && this.integrity
        ? this.integrity.playable ? "Recording saved and verified" : "Recording saved with items that need attention"
        : "Ready to save directly to this computer";
    return {
      status: this.status,
      elapsedMs: this.elapsedMs(),
      session: this.session,
      friendlyError: this.friendlyError,
      localSaveMessage,
      trackStatuses: this.trackStatuses,
      health,
      integrity: this.integrity
    };
  }

  async start(deviceDefaults: DeviceDefaults, options: RecordingStartOptions = {}) {
    if (this.status === "recording" || this.status === "paused") return this.getSnapshot();

    try {
      logRecordingEvent("info", "Recording start requested.", {
        episodeId: options.episodeId,
        practice: Boolean(options.practice),
        cameras: deviceDefaults.cameras,
        microphones: deviceDefaults.microphones,
        microphoneChannels: deviceDefaults.microphoneChannels
      });
      this.session = await window.studio.createRecordingSession({
        deviceDefaults,
        episodeId: options.episodeId,
        episodeTitle: options.episodeTitle ?? (options.practice ? "Practice Recording" : "Studio Recording"),
        practice: options.practice,
        backupFolderPath: options.backupFolderPath
      });
      await this.plugin.start({ deviceDefaults, practice: options.practice, session: this.session });
      this.status = "recording";
      this.startedAt = Date.now();
      this.elapsedBeforePause = 0;
      this.friendlyError = undefined;
      this.trackStatuses = [];
      this.integrity = undefined;
      window.studio?.setRecordingCloseProtection?.(true);
      await this.persistState();
      this.startStateTimer();
      this.startStartupHealthGate();
      logRecordingEvent("info", "Recording capture is active.", { sessionId: this.session.id, folderPath: this.session.folderPath });
    } catch (error) {
      this.stopStartupHealthGate();
      this.status = "error";
      const message = String(error);
      this.friendlyError = message.includes("Camera needs attention")
        ? friendlyRecordingError("camera")
        : message.includes("Mic needs attention")
        ? friendlyRecordingError("mic")
        : friendlyRecordingError("device");
      if (this.session) await window.studio.appendRecordingError(this.session.folderPath, `${this.friendlyError} Startup detail: ${message}`);
      await this.persistState();
      window.studio?.setRecordingCloseProtection?.(false);
      logRecordingEvent("error", "Recording start failed.", { error: message, sessionId: this.session?.id });
    }

    return this.getSnapshot();
  }

  async pause() {
    if (this.status !== "recording") return this.getSnapshot();
    this.stopStartupHealthGate();
    await this.plugin.pause();
    this.elapsedBeforePause = this.elapsedMs();
    this.status = "paused";
    await this.persistState();
    logRecordingEvent("info", "Recording paused.", { sessionId: this.session?.id, elapsedMs: this.elapsedBeforePause });
    return this.getSnapshot();
  }

  async resume() {
    if (this.status !== "paused") return this.getSnapshot();
    await this.plugin.resume();
    this.startedAt = Date.now();
    this.status = "recording";
    await this.persistState();
    this.startStartupHealthGate();
    logRecordingEvent("info", "Recording resumed.", { sessionId: this.session?.id, elapsedMs: this.elapsedBeforePause });
    return this.getSnapshot();
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise;
    const stopPromise = this.stopActiveSession();
    this.stopPromise = stopPromise;
    try {
      return await stopPromise;
    } finally {
      if (this.stopPromise === stopPromise) this.stopPromise = undefined;
    }
  }

  private async stopActiveSession() {
    if (!this.session || (this.status !== "recording" && this.status !== "paused")) return this.getSnapshot();
    const session = this.session;
    const finalElapsed = this.elapsedMs();
    this.stopStartupHealthGate();
    this.stopStateTimer();
    logRecordingEvent("info", "Stop requested; flushing browser recorders.", { sessionId: session.id, elapsedMs: finalElapsed });

    try {
      const result: RecordingEngineResult = await this.plugin.stop();
      logRecordingEvent(result.warning ? "warning" : "info", "Browser recorders stopped; finalizing protected media.", {
        sessionId: session.id,
        persisted: Boolean(result.persisted),
        warning: result.warning,
        reportedTracks: result.tracks?.length ?? 0
      });
      if (result.persisted && window.studio.finalizeRecordingMedia) {
        const finalized = await window.studio.finalizeRecordingMedia(session.folderPath);
        const finalizedSlots = new Set(finalized.tracks.map((track) => track.slot));
        const unavailableTracks = (result.tracks ?? []).filter((track) => track.status !== "saved" && !finalizedSlots.has(track.slot)).map((track) => ({
          slot: track.slot,
          kind: track.kind,
          status: track.status ?? "needs-attention" as const,
          message: track.message ?? "Source needs attention"
        }));
        this.trackStatuses = [...finalized.tracks, ...unavailableTracks];
        this.integrity = finalized.integrity;
        if (unavailableTracks.length > 0) {
          this.integrity = {
            ...finalized.integrity,
            playable: false,
            expectedSourceCount: finalized.integrity.expectedSourceCount + unavailableTracks.length,
            warnings: [...finalized.integrity.warnings, ...unavailableTracks.map((track) => `${track.slot}: ${track.message}`)]
          };
        }
      } else {
        if (result.bytes && result.bytes.length > 0) {
          await window.studio.saveProgramRecording(session.folderPath, result.bytes);
        }
        if (result.tracks?.length) {
          this.trackStatuses = await window.studio.saveRecordedTracks(session.folderPath, result.tracks);
        }
      }
    } catch (error) {
      this.status = "error";
      this.friendlyError = "The recording stopped, but some files still need recovery.";
      await window.studio.appendRecordingError(session.folderPath, `${this.friendlyError} ${String(error)}`);
      await this.persistState(finalElapsed);
      window.studio?.setRecordingCloseProtection?.(false);
      logRecordingEvent("error", "Recording finalization failed; recovery data was preserved.", { sessionId: session.id, error: String(error) });
      return this.getSnapshot();
    }

    this.elapsedBeforePause = finalElapsed;
    this.status = "stopped";
    await this.persistState(finalElapsed);
    window.studio?.setRecordingCloseProtection?.(false);
    logRecordingEvent("info", "Recording stopped and verified.", {
      sessionId: session.id,
      elapsedMs: finalElapsed,
      playable: this.integrity?.playable,
      savedSourceCount: this.integrity?.savedSourceCount,
      expectedSourceCount: this.integrity?.expectedSourceCount,
      warnings: this.integrity?.warnings
    });
    return this.getSnapshot();
  }

  async shutdown() {
    this.stopStateTimer();
    this.stopStartupHealthGate();
    if (this.status === "recording" || this.status === "paused") {
      this.elapsedBeforePause = this.elapsedMs();
      this.status = "interrupted";
      await this.persistState(this.elapsedBeforePause).catch(() => undefined);
    }
    await this.plugin.shutdown?.();
    window.studio?.setRecordingCloseProtection?.(false);
  }

  private elapsedMs() {
    if (this.status === "recording") return this.elapsedBeforePause + (Date.now() - this.startedAt);
    return this.elapsedBeforePause;
  }

  private startStateTimer() {
    this.stopStateTimer();
    this.stateTimer = window.setInterval(() => {
      void this.persistState();
    }, 3000);
  }

  private stopStateTimer() {
    if (this.stateTimer) window.clearInterval(this.stateTimer);
    this.stateTimer = undefined;
  }

  private startStartupHealthGate() {
    this.stopStartupHealthGate();
    if (this.session?.practice) return;
    const remainingMs = Math.max(0, FIRST_CHUNK_TIMEOUT_MS - this.elapsedMs());
    this.startupHealthTimer = window.setTimeout(() => {
      void this.enforceStartupHealth();
    }, remainingMs);
  }

  private stopStartupHealthGate() {
    if (this.startupHealthTimer) window.clearTimeout(this.startupHealthTimer);
    this.startupHealthTimer = undefined;
  }

  private async enforceStartupHealth() {
    this.startupHealthTimer = undefined;
    if (this.status !== "recording" || !this.session) return;
    const health = this.plugin.getHealth?.();
    if (!health) return;
    // The Program file is the recoverable episode master and remains mandatory.
    // Extra isolated camera/mic tracks may warn, but an unused or unavailable
    // optional source must not kill an otherwise healthy Program recording.
    const program = health.sources.find((source) => source.target === "program");
    if (program?.firstChunkReceived) return;

    const message = "Recording stopped safely because the program did not write media. Check Camera 1 and run Quick Test again.";
    await this.stop();
    this.friendlyError = message;
    if (this.integrity) {
      this.integrity = {
        ...this.integrity,
        playable: false,
        warnings: [...this.integrity.warnings, message]
      };
    }
    await Promise.resolve(window.studio.appendRecordingError(this.session.folderPath, message)).catch(() => undefined);
    await this.persistState().catch(() => undefined);
  }

  private async persistState(elapsedMs = this.elapsedMs()) {
    if (!this.session) return;
    const state: RecordingState = {
      ...createInitialRecordingState(this.session.id),
      status: this.status,
      elapsedMs
    };
    await window.studio.writeRecordingState(this.session.folderPath, state);
  }
}

const FIRST_CHUNK_TIMEOUT_MS = 8000;

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function logRecordingEvent(level: "info" | "warning" | "error", message: string, details?: Record<string, unknown>) {
  void window.studio?.writeRuntimeLog?.({ level, source: "RecordingService", message, details }).catch(() => undefined);
}

export function formatRecordingTime(elapsedMs: number) {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}
