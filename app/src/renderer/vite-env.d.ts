/// <reference types="vite/client" />

import type { EpisodeMetadata, StudioSettings } from "../shared/types";
import type { RecordingSession, RecordingSessionCreateInput, RecordingState } from "../shared/recording";
import type { PodcastToolsState } from "../shared/podcast-tools";
import type { TimelineDraft } from "../shared/timeline";
import type { ExportJob, ExportRequest, MediaToolsStatus } from "../shared/export";
import type { AutoEditMode, AutoEditResult } from "../shared/auto-edit";
import type { DiagnosticsBundleRequest, DiagnosticsBundleResult, StorageStatus } from "../shared/diagnostics";

declare global {
  interface Window {
    studio: {
      listEpisodes: () => Promise<EpisodeMetadata[]>;
      createEpisode: (input: { title: string; guestName?: string; description?: string }) => Promise<EpisodeMetadata>;
      getSettings: () => Promise<StudioSettings>;
      saveSettings: (settings: StudioSettings) => Promise<StudioSettings>;
      createRecordingSession: (input: RecordingSessionCreateInput) => Promise<RecordingSession>;
      writeRecordingState: (folderPath: string, state: RecordingState) => Promise<RecordingState>;
      saveProgramRecording: (folderPath: string, bytes: Uint8Array) => Promise<string>;
      appendRecordingError: (folderPath: string, message: string) => Promise<void>;
      listUnfinishedRecordingSessions: () => Promise<RecordingSession[]>;
      loadPodcastTools: (episodeId: string) => Promise<PodcastToolsState>;
      savePodcastTools: (episodeId: string, state: PodcastToolsState) => Promise<PodcastToolsState>;
      loadTimelineDraft: (episodeId: string) => Promise<TimelineDraft | null>;
      saveTimelineDraft: (episodeId: string, draft: TimelineDraft) => Promise<TimelineDraft>;
      runAutoEdit: (episodeId: string, draft: TimelineDraft, mode: AutoEditMode, practice?: boolean) => Promise<AutoEditResult>;
      createExport: (request: ExportRequest) => Promise<ExportJob>;
      getMediaToolsStatus: () => Promise<MediaToolsStatus>;
      cancelExport: (episodeId: string, job: ExportJob) => Promise<ExportJob>;
      openExportFolder: (episodeId: string) => Promise<string>;
      createDiagnosticsBundle: (input: DiagnosticsBundleRequest) => Promise<DiagnosticsBundleResult>;
      getStorageStatus: () => Promise<StorageStatus>;
    };
  }
}
