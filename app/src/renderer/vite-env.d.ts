/// <reference types="vite/client" />

import type { EpisodeMetadata, StudioSettings } from "../shared/types";
import type { RecordingSession, RecordingSessionCreateInput, RecordingState, RecordingTrackSaveInput, RecordingTrackSaveResult } from "../shared/recording";
import type { PodcastToolsState } from "../shared/podcast-tools";
import type { TimelineDraft } from "../shared/timeline";
import type { ExportJob, ExportRequest, MediaToolsStatus } from "../shared/export";
import type { AutoEditLearningProfile, AutoEditMode, AutoEditResult } from "../shared/auto-edit";
import type { DiagnosticsBundleRequest, DiagnosticsBundleResult, StorageStatus } from "../shared/diagnostics";
import type { ReviewMediaImportProgress, ReviewMediaImportResult, ReviewMediaImportSlot, ReviewMediaIntegrityResult, ReviewMediaInventory, ReviewMediaSyncResult, ReviewMediaTreatmentPreview } from "../shared/review-media";
import type { EpisodeCleanupScope, EpisodeStorageSummary } from "../shared/episode-maintenance";
import type { StudioDisplayInfo, StudioLayoutProfileId, StudioPanelId, StudioWindowState, StudioWorkspaceState } from "../shared/studio-workspace";
import type { AppUpdateStatus } from "../shared/app-update";
import type { LocalTranscriptionProgress, LocalTranscriptionResult, LocalTranscriptionStatus } from "../shared/local-transcription";

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
      saveRecordedTracks: (folderPath: string, tracks: RecordingTrackSaveInput[]) => Promise<RecordingTrackSaveResult[]>;
      appendRecordingError: (folderPath: string, message: string) => Promise<void>;
      listUnfinishedRecordingSessions: () => Promise<RecordingSession[]>;
      loadPodcastTools: (episodeId: string) => Promise<PodcastToolsState>;
      savePodcastTools: (episodeId: string, state: PodcastToolsState) => Promise<PodcastToolsState>;
      loadTimelineDraft: (episodeId: string) => Promise<TimelineDraft | null>;
      saveTimelineDraft: (episodeId: string, draft: TimelineDraft) => Promise<TimelineDraft>;
      getLocalTranscriptionStatus?: () => Promise<LocalTranscriptionStatus>;
      transcribeEpisodeLocally?: (episodeId: string) => Promise<LocalTranscriptionResult>;
      cancelLocalTranscription?: (episodeId: string) => Promise<boolean>;
      onLocalTranscriptionProgress?: (listener: (progress: LocalTranscriptionProgress) => void) => () => void;
      loadReviewMedia: (episodeId: string) => Promise<ReviewMediaInventory>;
      importReviewMedia?: (episodeId: string, slot: ReviewMediaImportSlot) => Promise<ReviewMediaImportResult>;
      cancelReviewMediaImport?: (episodeId: string, slot: ReviewMediaImportSlot) => Promise<boolean>;
      onReviewMediaImportProgress?: (listener: (progress: ReviewMediaImportProgress) => void) => () => void;
      autoSyncReviewMedia?: (episodeId: string) => Promise<ReviewMediaSyncResult>;
      verifyReviewMediaOriginals?: (episodeId: string) => Promise<ReviewMediaIntegrityResult>;
      relinkReviewMedia?: (episodeId: string, slot: ReviewMediaImportSlot) => Promise<ReviewMediaImportResult>;
      getEpisodeStorageSummary?: (episodeId: string) => Promise<EpisodeStorageSummary>;
      cleanupEpisodeStorage?: (episodeId: string, scope: EpisodeCleanupScope) => Promise<EpisodeStorageSummary>;
      renderTrackTreatmentPreview?: (episodeId: string, draft: TimelineDraft, trackId: string, timestampMs: number) => Promise<ReviewMediaTreatmentPreview>;
      runAutoEdit: (episodeId: string, draft: TimelineDraft, mode: AutoEditMode, practice?: boolean, learningProfile?: AutoEditLearningProfile) => Promise<AutoEditResult>;
      createExport: (request: ExportRequest) => Promise<ExportJob>;
      onExportProgress?: (listener: (job: ExportJob) => void) => () => void;
      getMediaToolsStatus: () => Promise<MediaToolsStatus>;
      cancelExport: (episodeId: string, job: ExportJob) => Promise<ExportJob>;
      openExportFolder: (episodeId: string) => Promise<string>;
      createDiagnosticsBundle: (input: DiagnosticsBundleRequest) => Promise<DiagnosticsBundleResult>;
      getStorageStatus: () => Promise<StorageStatus>;
      getWorkspaceState?: () => Promise<StudioWorkspaceState>;
      saveWorkspaceState?: (state: StudioWorkspaceState) => Promise<StudioWorkspaceState>;
      getDisplays?: () => Promise<StudioDisplayInfo[]>;
      openWorkspacePanel?: (
        panelId: StudioPanelId,
        input?: {
          episodeId?: string;
          displayId?: number;
          fullscreen?: boolean;
        }
      ) => Promise<StudioWindowState>;
      closeWorkspacePanel?: (panelId: StudioPanelId) => Promise<StudioWindowState>;
      moveWorkspacePanel?: (panelId: StudioPanelId, displayId: number) => Promise<StudioWindowState>;
      applyWorkspaceLayout?: (layoutId: StudioLayoutProfileId, episodeId?: string) => Promise<StudioWorkspaceState>;
      resetWorkspaceLayout?: () => Promise<StudioWorkspaceState>;
      getAppUpdateStatus?: () => Promise<AppUpdateStatus>;
      checkForAppUpdate?: () => Promise<AppUpdateStatus>;
      downloadAppUpdate?: () => Promise<AppUpdateStatus>;
      installAppUpdate?: () => Promise<boolean>;
      onAppUpdateStatus?: (listener: (status: AppUpdateStatus) => void) => () => void;
    };
  }
}
