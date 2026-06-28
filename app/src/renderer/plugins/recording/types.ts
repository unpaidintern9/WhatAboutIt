import type { DeviceDefaults } from "../../../shared/types";
import type { RecordingTrackSaveInput } from "../../../shared/recording";

export interface RecordingStartRequest {
  deviceDefaults: DeviceDefaults;
  practice?: boolean;
}

export interface RecordingEngineResult {
  bytes?: Uint8Array;
  mimeType?: string;
  tracks?: RecordingTrackSaveInput[];
  warning?: string;
}

export interface RecordingEnginePlugin {
  start: (request: RecordingStartRequest) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<RecordingEngineResult>;
  shutdown?: () => Promise<void>;
}
