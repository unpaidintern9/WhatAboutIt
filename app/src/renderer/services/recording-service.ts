import type { DeviceDefaults } from "../../shared/types";
import type { RecordingSession, RecordingState, RecordingStatus, RecordingTrackSaveResult } from "../../shared/recording";
import { createInitialRecordingState, friendlyRecordingError } from "../../shared/recording";
import type { RecordingEngineHealth, RecordingEnginePlugin } from "../plugins/recording/types";

export interface RecordingServiceSnapshot {
  status: RecordingStatus;
  elapsedMs: number;
  session?: RecordingSession;
  friendlyError?: string;
  localSaveMessage: string;
  trackStatuses: RecordingTrackSaveResult[];
  health?: RecordingEngineHealth;
}

export interface RecordingStartOptions {
  episodeId?: string;
  episodeTitle?: string;
  practice?: boolean;
}

export class RecordingService {
  private status: RecordingStatus = "idle";
  private session?: RecordingSession;
  private startedAt = 0;
  private elapsedBeforePause = 0;
  private stateTimer?: number;
  private friendlyError?: string;
  private trackStatuses: RecordingTrackSaveResult[] = [];

  constructor(private readonly plugin: RecordingEnginePlugin) {}

  getSnapshot(): RecordingServiceSnapshot {
    const health = this.plugin.getHealth?.();
    const activeSources = (health?.activeCameraTracks ?? 0) + (health?.activeAudioTracks ?? 0);
    const expectedSources = (health?.expectedCameraTracks ?? 0) + (health?.expectedAudioTracks ?? 0);
    const missingSources = Math.max(0, expectedSources - activeSources);
    const localSaveMessage = (this.status === "recording" || this.status === "paused") && health
      ? health.warnings.length > 0 || missingSources > 0
        ? `${activeSources} source tracks recording; ${Math.max(health.warnings.length, missingSources)} need attention`
        : `Program plus ${activeSources} source tracks are actively recording`
      : "Everything is saving locally";
    return {
      status: this.status,
      elapsedMs: this.elapsedMs(),
      session: this.session,
      friendlyError: this.friendlyError,
      localSaveMessage,
      trackStatuses: this.trackStatuses,
      health
    };
  }

  async start(deviceDefaults: DeviceDefaults, options: RecordingStartOptions = {}) {
    if (this.status === "recording" || this.status === "paused") return this.getSnapshot();

    try {
      this.session = await window.studio.createRecordingSession({
        deviceDefaults,
        episodeId: options.episodeId,
        episodeTitle: options.episodeTitle ?? (options.practice ? "Practice Recording" : "Studio Recording"),
        practice: options.practice
      });
      await this.plugin.start({ deviceDefaults, practice: options.practice });
      this.status = "recording";
      this.startedAt = Date.now();
      this.elapsedBeforePause = 0;
      this.friendlyError = undefined;
      this.trackStatuses = [];
      await this.persistState();
      this.startStateTimer();
    } catch (error) {
      this.status = "error";
      const message = String(error);
      this.friendlyError = message.includes("Camera needs attention")
        ? friendlyRecordingError("camera")
        : message.includes("Mic needs attention")
        ? friendlyRecordingError("mic")
        : friendlyRecordingError("device");
      if (this.session) await window.studio.appendRecordingError(this.session.folderPath, this.friendlyError);
    }

    return this.getSnapshot();
  }

  async pause() {
    if (this.status !== "recording") return this.getSnapshot();
    await this.plugin.pause();
    this.elapsedBeforePause = this.elapsedMs();
    this.status = "paused";
    await this.persistState();
    return this.getSnapshot();
  }

  async resume() {
    if (this.status !== "paused") return this.getSnapshot();
    await this.plugin.resume();
    this.startedAt = Date.now();
    this.status = "recording";
    await this.persistState();
    return this.getSnapshot();
  }

  async stop() {
    if (!this.session || (this.status !== "recording" && this.status !== "paused")) return this.getSnapshot();
    const session = this.session;
    const finalElapsed = this.elapsedMs();
    this.stopStateTimer();
    const result = await this.plugin.stop();

    if (result.bytes && result.bytes.length > 0) {
      await window.studio.saveProgramRecording(session.folderPath, result.bytes);
    }
    if (result.tracks?.length) {
      this.trackStatuses = await window.studio.saveRecordedTracks(session.folderPath, result.tracks);
    }

    this.elapsedBeforePause = finalElapsed;
    this.status = "stopped";
    await this.persistState(finalElapsed);
    return this.getSnapshot();
  }

  async shutdown() {
    this.stopStateTimer();
    await this.plugin.shutdown?.();
    if (this.status === "recording" || this.status === "paused") {
      this.elapsedBeforePause = this.elapsedMs();
      this.status = "idle";
    }
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

export function formatRecordingTime(elapsedMs: number) {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}
