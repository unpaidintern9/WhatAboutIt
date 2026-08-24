export type CollaborationRole = "owner" | "editor" | "reviewer";
export type CollaborationMemberStatus = "active" | "invited";
export type CollaborationEpisodeStatus = "working" | "ready-for-review" | "changes-requested" | "approved";
export type CollaborationProvider = "local" | "cloudflare";
export type CollaborationRemoteState = "not-connected" | "ready" | "syncing" | "error";

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

export interface CollaborationWorkspace {
  version: 1;
  episodeId: string;
  episodeTitle: string;
  provider: CollaborationProvider;
  remoteState: CollaborationRemoteState;
  status: CollaborationEpisodeStatus;
  members: CollaborationMember[];
  comments: CollaborationComment[];
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
    updatedAt: now
  };
}
