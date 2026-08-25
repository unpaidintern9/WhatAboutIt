import { Menu, MenuItem, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type { EpisodeMetadata } from "../shared/types";
import type { CollaborationCommentInput, CollaborationEpisodeStatus, CollaborationInviteInput, CollaborationUploadSelection } from "../shared/collaboration";
import type { CollaborationPersonId } from "../shared/collaboration-presence";
import { getEpisodesRoot } from "./config-service";
import { addCollaborationComment, inviteCollaborator, loadCollaborationWorkspace, prepareCollaborationUpload, refreshCollaborationAssets, resolveCollaborationComment, setCollaborationStatus } from "./collaboration-store";
import { acquireCollaborationEditorLease, getCollaborationPresence, getCollaborationRemoteConfig, heartbeatCollaborationEditorLease, leaveCollaborationPresence, releaseCollaborationEditorLease, sendCollaborationPresence, setCollaborationRemoteConfig } from "./collaboration-remote-service";
import { openCollaborationWindow } from "./collaboration-window";

async function resolveEpisode(episodeId: string): Promise<EpisodeMetadata> {
  if (!episodeId || episodeId.includes("..") || episodeId.includes("/") || episodeId.includes("\\")) throw new Error("Invalid episode id.");
  const metadataPath = path.join(getEpisodesRoot(), episodeId, "metadata.json");
  const episode = JSON.parse(await fs.readFile(metadataPath, "utf8")) as EpisodeMetadata;
  if (episode.id !== episodeId) throw new Error("Episode metadata does not match the requested episode.");
  return episode;
}

export function configureCollaboration(preloadPath: string) {
  ipcMain.handle("collaboration:open-center", () => {
    openCollaborationWindow(preloadPath);
    return true;
  });
  ipcMain.handle("collaboration:get", async (_event, episodeId: string) => {
    const episode = await resolveEpisode(episodeId);
    return loadCollaborationWorkspace(episode.folderPath, episode.id, episode.title);
  });
  ipcMain.handle("collaboration:refresh-assets", async (_event, episodeId: string) => {
    const episode = await resolveEpisode(episodeId);
    return refreshCollaborationAssets(episode.folderPath, episode.id, episode.title);
  });
  ipcMain.handle("collaboration:prepare-upload", async (_event, payload: { episodeId: string; selection: CollaborationUploadSelection }) => {
    const episode = await resolveEpisode(payload.episodeId);
    return prepareCollaborationUpload(episode.folderPath, episode.id, episode.title, payload.selection);
  });
  ipcMain.handle("collaboration:open-episode-folder", async (_event, episodeId: string) => {
    const episode = await resolveEpisode(episodeId);
    return shell.openPath(episode.folderPath);
  });
  ipcMain.handle("collaboration:invite", async (_event, payload: { episodeId: string; input: CollaborationInviteInput }) => {
    const episode = await resolveEpisode(payload.episodeId);
    return inviteCollaborator(episode.folderPath, episode.id, episode.title, payload.input);
  });
  ipcMain.handle("collaboration:add-comment", async (_event, payload: { episodeId: string; input: CollaborationCommentInput }) => {
    const episode = await resolveEpisode(payload.episodeId);
    return addCollaborationComment(episode.folderPath, episode.id, episode.title, payload.input);
  });
  ipcMain.handle("collaboration:resolve-comment", async (_event, payload: { episodeId: string; commentId: string }) => {
    const episode = await resolveEpisode(payload.episodeId);
    return resolveCollaborationComment(episode.folderPath, episode.id, episode.title, payload.commentId);
  });
  ipcMain.handle("collaboration:set-status", async (_event, payload: { episodeId: string; status: CollaborationEpisodeStatus }) => {
    const episode = await resolveEpisode(payload.episodeId);
    return setCollaborationStatus(episode.folderPath, episode.id, episode.title, payload.status);
  });

  ipcMain.handle("collaboration:remote-config:get", getCollaborationRemoteConfig);
  ipcMain.handle("collaboration:remote-config:set", (_event, input: { apiUrl?: string; personId?: CollaborationPersonId }) => setCollaborationRemoteConfig(input));
  ipcMain.handle("collaboration:presence:get", async (_event, episodeId: string) => {
    await resolveEpisode(episodeId);
    return getCollaborationPresence(episodeId);
  });
  ipcMain.handle("collaboration:presence:heartbeat", async (_event, payload: { episodeId: string; mode: "viewing" | "editing" }) => {
    await resolveEpisode(payload.episodeId);
    return sendCollaborationPresence(payload.episodeId, payload.mode);
  });
  ipcMain.handle("collaboration:presence:leave", async (_event, episodeId: string) => {
    await resolveEpisode(episodeId);
    return leaveCollaborationPresence(episodeId);
  });
  ipcMain.handle("collaboration:editor:acquire", async (_event, episodeId: string) => {
    await resolveEpisode(episodeId);
    return acquireCollaborationEditorLease(episodeId);
  });
  ipcMain.handle("collaboration:editor:heartbeat", async (_event, episodeId: string) => {
    await resolveEpisode(episodeId);
    return heartbeatCollaborationEditorLease(episodeId);
  });
  ipcMain.handle("collaboration:editor:release", async (_event, episodeId: string) => {
    await resolveEpisode(episodeId);
    return releaseCollaborationEditorLease(episodeId);
  });

  const menu = Menu.getApplicationMenu() ?? new Menu();
  if (!menu.items.some((item) => item.label === "Collaboration")) {
    menu.append(
      new MenuItem({
        label: "Collaboration",
        submenu: [
          {
            label: "Open Episode Collaboration",
            accelerator: "CmdOrCtrl+Shift+C",
            click: () => openCollaborationWindow(preloadPath)
          }
        ]
      })
    );
    Menu.setApplicationMenu(menu);
  }
}
