export type EpisodeCleanupScope = "review-cache" | "exports";

export interface EpisodeStorageBucket {
  id: "originals" | "editing-media" | "review-cache" | "backups" | "exports";
  label: string;
  sizeBytes: number;
  fileCount: number;
  rebuildable: boolean;
}

export interface EpisodeStorageSummary {
  episodeId: string;
  totalBytes: number;
  buckets: EpisodeStorageBucket[];
}
