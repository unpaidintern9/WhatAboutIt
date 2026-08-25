export type CollaborationPersonId = "morgan-owner" | "susan-editor";
export type CollaborationPresenceMode = "offline" | "viewing" | "editing";

export interface CollaborationPersonProfile {
  memberId: CollaborationPersonId;
  displayName: "Morgan" | "Susan";
}

export interface CollaborationPresenceEntry extends CollaborationPersonProfile {
  mode: Exclude<CollaborationPresenceMode, "offline">;
  lastSeenAt: number;
  expiresAt: number;
}

export interface CollaborationEditorLease extends CollaborationPersonProfile {
  acquiredAt: number;
  heartbeatAt: number;
  expiresAt: number;
}

export interface CollaborationRemoteState {
  version: number;
  activeEditor: CollaborationEditorLease | null;
  presence: Record<string, CollaborationPresenceEntry>;
  members: unknown[];
  comments: unknown[];
  updatedAt: string;
}

export interface CollaborationPresenceSnapshot {
  configured: boolean;
  connected: boolean;
  episodeId: string;
  self: CollaborationPersonProfile;
  activeEditor: CollaborationEditorLease | null;
  people: Array<CollaborationPersonProfile & { mode: CollaborationPresenceMode; lastSeenAt?: number }>;
  canEdit: boolean;
  error?: string;
}

export const collaborationPeople: Record<CollaborationPersonId, CollaborationPersonProfile> = {
  "morgan-owner": { memberId: "morgan-owner", displayName: "Morgan" },
  "susan-editor": { memberId: "susan-editor", displayName: "Susan" }
};
