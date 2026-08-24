export type CollaborationRole = "owner" | "editor" | "reviewer";
export type CollaborationMemberStatus = "active" | "invited";
export type CollaborationEpisodeStatus = "working" | "ready-for-review" | "changes-requested" | "approved";
export type CollaborationProvider = "local" | "cloudflare";
export type CollaborationRemoteState = "not-connected" | "ready" | "syncing" | "error";
export type CollaborationAssetKind = "metadata" | "timeline" | "comments" | "captions" | "markers" | "proxy-video" | "original-video" | "original-audio" | "export";
export type CollaborationAssetState = "local-only" | "queued" | "uploading" | "synced" | "remote-newer" | "error";

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
  lastUploadedAt?: string;
  lastDownloadedAt?: string;
  updatedAt: string;
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
