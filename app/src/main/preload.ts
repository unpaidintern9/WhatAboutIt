import { contextBridge, ipcRenderer } from "electron";
import type { EpisodeMetadata, StudioSettings } from "../shared/types";
import type { RecordingSession, RecordingSessionCreateInput, RecordingState } from "../shared/recording";
import type { PodcastToolsState } from "../shared/podcast-tools";
import type { TimelineDraft } from "../shared/timeline";

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
  saveProgramRecording: (folderPath: string, bytes: number[]): Promise<string> =>
    ipcRenderer.invoke("recording:save-program", { folderPath, bytes }),
  appendRecordingError: (folderPath: string, message: string): Promise<void> =>
    ipcRenderer.invoke("recording:append-error", { folderPath, message }),
  listUnfinishedRecordingSessions: (): Promise<RecordingSession[]> => ipcRenderer.invoke("recording:list-unfinished"),
  loadPodcastTools: (episodeId: string): Promise<PodcastToolsState> => ipcRenderer.invoke("podcast-tools:load", episodeId),
  savePodcastTools: (episodeId: string, state: PodcastToolsState): Promise<PodcastToolsState> =>
    ipcRenderer.invoke("podcast-tools:save", { episodeId, state }),
  loadTimelineDraft: (episodeId: string): Promise<TimelineDraft | null> => ipcRenderer.invoke("timeline:load", episodeId),
  saveTimelineDraft: (episodeId: string, draft: TimelineDraft): Promise<TimelineDraft> =>
    ipcRenderer.invoke("timeline:save", { episodeId, draft })
});
