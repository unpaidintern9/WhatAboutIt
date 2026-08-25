import { contextBridge, ipcRenderer } from "electron";
import type { EpisodeMetadata } from "../shared/types";
import type { CollaborationCommentInput, CollaborationEpisodeStatus, CollaborationInviteInput, CollaborationUploadSelection, CollaborationWorkspace } from "../shared/collaboration";
import type { CollaborationPersonId, CollaborationPresenceSnapshot } from "../shared/collaboration-presence";

type CollaborationRemoteConfig = { apiUrl?: string; accessKey?: string; personId: CollaborationPersonId };

contextBridge.exposeInMainWorld("studio", {
  listEpisodes: (): Promise<EpisodeMetadata[]> => ipcRenderer.invoke("episodes:list"),
  getCollaborationWorkspace: (episodeId: string): Promise<CollaborationWorkspace> => ipcRenderer.invoke("collaboration:get", episodeId),
  refreshCollaborationAssets: (episodeId: string): Promise<CollaborationWorkspace> => ipcRenderer.invoke("collaboration:refresh-assets", episodeId),
  prepareCollaborationUpload: (episodeId: string, selection: CollaborationUploadSelection): Promise<CollaborationWorkspace> => ipcRenderer.invoke("collaboration:prepare-upload", { episodeId, selection }),
  openCollaborationEpisodeFolder: (episodeId: string): Promise<string> => ipcRenderer.invoke("collaboration:open-episode-folder", episodeId),
  inviteCollaborator: (episodeId: string, input: CollaborationInviteInput): Promise<CollaborationWorkspace> => ipcRenderer.invoke("collaboration:invite", { episodeId, input }),
  addCollaborationComment: (episodeId: string, input: CollaborationCommentInput): Promise<CollaborationWorkspace> => ipcRenderer.invoke("collaboration:add-comment", { episodeId, input }),
  resolveCollaborationComment: (episodeId: string, commentId: string): Promise<CollaborationWorkspace> => ipcRenderer.invoke("collaboration:resolve-comment", { episodeId, commentId }),
  setCollaborationStatus: (episodeId: string, status: CollaborationEpisodeStatus): Promise<CollaborationWorkspace> => ipcRenderer.invoke("collaboration:set-status", { episodeId, status }),
  getCollaborationRemoteConfig: (): Promise<CollaborationRemoteConfig> => ipcRenderer.invoke("collaboration:remote-config:get"),
  setCollaborationRemoteConfig: (input: { apiUrl?: string; accessKey?: string; personId?: CollaborationPersonId }): Promise<CollaborationRemoteConfig> => ipcRenderer.invoke("collaboration:remote-config:set", input),
  getCollaborationPresence: (episodeId: string): Promise<CollaborationPresenceSnapshot> => ipcRenderer.invoke("collaboration:presence:get", episodeId),
  heartbeatCollaborationPresence: (episodeId: string, mode: "viewing" | "editing"): Promise<CollaborationPresenceSnapshot> => ipcRenderer.invoke("collaboration:presence:heartbeat", { episodeId, mode }),
  leaveCollaborationPresence: (episodeId: string): Promise<CollaborationPresenceSnapshot> => ipcRenderer.invoke("collaboration:presence:leave", episodeId),
  acquireCollaborationEditorLease: (episodeId: string): Promise<CollaborationPresenceSnapshot> => ipcRenderer.invoke("collaboration:editor:acquire", episodeId),
  heartbeatCollaborationEditorLease: (episodeId: string): Promise<CollaborationPresenceSnapshot> => ipcRenderer.invoke("collaboration:editor:heartbeat", episodeId),
  releaseCollaborationEditorLease: (episodeId: string): Promise<CollaborationPresenceSnapshot> => ipcRenderer.invoke("collaboration:editor:release", episodeId)
});