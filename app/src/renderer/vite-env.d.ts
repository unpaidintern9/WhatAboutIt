/// <reference types="vite/client" />

import type { EpisodeMetadata, StudioSettings } from "../shared/types";
import type { RecordingSession, RecordingSessionCreateInput, RecordingState } from "../shared/recording";

declare global {
  interface Window {
    studio: {
      listEpisodes: () => Promise<EpisodeMetadata[]>;
      createEpisode: (input: { title: string; guestName?: string; description?: string }) => Promise<EpisodeMetadata>;
      getSettings: () => Promise<StudioSettings>;
      saveSettings: (settings: StudioSettings) => Promise<StudioSettings>;
      createRecordingSession: (input: RecordingSessionCreateInput) => Promise<RecordingSession>;
      writeRecordingState: (folderPath: string, state: RecordingState) => Promise<RecordingState>;
      saveProgramRecording: (folderPath: string, bytes: number[]) => Promise<string>;
      appendRecordingError: (folderPath: string, message: string) => Promise<void>;
      listUnfinishedRecordingSessions: () => Promise<RecordingSession[]>;
    };
  }
}
