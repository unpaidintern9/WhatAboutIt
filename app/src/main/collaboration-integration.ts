import { BrowserWindow, Menu, MenuItem, dialog, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { EpisodeMetadata } from "../shared/types";
import type { CollaborationCommentInput, CollaborationEpisodeStatus, CollaborationInviteInput, CollaborationTransferProgress, CollaborationUploadSelection, CollaborationWorkspace } from "../shared/collaboration";
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
import { getProjectSyncStatus, markProjectMaterialized, pullLatestProjectChanges, pushProjectChanges } from "./collaboration-project-sync";
import { openCollaborationPresenceWindow } from "./collaboration-presence-window";
import { openCollaborationWindow } from "./collaboration-window";

const activeCloudTransfers = new Map<string, AbortController>();

function getReviewWindow() {
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && !window.webContents.getURL().startsWith("data:text/html"));
}

function sendReviewFileCommand(command: string) {
  getReviewWindow()?.webContents.send("review:file-command", command);
}

async function openCurrentEpisodeCollaboration(preloadPath: string) {
  const reviewWindow = getReviewWindow();
  const episodeId = reviewWindow
    ? await reviewWindow.webContents.executeJavaScript("document.querySelector('.timeline-review')?.dataset.episodeId || undefined").catch(() => undefined) as string | undefined
    : undefined;
  openCollaborationWindow(preloadPath, episodeId);
}

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

async function syncWorkspaceMutation(episodeId: string, workspace: CollaborationWorkspace) {
  const config = await getCollaborationRemoteConfig();
  if (!config.apiUrl) return workspace;
  try {
    await pushProjectChanges(episodeId);
    return await loadCollaborationWorkspace(path.join(getEpisodesRoot(), episodeId), episodeId, workspace.episodeTitle);
  } catch (error) {
    throw new Error("The collaboration change is safe on this computer, but Cloudflare sync did not finish. Retry the action before handing the episode to the other editor.", { cause: error });
  }
}

async function importExternalEpisode(selectedFolder: string) {
  const episodesRoot = path.resolve(getEpisodesRoot());
  const source = path.resolve(selectedFolder);
  const episode = await readEpisodeFolder(source);

  if (path.dirname(source) === episodesRoot) {
    return episode;
  }

  const destination = path.join(episodesRoot, episode.id);
  try {
    await fs.access(destination);
    throw new Error("An episode with this ID already exists in the What About It library. Open the existing library copy instead of importing a duplicate.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  // Copy rather than move: the external source remains a safety copy.
  await fs.cp(source, destination, { recursive: true, errorOnExist: true, force: false });
  const imported = { ...episode, folderPath: destination, updatedAt: new Date().toISOString() };
  await fs.writeFile(path.join(destination, "metadata.json"), JSON.stringify(imported, null, 2), "utf8");
  return imported;
}

export function configureCollaboration(preloadPath: string) {
  ipcMain.handle("collaboration:open-center", (_event, episodeId?: string) => {
    openCollaborationWindow(preloadPath, episodeId);
    return true;
  });
  ipcMain.handle("collaboration:open-live-control", () => {
    openCollaborationPresenceWindow(preloadPath);
    return true;
  });
  ipcMain.handle("collaboration:get", async (_event, episodeId: string) => {
    const episode = await resolveEpisode(episodeId);
    let remoteState: CollaborationWorkspace["remoteState"];
    try {
      remoteState = (await getProjectSyncStatus(episodeId)).connected ? "ready" : "not-connected";
    } catch {
      remoteState = "error";
    }
    const workspace = await loadCollaborationWorkspace(episode.folderPath, episode.id, episode.title);
    return {
      ...workspace,
      provider: remoteState === "ready" ? "cloudflare" : workspace.provider,
      remoteState
    };
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
      title: "Open or import an episode folder",
      defaultPath: episodesRoot,
      buttonLabel: "Open Episode",
      properties: ["openDirectory"] as Array<"openDirectory">
    };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return undefined;
    try {
      return await importExternalEpisode(result.filePaths[0]);
    } catch (error) {
      if (error instanceof Error && (error.message.includes("already exists") || error.message.includes("Invalid episode"))) throw error;
      throw new Error("Choose a What About It episode folder that contains metadata.json. Folders outside the managed library are copied in while the source folder stays untouched.", { cause: error });
    }
  });
  ipcMain.handle("collaboration:cloud:list", () => listCloudEpisodes());
  ipcMain.handle("collaboration:project-status", async (_event, episodeId: string) => {
    await resolveEpisode(episodeId);
    return getProjectSyncStatus(episodeId);
  });
  ipcMain.handle("collaboration:project-pull", async (_event, episodeId: string) => {
    await resolveEpisode(episodeId);
    const result = await pullLatestProjectChanges(episodeId);
    getReviewWindow()?.webContents.send("collaboration:project-pulled", episodeId);
    return { ...result, status: await getProjectSyncStatus(episodeId) };
  });
  ipcMain.handle("collaboration:cloud:upload", async (event, payload: { episodeId: string; selection?: CollaborationUploadSelection }) => {
    const episode = await resolveEpisode(payload.episodeId);
    const operationId = crypto.randomUUID();
    const controller = new AbortController();
    activeCloudTransfers.set(operationId, controller);
    const onProgress = (progress: CollaborationTransferProgress) => event.sender.send("collaboration:cloud:progress", progress);
    try {
      const result = await uploadEpisodeToCloud(episode, payload.selection ?? "full-backup", { operationId, signal: controller.signal, onProgress });
      await markProjectMaterialized(episode.id).catch(() => undefined);
      return result;
    } finally {
      activeCloudTransfers.delete(operationId);
    }
  });
  ipcMain.handle("collaboration:cloud:download", async (event, episodeId: string) => {
    validateEpisodeId(episodeId);
    const operationId = crypto.randomUUID();
    const controller = new AbortController();
    activeCloudTransfers.set(operationId, controller);
    const onProgress = (progress: CollaborationTransferProgress) => event.sender.send("collaboration:cloud:progress", progress);
    try {
      const result = await downloadCloudEpisode(episodeId, { operationId, signal: controller.signal, onProgress });
      await markProjectMaterialized(episodeId);
      return result;
    } finally {
      activeCloudTransfers.delete(operationId);
    }
  });
  ipcMain.handle("collaboration:cloud:cancel", (_event, operationId: string) => {
    const controller = activeCloudTransfers.get(operationId);
    if (!controller) return false;
    controller.abort(new DOMException("Transfer cancelled by the editor", "AbortError"));
    return true;
  });
  ipcMain.handle("collaboration:invite", async (_event, payload: { episodeId: string; input: CollaborationInviteInput }) => {
    const episode = await resolveEpisode(payload.episodeId);
    const workspace = await inviteCollaborator(episode.folderPath, episode.id, episode.title, payload.input);
    return syncWorkspaceMutation(episode.id, workspace);
  });
  ipcMain.handle("collaboration:add-comment", async (_event, payload: { episodeId: string; input: CollaborationCommentInput }) => {
    const episode = await resolveEpisode(payload.episodeId);
    const workspace = await addCollaborationComment(episode.folderPath, episode.id, episode.title, payload.input);
    return syncWorkspaceMutation(episode.id, workspace);
  });
  ipcMain.handle("collaboration:resolve-comment", async (_event, payload: { episodeId: string; commentId: string }) => {
    const episode = await resolveEpisode(payload.episodeId);
    const workspace = await resolveCollaborationComment(episode.folderPath, episode.id, episode.title, payload.commentId);
    return syncWorkspaceMutation(episode.id, workspace);
  });
  ipcMain.handle("collaboration:set-status", async (_event, payload: { episodeId: string; status: CollaborationEpisodeStatus }) => {
    const episode = await resolveEpisode(payload.episodeId);
    const workspace = await setCollaborationStatus(episode.folderPath, episode.id, episode.title, payload.status);
    return syncWorkspaceMutation(episode.id, workspace);
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
  const fileMenu = menu.items.find((item) => item.label === "File")?.submenu;
  if (fileMenu && !fileMenu.items.some((item) => item.id === "review-save-project")) {
    fileMenu.append(new MenuItem({ type: "separator" }));
    fileMenu.append(new MenuItem({ id: "review-save-project", label: "Save Review Project", accelerator: "CmdOrCtrl+S", click: () => sendReviewFileCommand("save") }));
    fileMenu.append(new MenuItem({
      label: "Import Review Media",
      submenu: [
        { label: "Camera 1…", click: () => sendReviewFileCommand("import-camera-1") },
        { label: "Camera 2…", click: () => sendReviewFileCommand("import-camera-2") },
        { label: "Camera 3…", click: () => sendReviewFileCommand("import-camera-3") },
        { type: "separator" },
        { label: "Morgan Mic…", click: () => sendReviewFileCommand("import-morgan-mic") },
        { label: "Guest Mic…", click: () => sendReviewFileCommand("import-guest-mic") },
        { label: "Extra Mic…", click: () => sendReviewFileCommand("import-extra-mic") }
      ]
    }));
    fileMenu.append(new MenuItem({ label: "Open Current Episode Folder", click: () => sendReviewFileCommand("open-folder") }));
    fileMenu.append(new MenuItem({ label: "Export Review…", accelerator: "CmdOrCtrl+Shift+E", click: () => sendReviewFileCommand("export") }));
  }
  if (!menu.items.some((item) => item.label === "Collaboration")) {
    menu.append(
      new MenuItem({
        label: "Collaboration",
        submenu: [
          {
            label: "Open Episode Collaboration",
            accelerator: "CmdOrCtrl+Shift+C",
            click: () => void openCurrentEpisodeCollaboration(preloadPath)
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
