import { BrowserWindow, Menu, MenuItem, dialog, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type { EpisodeMetadata } from "../shared/types";
import type { CollaborationCommentInput, CollaborationEpisodeStatus, CollaborationInviteInput, CollaborationUploadSelection } from "../shared/collaboration";
import type { CollaborationPersonId } from "../shared/collaboration-presence";
import { getEpisodesRoot } from "./config-service";
import { addCollaborationComment, inviteCollaborator, loadCollaborationWorkspace, prepareCollaborationUpload, refreshCollaborationAssets, resolveCollaborationComment, setCollaborationStatus } from "./collaboration-store";
import {
  acquireCollaborationEditorLease,
  downloadCloudEpisode,
  getCollaborationPresence,
  getCollaborationRemoteConfig,
  heartbeatCollaborationEditorLease,
  leaveCollaborationPresence,
  listCloudEpisodes,
  releaseCollaborationEditorLease,
  sendCollaborationPresence,
  setCollaborationRemoteConfig,
  uploadEpisodeToCloud
} from "./collaboration-remote-service";
import { openCollaborationPresenceWindow } from "./collaboration-presence-window";
import { openCollaborationWindow } from "./collaboration-window";

function validateEpisodeId(episodeId: string) {
  if (!episodeId || episodeId.includes("..") || episodeId.includes("/") || episodeId.includes("\\")) throw new Error("Invalid episode id.");
}

async function readEpisodeFolder(folderPath: string): Promise<EpisodeMetadata> {
  const metadataPath = path.join(folderPath, "metadata.json");
  const episode = JSON.parse(await fs.readFile(metadataPath, "utf8")) as EpisodeMetadata;
  validateEpisodeId(episode.id);
  return { ...episode, folderPath };
}

async function resolveEpisode(episodeId: string): Promise<EpisodeMetadata> {
  validateEpisodeId(episodeId);
  const folderPath = path.join(getEpisodesRoot(), episodeId);
  const episode = await readEpisodeFolder(folderPath);
  if (episode.id !== episodeId) throw new Error("Episode metadata does not match the requested episode.");
  return episode;
}

export function configureCollaboration(preloadPath: string) {
  ipcMain.handle("collaboration:open-center", () => {
    openCollaborationWindow(preloadPath);
    return true;
  });
  ipcMain.handle("collaboration:open-live-control", () => {
    openCollaborationPresenceWindow(preloadPath);
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
  ipcMain.handle("episodes:open-folder", async (_event, episodeId: string) => {
    const episode = await resolveEpisode(episodeId);
    return shell.openPath(episode.folderPath);
  });
  ipcMain.handle("episodes:open-library-folder", () => shell.openPath(getEpisodesRoot()));
  ipcMain.handle("episodes:choose-local", async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const episodesRoot = path.resolve(getEpisodesRoot());
    const options = {
      title: "Choose an episode folder",
      defaultPath: episodesRoot,
      buttonLabel: "Open Episode",
      properties: ["openDirectory"] as Array<"openDirectory">
    };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return undefined;
    try {
      const selectedFolder = path.resolve(result.filePaths[0]);
      if (path.dirname(selectedFolder) !== episodesRoot) {
        throw new Error("Choose one of the episode folders inside your What About It Episodes folder.");
      }
      const episode = await readEpisodeFolder(selectedFolder);
      await shell.openPath(episode.folderPath);
      return episode;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Choose one of")) throw error;
      throw new Error("Choose a What About It episode folder that contains metadata.json. The picker starts in the folder that contains all episodes.", { cause: error });
    }
  });
  ipcMain.handle("collaboration:cloud:list", () => listCloudEpisodes());
  ipcMain.handle("collaboration:cloud:upload", async (_event, payload: { episodeId: string; selection?: CollaborationUploadSelection }) => {
    const episode = await resolveEpisode(payload.episodeId);
    return uploadEpisodeToCloud(episode, payload.selection ?? "full-backup");
  });
  ipcMain.handle("collaboration:cloud:download", async (_event, episodeId: string) => {
    validateEpisodeId(episodeId);
    const result = await downloadCloudEpisode(episodeId);
    await shell.openPath(result.episode.folderPath);
    return result;
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
  ipcMain.handle("collaboration:remote-config:set", (_event, input: { apiUrl?: string; accessKey?: string; personId?: CollaborationPersonId }) => setCollaborationRemoteConfig(input));
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
          },
          {
            label: "Live Edit Control",
            accelerator: "CmdOrCtrl+Shift+L",
            click: () => openCollaborationPresenceWindow(preloadPath)
          },
          {
            type: "separator"
          },
          {
            label: "Open Local Episode Library",
            click: () => void shell.openPath(getEpisodesRoot())
          }
        ]
      })
    );
    Menu.setApplicationMenu(menu);
  }
}
