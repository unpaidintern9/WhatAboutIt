import type { RecordingEnginePlugin, RecordingEngineResult, RecordingStartRequest } from "./types";

export class HiddenObsControlPlugin implements RecordingEnginePlugin {
  async start(_request: RecordingStartRequest) {
    throw new Error("OBS recording engine is not connected yet.");
  }

  async pause() {
    throw new Error("OBS recording engine is not connected yet.");
  }

  async resume() {
    throw new Error("OBS recording engine is not connected yet.");
  }

  async stop(): Promise<RecordingEngineResult> {
    throw new Error("OBS recording engine is not connected yet.");
  }
}
