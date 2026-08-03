import { contextBridge, ipcRenderer } from "electron";
import type { EpisodeMetadata, StudioSettings } from "../shared/types";
import type { RecordingSession, RecordingSessionCreateInput, RecordingState, RecordingTrackSaveInput, RecordingTrackSaveResult } from "../shared/recording";
import type { PodcastToolsState } from "../shared/podcast-tools";
import type { TimelineDraft } from "../shared/timeline";
import type { ExportJob, ExportRequest, MediaToolsStatus } from "../shared/export";
import type { AutoEditMode, AutoEditResult } from "../shared/auto-edit";
import type { DiagnosticsBundleRequest, DiagnosticsBundleResult, StorageStatus } from "../shared/diagnostics";
import type { ReviewMediaInventory } from "../shared/review-media";
import type { StudioDisplayInfo, StudioLayoutProfileId, StudioPanelId, StudioWindowState, StudioWorkspaceState } from "../shared/studio-workspace";

contextBridge.exposeInMainWorld("studio", {
  listEpisodes: (): Promise<EpisodeMetadata[]> => ipcRenderer.invoke("episodes:list"),
  createEpisode: (input: { title: string; guestName?: string; description?: string }): Promise<EpisodeMetadata> =>
    ipcRenderer.invoke("episodes:create", input),
  getSettings: (): Promise<StudioSettings> => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: StudioSettings): Promise<StudioSettings> => ipcRenderer.invoke("settings:save", settings),
  createRecordingSession: (input: RecordingSessionCreateInput): Promise<RecordingSession> =>
    ipcRenderer.invoke("recording:create-session", input),
  writeRecordingState: (folderPath: string, state: RecordingState): Promise<RecordingState> =>
    ipcRenderer.invoke("recording:write-state", { folderPath, state }),
  saveProgramRecording: (folderPath: string, bytes: Uint8Array): Promise<string> =>
    ipcRenderer.invoke("recording:save-program", { folderPath, bytes }),
  saveRecordedTracks: (folderPath: string, tracks: RecordingTrackSaveInput[]): Promise<RecordingTrackSaveResult[]> =>
    ipcRenderer.invoke("recording:save-tracks", { folderPath, tracks }),
  appendRecordingError: (folderPath: string, message: string): Promise<void> =>
    ipcRenderer.invoke("recording:append-error", { folderPath, message }),
  listUnfinishedRecordingSessions: (): Promise<RecordingSession[]> => ipcRenderer.invoke("recording:list-unfinished"),
  loadPodcastTools: (episodeId: string): Promise<PodcastToolsState> => ipcRenderer.invoke("podcast-tools:load", episodeId),
  savePodcastTools: (episodeId: string, state: PodcastToolsState): Promise<PodcastToolsState> =>
    ipcRenderer.invoke("podcast-tools:save", { episodeId, state }),
  loadTimelineDraft: (episodeId: string): Promise<TimelineDraft | null> => ipcRenderer.invoke("timeline:load", episodeId),
  saveTimelineDraft: (episodeId: string, draft: TimelineDraft): Promise<TimelineDraft> =>
    ipcRenderer.invoke("timeline:save", { episodeId, draft }),
  loadReviewMedia: (episodeId: string): Promise<ReviewMediaInventory> => ipcRenderer.invoke("review-media:load", episodeId),
  runAutoEdit: (episodeId: string, draft: TimelineDraft, mode: AutoEditMode, practice?: boolean): Promise<AutoEditResult> =>
    ipcRenderer.invoke("auto-edit:run", { episodeId, draft, mode, practice }),
  createExport: (request: ExportRequest): Promise<ExportJob> => ipcRenderer.invoke("export:create", request),
  onExportProgress: (listener: (job: ExportJob) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, job: ExportJob) => listener(job);
    ipcRenderer.on("export:progress", handler);
    return () => ipcRenderer.removeListener("export:progress", handler);
  },
  getMediaToolsStatus: (): Promise<MediaToolsStatus> => ipcRenderer.invoke("export:media-tools-status"),
  cancelExport: (episodeId: string, job: ExportJob): Promise<ExportJob> =>
    ipcRenderer.invoke("export:cancel", { episodeId, job }),
  openExportFolder: (episodeId: string): Promise<string> => ipcRenderer.invoke("export:open-folder", episodeId),
  createDiagnosticsBundle: (input: DiagnosticsBundleRequest): Promise<DiagnosticsBundleResult> =>
    ipcRenderer.invoke("diagnostics:create", input),
  getStorageStatus: (): Promise<StorageStatus> => ipcRenderer.invoke("storage:status"),
  getWorkspaceState: (): Promise<StudioWorkspaceState> => ipcRenderer.invoke("workspace:get-state"),
  saveWorkspaceState: (state: StudioWorkspaceState): Promise<StudioWorkspaceState> => ipcRenderer.invoke("workspace:save-state", state),
  getDisplays: (): Promise<StudioDisplayInfo[]> => ipcRenderer.invoke("workspace:get-displays"),
  openWorkspacePanel: (panelId: StudioPanelId, input?: { episodeId?: string; displayId?: number; fullscreen?: boolean }): Promise<StudioWindowState> =>
    ipcRenderer.invoke("workspace:open-panel", { panelId, ...input }),
  closeWorkspacePanel: (panelId: StudioPanelId): Promise<StudioWindowState> => ipcRenderer.invoke("workspace:close-panel", panelId),
  moveWorkspacePanel: (panelId: StudioPanelId, displayId: number): Promise<StudioWindowState> =>
    ipcRenderer.invoke("workspace:move-panel", { panelId, displayId }),
  applyWorkspaceLayout: (layoutId: StudioLayoutProfileId, episodeId?: string): Promise<StudioWorkspaceState> =>
    ipcRenderer.invoke("workspace:apply-layout", { layoutId, episodeId }),
  resetWorkspaceLayout: (): Promise<StudioWorkspaceState> => ipcRenderer.invoke("workspace:reset-layout")
});
