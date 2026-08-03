export type ReviewMediaKind = "program" | "camera" | "audio";
export type ReviewMediaStatus = "ready" | "missing" | "needs-proxy" | "error";

export interface ReviewMediaAsset {
  id: string;
  label: string;
  kind: ReviewMediaKind;
  relativePath: string;
  filePath?: string;
  playbackUrl?: string;
  reviewProxyPath?: string;
  status: ReviewMediaStatus;
  durationMs?: number;
  sizeBytes?: number;
  codecSummary?: string;
  pairedAudioId?: string;
  pairedAudioLabel?: string;
  includesPairedAudio?: boolean;
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
