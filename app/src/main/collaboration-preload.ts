import { contextBridge, ipcRenderer } from "electron";
import type { EpisodeMetadata } from "../shared/types";
import type { CloudflareConnectionStatus } from "../shared/cloudflare-auth";
import type { CollaborationCommentInput, CollaborationEpisodeStatus, CollaborationInviteInput, CollaborationUploadMode, CollaborationWorkspace } from "../shared/collaboration";

contextBridge.exposeInMainWorld("studio", {
  listEpisodes: (): Promise<EpisodeMetadata[]> => ipcRenderer.invoke("episodes:list"),
  getCloudflareConnectionStatus: (): Promise<CloudflareConnectionStatus> => ipcRenderer.invoke("cloudflare:status"),
  connectCloudflare: (): Promise<CloudflareConnectionStatus> => ipcRenderer.invoke("cloudflare:connect"),
  disconnectCloudflare: (): Promise<CloudflareConnectionStatus> => ipcRenderer.invoke("cloudflare:disconnect"),
  getCollaborationWorkspace: (episodeId: string): Promise<CollaborationWorkspace> => ipcRenderer.invoke("collaboration:get", episodeId),
  inviteCollaborator: (episodeId: string, input: CollaborationInviteInput): Promise<CollaborationWorkspace> => ipcRenderer.invoke("collaboration:invite", { episodeId, input }),
  addCollaborationComment: (episodeId: string, input: CollaborationCommentInput): Promise<CollaborationWorkspace> => ipcRenderer.invoke("collaboration:add-comment", { episodeId, input }),
  resolveCollaborationComment: (episodeId: string, commentId: string): Promise<CollaborationWorkspace> => ipcRenderer.invoke("collaboration:resolve-comment", { episodeId, commentId }),
  setCollaborationStatus: (episodeId: string, status: CollaborationEpisodeStatus): Promise<CollaborationWorkspace> => ipcRenderer.invoke("collaboration:set-status", { episodeId, status }),
  scanCollaborationAssets: (episodeId: string): Promise<CollaborationWorkspace> => ipcRenderer.invoke("collaboration:scan-assets", episodeId),
  buildCollaborationUploadPlan: (episodeId: string, mode: CollaborationUploadMode): Promise<CollaborationWorkspace> => ipcRenderer.invoke("collaboration:upload-plan", { episodeId, mode }),
  openCollaborationEpisodeFolder: (episodeId: string): Promise<string> => ipcRenderer.invoke("collaboration:open-folder", episodeId)
});