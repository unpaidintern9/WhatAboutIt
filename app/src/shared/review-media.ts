export type ReviewMediaKind = "program" | "camera" | "audio";
export type ReviewMediaStatus = "ready" | "missing" | "needs-proxy" | "error";

export interface ReviewMediaAsset {
  id: string;
  label: string;
  kind: ReviewMediaKind;
  relativePath: string;
  filePath?: string;
  playbackUrl?: string;
  status: ReviewMediaStatus;
  durationMs?: number;
  sizeBytes?: number;
  codecSummary?: string;
  message: string;
}

export interface ReviewMediaInventory {
  episodeId: string;
  episodeFolder: string;
  loadedAt: string;
  program: ReviewMediaAsset;
  cameras: ReviewMediaAsset[];
  audio: ReviewMediaAsset[];
  hasPlayableProgram: boolean;
  message: string;
}
