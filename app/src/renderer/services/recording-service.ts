import { setRuntimeDiagnosticContext, writeRuntimeDiagnostic } from "./runtime-diagnostics";
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
  resume?: boolean;
}

export class RecordingService {
  private status: RecordingStatus = "idle";
  private session?: RecordingSession;
  private startedAt = 0;
  private elapsedBeforePause = 0;
  private stateTimer?: number;
  private startupHealthTimer?: number;
  private friendlyError?: string;
  private lastHealthLogAt = 0;
  private trackStatuses: RecordingTrackSaveResult[] = [];
  private integrity?: RecordingIntegrityReport;
  private stopPromise?: Promise<RecordingServiceSnapshot>;
  private deviceDefaults?: DeviceDefaults;
  private stateWrites: Promise<unknown> = Promise.resolve();
  private starting?: Promise<RecordingServiceSnapshot>;

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
        ? this.integrity.playable && this.integrity.warnings.length === 0 ? "Recording saved and verified" : "Recording saved with items that need attention"
        : this.status === "paused" && this.session?.durablePaused
          ? "Episode saved. You can close the app and resume this recording later"
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

  hasActiveCapture() { return Boolean(this.starting || this.stopPromise) || this.status === "recording"; }

  selectEpisode(episodeId: string) {
    if (this.hasActiveCapture()) throw new Error("Pause and save the active episode first.");
    if (this.session?.episodeId !== episodeId) {
      this.session = undefined;
      this.status = "idle";
      this.elapsedBeforePause = 0;
      this.trackStatuses = [];
      this.integrity = undefined;
      this.friendlyError = undefined;
    }
    return this.getSnapshot();
  }

  async start(deviceDefaults: DeviceDefaults, options: RecordingStartOptions = {}) {
    if (this.starting) return this.starting;
    if (this.stopPromise) return this.stopPromise;
    const pending = this.startCapture(deviceDefaults, options);
    this.starting = pending;
    try { return await pending; } finally { if (this.starting === pending) this.starting = undefined; }
  }

  private async startCapture(deviceDefaults: DeviceDefaults, options: RecordingStartOptions) {
    if (this.status === "recording" || (this.status === "paused" && !this.session?.durablePaused)) return this.getSnapshot();
    if (this.status === "paused" && this.session?.episodeId === options.episodeId) options = { ...options, resume: true };

    this.session = undefined;
    this.elapsedBeforePause = 0;
    this.trackStatuses = [];
    this.integrity = undefined;
    setRuntimeDiagnosticContext({ episodeId: options.episodeId, recordingStatus: "starting" });
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
        backupFolderPath: options.backupFolderPath,
        resume: options.resume
      });
      setRuntimeDiagnosticContext({ episodeId: this.session.episodeId, sessionId: this.session.id,
        capturePart: this.session.captureFolderPath?.split(/[\\/]/).pop(), recordingStatus: "starting" });
      await this.plugin.start({ deviceDefaults, practice: options.practice, session: this.session });
      this.status = "recording";
      this.startedAt = performance.now();
      this.elapsedBeforePause = this.session.elapsedMs ?? 0;
      this.deviceDefaults = deviceDefaults;
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
      this.friendlyError = message.includes("already contains recording media")
        ? "This episode already has a recording. Create a new episode before recording so the existing episode stays protected."
        : message.includes("Camera needs attention")
        ? friendlyRecordingError("camera")
        : message.includes("Mic needs attention")
        ? friendlyRecordingError("mic")
        : friendlyRecordingError("device");
      if (this.session) { try { await this.plugin.stop(); } catch { /* Preserve startup recovery. */ } }
      if (this.session?.captureFolderPath && window.studio.checkpointRecordingSession) {
        try {
          const checkpoint = await window.studio.checkpointRecordingSession(this.session.folderPath, true);
          this.session = checkpoint.session;
          this.status = "paused";
          this.elapsedBeforePause = checkpoint.session.elapsedMs ?? this.elapsedBeforePause;
        } catch { /* Keep partial media available through recovery. */ }
      }
      this.stopStateTimer();
      if (this.session) await this.appendErrorSafely(`${this.friendlyError} Startup detail: ${message}`);
      await this.persistState().catch(() => undefined);
      window.studio?.setRecordingCloseProtection?.(false);
      logRecordingEvent("error", "Recording start failed.", { error: message, sessionId: this.session?.id });
    }

    return this.getSnapshot();
  }

  async pause() {
    if (this.starting) await this.starting;
    if (this.status !== "recording") return this.getSnapshot();
    if (this.session?.captureFolderPath && window.studio.checkpointRecordingSession && !this.session.practice) return this.finishCapture(true);
    this.stopStartupHealthGate();
    await this.plugin.pause();
    this.elapsedBeforePause = this.elapsedMs();
    this.status = "paused";
    await this.persistState();
    logRecordingEvent("info", "Recording paused.", { sessionId: this.session?.id, elapsedMs: this.elapsedBeforePause });
    return this.getSnapshot();
  }

  async resume() {
    if (this.status === "stopped" && this.session?.captureFolderPath && this.deviceDefaults) return this.resumeSaved(this.session, this.deviceDefaults);
    if (this.status !== "paused") return this.getSnapshot();
    if (this.session?.durablePaused && this.deviceDefaults) return this.resumeSaved(this.session, this.deviceDefaults);
    await this.plugin.resume();
    this.startedAt = performance.now();
    this.status = "recording";
    await this.persistState();
    this.startStartupHealthGate();
    logRecordingEvent("info", "Recording resumed.", { sessionId: this.session?.id, elapsedMs: this.elapsedBeforePause });
    return this.getSnapshot();
  }

  async resumeSaved(session: RecordingSession, defaults: DeviceDefaults) {
    if (this.status === "recording") throw new Error("Pause the active episode before opening another recording.");
    return this.start(defaults, { episodeId: session.episodeId, episodeTitle: session.episodeTitle, resume: true });
  }

  restorePaused(session: RecordingSession) {
    if (this.hasActiveCapture()) throw new Error("Pause and save the active episode first.");
    this.session = session;
    this.status = "paused";
    this.elapsedBeforePause = session.elapsedMs ?? 0;
    this.friendlyError = undefined;
    this.integrity = undefined;
    this.trackStatuses = [];
    return this.getSnapshot();
  }

  async stop() {
    if (this.starting) await this.starting;
    return this.finishCapture(false);
  }

  private async finishCapture(paused: boolean) {
    if (this.stopPromise) return this.stopPromise;
    const stopPromise = this.stopActiveSession(paused);
    this.stopPromise = stopPromise;
    try {
      return await stopPromise;
    } finally {
      if (this.stopPromise === stopPromise) this.stopPromise = undefined;
    }
  }

  private async stopActiveSession(paused = false) {
    if (!this.session || (this.status !== "recording" && this.status !== "paused" && this.status !== "error")) return this.getSnapshot();
    const session = this.session;
    const finalElapsed = this.elapsedMs();
    this.stopStartupHealthGate();
    this.stopStateTimer();
    logRecordingEvent("info", "Stop requested; flushing browser recorders.", { sessionId: session.id, elapsedMs: finalElapsed });

    try {
      await this.stateWrites.catch(() => undefined);
      if (session.captureFolderPath && window.studio.checkpointRecordingSession && !session.practice) {
        const stopped = session.durablePaused ? undefined : await this.plugin.stop();
        const captureWarnings = [...(stopped?.warning ? [stopped.warning] : []), ...(stopped?.tracks ?? []).filter((track) => track.status && track.status !== "saved").map((track) => `${track.slot}: ${track.message ?? "Source needs attention"}`)];
        const checkpoint = await window.studio.checkpointRecordingSession(session.folderPath, paused, captureWarnings);
        this.session = checkpoint.session;
        this.elapsedBeforePause = checkpoint.session.elapsedMs ?? finalElapsed;
        this.status = paused ? "paused" : "stopped";
        this.integrity = checkpoint.result?.integrity;
        this.trackStatuses = checkpoint.result?.tracks ?? [];
        this.friendlyError = undefined;
        await this.persistState();
        window.studio?.setRecordingCloseProtection?.(false);
        return this.getSnapshot();
      }
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
      try { await this.plugin.pause(); } catch { /* Preserve the original save failure. */ }
      this.elapsedBeforePause = finalElapsed;
      this.status = "error";
      this.friendlyError = "The recording stopped, but some files still need recovery.";
      await this.appendErrorSafely(`${this.friendlyError} ${String(error)}`);
      await this.persistState(finalElapsed).catch(() => undefined);
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
    if (this.starting) await this.starting.catch(() => undefined);
    if (this.stopPromise) await this.stopPromise.catch(() => undefined);
    this.stopStateTimer();
    this.stopStartupHealthGate();
    if (this.status === "recording" || (this.status === "paused" && !this.session?.durablePaused)) {
      this.elapsedBeforePause = this.elapsedMs();
      this.status = "interrupted";
      await this.persistState(this.elapsedBeforePause).catch(() => undefined);
    }
    try { await this.plugin.shutdown?.(); }
    finally { window.studio?.setRecordingCloseProtection?.(false); }
  }

  private elapsedMs() {
    if (this.status === "recording") return this.elapsedBeforePause + (performance.now() - this.startedAt);
    return this.elapsedBeforePause;
  }

  private startStateTimer() {
    this.stopStateTimer();
    this.stateTimer = window.setInterval(() => {
      const health = this.plugin.getHealth?.();
      const fatalError = health?.fatalError;
      if (health && Date.now() - this.lastHealthLogAt >= 15000) {
        this.lastHealthLogAt = Date.now();
        logRecordingEvent(fatalError ? "error" : "info", "Recording source health summary.", { sessionId: this.session?.id,
          episodeId: this.session?.episodeId, elapsedMs: this.elapsedMs(), status: this.status, health });
      }
      if (fatalError && this.status === "recording") {
        logRecordingEvent("error", "Recording paused by capture protection.", { episodeId: this.session?.episodeId,
          sessionId: this.session?.id, elapsedMs: this.elapsedMs(), reason: fatalError, health });
        void this.pause().then(() => { this.friendlyError = fatalError; }).catch(() => { this.friendlyError = fatalError; });
      } else void this.persistState().catch(() => undefined);
    }, 3000);
  }

  private stopStateTimer() {
    if (this.stateTimer) window.clearInterval(this.stateTimer);
    this.stateTimer = undefined;
  }

  private startStartupHealthGate() {
    this.stopStartupHealthGate();
    if (this.session?.practice) return;
    const remainingMs = Math.max(0, FIRST_CHUNK_TIMEOUT_MS - (performance.now() - this.startedAt));
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

  private async appendErrorSafely(message: string) {
    if (!this.session) return;
    try { await window.studio.appendRecordingError(this.session.folderPath, message); }
    catch (error) { logRecordingEvent("error", "Recording error file could not be written.", { error, originalMessage: message }); }
  }

  private async persistState(elapsedMs = this.elapsedMs()) {
    if (!this.session) return;
    const state: RecordingState = {
      ...createInitialRecordingState(this.session.id),
      status: this.status,
      elapsedMs
    };
    const folder = this.session.folderPath;
    const next = this.stateWrites.catch(() => undefined).then(() => window.studio.writeRecordingState(folder, state));
    this.stateWrites = next;
    try { await next; }
    catch (error) { logRecordingEvent("warning", "Recording state file could not be written.", { error, status: this.status }); throw error; }
  }
}

const FIRST_CHUNK_TIMEOUT_MS = 8000;

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function logRecordingEvent(level: "info" | "warning" | "error", message: string, details?: Record<string, unknown>) {
  writeRuntimeDiagnostic(level, "RecordingService", message, details);
}

export function formatRecordingTime(elapsedMs: number) {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}
