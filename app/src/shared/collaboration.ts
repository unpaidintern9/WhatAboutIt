export type CollaborationRole = "owner" | "editor" | "reviewer";
export type CollaborationMemberStatus = "active" | "invited";
export type CollaborationEpisodeStatus = "working" | "ready-for-review" | "changes-requested" | "approved";
export type CollaborationProvider = "local" | "cloudflare";
export type CollaborationRemoteState = "not-connected" | "ready" | "syncing" | "error";
export type CollaborationAssetKind = "metadata" | "timeline" | "comments" | "captions" | "markers" | "proxy-video" | "original-video" | "original-audio" | "export" | "other";
export type CollaborationAssetState = "local-only" | "queued" | "uploading" | "synced" | "remote-newer" | "error";
export type CollaborationUploadSelection = "project-only" | "project-and-proxies" | "full-backup";

export interface CollaborationMember {
  id: string;
  name: string;
  email?: string;
  role: CollaborationRole;
  status: CollaborationMemberStatus;
  invitedAt?: string;
  joinedAt?: string;
}

export interface CollaborationComment {
  id: string;
  authorMemberId: string;
  body: string;
  createdAt: string;
  resolvedAt?: string;
  timelineMs?: number;
}

export interface CollaborationAssetManifestEntry {
  id: string;
  kind: CollaborationAssetKind;
  relativePath: string;
  localOriginal: boolean;
  cloudPath?: string;
  contentHash?: string;
  bytes?: number;
  state: CollaborationAssetState;
  updatedAt: string;
}

export interface CollaborationUploadPolicy {
  automaticProjectDataSync: boolean;
  uploadOriginalsOnlyOnRequest: boolean;
  keepLocalOriginals: true;
  proxyFirstForCollaborators: true;
}

export interface CollaborationUploadPlan {
  episodeId: string;
  selection: CollaborationUploadSelection;
  generatedAt: string;
  totalBytes: number;
  assets: CollaborationAssetManifestEntry[];
  blockedReason?: "cloudflare-not-connected";
}

export interface CollaborationWorkspace {
  version: 1;
  episodeId: string;
  episodeTitle: string;
  provider: CollaborationProvider;
  remoteState: CollaborationRemoteState;
  status: CollaborationEpisodeStatus;
  members: CollaborationMember[];
  comments: CollaborationComment[];
  assets: CollaborationAssetManifestEntry[];
  uploadPolicy: CollaborationUploadPolicy;
  lastUploadPlan?: CollaborationUploadPlan;
  lastUploadedAt?: string;
  lastDownloadedAt?: string;
  updatedAt: string;
}

export interface CloudEpisodeSummary {
  id: string;
  title: string;
  guestName?: string;
  description?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  uploadedAt: string;
  assetCount: number;
  totalBytes: number;
}

export interface CloudEpisodeManifest {
  version: 1;
  revisionId?: string;
  parentRevisionId?: string;
  episode: {
    id: string;
    title: string;
    guestName?: string;
    description?: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  collaborationStatus: CollaborationEpisodeStatus;
  uploadedAt: string;
  assets: CollaborationAssetManifestEntry[];
}

export interface CollaborationSyncResult {
  episodeId: string;
  uploadedAssets?: number;
  downloadedAssets?: number;
  skippedAssets?: number;
  totalBytes: number;
  message: string;
}

export type CollaborationTransferDirection = "upload" | "download";
export type CollaborationTransferPhase = "preparing" | "transferring" | "verifying" | "committing" | "complete" | "cancelled" | "error";

export interface CollaborationTransferProgress {
  operationId: string;
  episodeId: string;
  direction: CollaborationTransferDirection;
  phase: CollaborationTransferPhase;
  relativePath?: string;
  completedAssets: number;
  totalAssets: number;
  transferredBytes: number;
  totalBytes: number;
  attempt?: number;
  message: string;
}

export interface CollaborationInviteInput {
  name: string;
  email?: string;
  role?: Exclude<CollaborationRole, "owner">;
}

export interface CollaborationCommentInput {
  authorMemberId: string;
  body: string;
  timelineMs?: number;
}

export function isProjectCollaborationAsset(kind: CollaborationAssetKind) {
  return kind === "metadata" || kind === "timeline" || kind === "comments" || kind === "captions" || kind === "markers";
}

export function shouldIncludeCollaborationAsset(kind: CollaborationAssetKind, selection: CollaborationUploadSelection) {
  if (selection === "full-backup") return true;
  if (isProjectCollaborationAsset(kind)) return true;
  if (selection === "project-and-proxies") return kind === "proxy-video";
  return false;
}

export function createLocalCollaborationWorkspace(episodeId: string, episodeTitle: string, now = new Date().toISOString()): CollaborationWorkspace {
  return {
    version: 1,
    episodeId,
    episodeTitle,
    provider: "local",
    remoteState: "not-connected",
    status: "working",
    members: [
      {
        id: "morgan-owner",
        name: "Morgan",
        role: "owner",
        status: "active",
        joinedAt: now
      },
      {
        id: "susan-editor",
        name: "Susan",
        role: "editor",
        status: "invited",
        invitedAt: now
      }
    ],
    comments: [],
    assets: [],
    uploadPolicy: {
      automaticProjectDataSync: true,
      uploadOriginalsOnlyOnRequest: true,
      keepLocalOriginals: true,
      proxyFirstForCollaborators: true
    },
    updatedAt: now
  };
}
