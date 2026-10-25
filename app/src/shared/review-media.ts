export type ReviewMediaKind = "program" | "camera" | "audio";
export type ReviewMediaStatus = "ready" | "missing" | "needs-proxy" | "error";
export type ReviewMediaImportSlot = "camera-1" | "camera-2" | "camera-3" | "morgan-mic" | "guest-mic" | "extra-mic";

export interface ReviewMediaAsset {
  id: string;
  label: string;
  kind: ReviewMediaKind;
  relativePath: string;
  filePath?: string;
  originalFilePath?: string;
  playbackUrl?: string;
  posterUrl?: string;
  waveformUrl?: string;
  filmstripUrl?: string;
  reviewProxyPath?: string;
  status: ReviewMediaStatus;
  durationMs?: number;
  captureOffsetMs?: number;
  sizeBytes?: number;
  sourceVersion?: string;
  codecSummary?: string;
  hasAudio?: boolean;
  audioSignal?: "audible" | "silent" | "unknown";
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

export interface ReviewMediaUpdate {
  episodeId: string;
  asset: ReviewMediaAsset;
}

export interface PreparedReviewAudio {
  trackId: string;
  sourceAssetId: string;
  signature: string;
  playbackUrl: string;
}

export function applyReviewMediaUpdate(current: ReviewMediaInventory | undefined, update: ReviewMediaUpdate) {
  if (!current || current.episodeId !== update.episodeId) return current;
  const merge = (asset: ReviewMediaAsset) => asset.id === update.asset.id && asset.filePath === update.asset.filePath && asset.sizeBytes === update.asset.sizeBytes && asset.sourceVersion === update.asset.sourceVersion
    ? { ...asset, waveformUrl: update.asset.waveformUrl, posterUrl: update.asset.posterUrl, filmstripUrl: update.asset.filmstripUrl }
    : asset;
  return { ...current, program: merge(current.program), cameras: current.cameras.map(merge), audio: current.audio.map(merge) };
}

export interface ReviewMediaImportResult {
  canceled: boolean;
  inventory: ReviewMediaInventory;
  message: string;
}

export interface ReviewMediaImportProgress {
  episodeId: string;
  slot: ReviewMediaImportSlot;
  progress: number;
  message: string;
}

export interface ReviewMediaSyncResult {
  offsetsMs: Record<string, number>;
  confidence: "high" | "review";
  message: string;
}

export interface ReviewMediaTreatmentPreview {
  trackId: string;
  kind: "audio" | "video";
  playbackUrl: string;
  durationMs: number;
}

export interface ReviewMediaIntegrityItem {
  slot: ReviewMediaImportSlot;
  status: "verified" | "missing" | "changed" | "not-indexed";
  message: string;
}

export interface ReviewMediaIntegrityResult {
  items: ReviewMediaIntegrityItem[];
  message: string;
}
