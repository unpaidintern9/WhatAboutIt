import { Menu, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type { EpisodeMetadata } from "../shared/types";
import type { CollaborationCommentInput, CollaborationEpisodeStatus, CollaborationInviteInput } from "../shared/collaboration";
import { getEpisodesRoot } from "./config-service";
import { addCollaborationComment, inviteCollaborator, loadCollaborationWorkspace, resolveCollaborationComment, setCollaborationStatus } from "./collaboration-store";
import { openCollaborationWindow } from "./collaboration-window";

async function resolveEpisode(episodeId: string): Promise<EpisodeMetadata> {
  if (!episodeId || episodeId.includes("..") || episodeId.includes("/") || episodeId.includes("\\")) throw new Error("Invalid episode id.");
  const metadataPath = path.join(getEpisodesRoot(), episodeId, "metadata.json");
  const episode = JSON.parse(await fs.readFile(metadataPath, "utf8")) as EpisodeMetadata;
  if (episode.id !== episodeId) throw new Error("Episode metadata does not match the requested episode.");
  return episode;
}

export function configureCollaboration(preloadPath: string) {
  ipcMain.handle("collaboration:get", async (_event, episodeId: string) => {
    const episode = await resolveEpisode(episodeId);
    return loadCollaborationWorkspace(episode.folderPath, episode.id, episode.title);
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

  const existing = Menu.getApplicationMenu();
  const template = existing ? existing.items.map((item) => ({ role: item.role, label: item.label, submenu: item.submenu ? item.submenu.items.map((sub) => ({ role: sub.role, label: sub.label, accelerator: sub.accelerator, click: sub.click })) : undefined })) : [];
  template.push({
    label: "Collaboration",
    submenu: [
      {
        label: "Open Episode Collaboration",
        accelerator: "CmdOrCtrl+Shift+C",
        click: () => openCollaborationWindow(preloadPath)
      }
    ]
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
