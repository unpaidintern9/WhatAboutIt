import type { DeviceDefaults } from "../../../shared/types";

export interface RecordingStartRequest {
  deviceDefaults: DeviceDefaults;
  practice?: boolean;
}

export interface RecordingEngineResult {
  bytes?: number[];
  mimeType?: string;
  warning?: string;
}

export interface RecordingEnginePlugin {
  start: (request: RecordingStartRequest) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<RecordingEngineResult>;
}

