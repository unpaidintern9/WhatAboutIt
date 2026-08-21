import { app, BrowserWindow, dialog, ipcMain, powerSaveBlocker, session, shell, systemPreferences } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import type { EpisodeMetadata, StudioSettings } from "../shared/types";
import { defaultRecordingPreferences } from "../shared/types";
import type { StudioLayoutProfileId, StudioPanelId, StudioWorkspaceState } from "../shared/studio-workspace";
import { defaultStudioWorkspaceState } from "../shared/studio-workspace";
import { defaultStudioConfiguration } from "../shared/config";
import { defaultDeviceDefaults, withDeviceDefaults } from "../shared/device-config";
import { defaultExportSettings } from "../shared/export";
import { configureEpisodesRoot, getAppDataRoot, getEpisodesRoot, getSettingsPath, getWorkspaceStatePath } from "./config-service";
import { logger } from "./logger";
import { appendRecordingChunk, appendRecordingError, beginRecordingMedia, createRecordingSession, finalizeRecordingMedia, listUnfinishedRecordingSessions, recoverRecordingSession, saveProgramRecording, saveRecordedTracks, writeRecordingState } from "./recording-session-store";
import { loadPodcastTools, savePodcastTools } from "./podcast-tools-store";
import { loadTimelineDraft, saveTimelineDraft } from "./timeline-store";
import { cancelExport, createExport, detectMediaTools, openExportFolder, renderTrackTreatmentPreview } from "./export-store";
import { runAutoEdit } from "./auto-edit-store";
import { createDiagnosticsBundle, getStorageStatus } from "./diagnostics-store";
import { analyzeReviewMediaSync, configureMediaPlaybackBaseUrl, importReviewMediaFile, loadReviewMedia, relinkImportedMediaFile, verifyImportedMediaIntegrity } from "./review-media-store";
import { cleanupEpisodeStorage, getEpisodeStorageSummary } from "./episode-maintenance-store";
import type { ReviewMediaImportSlot } from "../shared/review-media";
import { StudioWindowManager } from "./studio-window-manager";
import { startMediaPlaybackServer, type MediaPlaybackServer } from "./media-playback-server";
import { AppUpdateService } from "./app-update-service";
import { cancelLocalTranscription, getLocalTranscriptionStatus, transcribeEpisodeLocally } from "./local-transcription-store";
import { RecordingPowerProtection } from "./recording-power-protection";
import { isStudioMediaPermission } from "../shared/media-permissions";

app.setName("What About It Studio");

const appDataRoot = getAppDataRoot();
const settingsPath = getSettingsPath();
const workspaceStatePath = getWorkspaceStatePath();
let studioWindowManager: StudioWindowManager;
let mediaPlaybackServer: MediaPlaybackServer | undefined;
let appUpdateService: AppUpdateService;
const activeMediaImports = new Map<string, AbortController>();
const closeProtectedWebContents = new Set<number>();
const recordingPowerProtection = new RecordingPowerProtection(powerSaveBlocker);

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 720,
    title: "What About It Studio",
    backgroundColor: "#1a1110",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const webContentsId = mainWindow.webContents.id;

  mainWindow.on("close", (event) => {
    if (!closeProtectedWebContents.has(webContentsId)) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      title: "Recording is still running",
      message: "Keep What About It Studio open until the recording is stopped and verified.",
      detail: "If you exit now, the chunks already written to disk can be recovered next time, but the final seconds may be incomplete.",
      buttons: ["Keep Recording", "Exit and Recover Later"],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (choice === 0) event.preventDefault();
    else closeProtectedWebContents.delete(webContentsId);
  });

  mainWindow.webContents.on("destroyed", () => {
    closeProtectedWebContents.delete(webContentsId);
    recordingPowerProtection.release(webContentsId);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

async function ensureBaseFolders() {
  await fs.mkdir(getEpisodesRoot(), { recursive: true });
}

async function restartMediaPlaybackServer() {
  await mediaPlaybackServer?.close();
  mediaPlaybackServer = await startMediaPlaybackServer(getEpisodesRoot());
  configureMediaPlaybackBaseUrl(mediaPlaybackServer.baseUrl);
}

async function validateRecordingLibraryFolder(folderPath: string) {
  const resolved = path.resolve(folderPath);
  await fs.mkdir(resolved, { recursive: true });
  const probePath = path.join(resolved, `.what-about-it-write-test-${crypto.randomUUID()}`);
  try {
    await fs.writeFile(probePath, "recording-library-ready", "utf8");
  } finally {
    await fs.rm(probePath, { force: true });
  }
  return resolved;
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function slugify(input: string) {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "new-episode"
  );
}

async function listEpisodes(): Promise<EpisodeMetadata[]> {
  await ensureBaseFolders();
  const episodesRoot = getEpisodesRoot();
  const entries = await fs.readdir(episodesRoot, { withFileTypes: true });
  const episodes = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const metadataPath = path.join(episodesRoot, entry.name, "metadata.json");
        return readJsonFile<EpisodeMetadata | null>(metadataPath, null);
      })
  );

  return episodes.filter((episode): episode is EpisodeMetadata => Boolean(episode)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function createEpisode(input: { title: string; guestName?: string; description?: string }) {
  await ensureBaseFolders();
  const episodesRoot = getEpisodesRoot();
  const now = new Date().toISOString();
  const id = `${now.slice(0, 10)}-${slugify(input.title)}-${crypto.randomUUID().slice(0, 8)}`;
  const folderPath = path.join(episodesRoot, id);

  await Promise.all(["Program", "Cameras", "Audio", "Backup", "Session", "Logs", "Exports", "Reports"].map((folder) => fs.mkdir(path.join(folderPath, folder), { recursive: true })));

  const metadata: EpisodeMetadata = {
    id,
    title: input.title.trim() || "Untitled Episode",
    guestName: input.guestName?.trim(),
    description: input.description?.trim(),
    status: "draft",
    createdAt: now,
    updatedAt: now,
    folderPath,
    phase: "phase-1-shell"
  };

  await fs.writeFile(path.join(folderPath, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
  await logger.info("EpisodeService", "Created local episode metadata.", {
    episodeId: metadata.id
  });
  return metadata;
}

async function getSettings(): Promise<StudioSettings> {
  await fs.mkdir(appDataRoot, { recursive: true });
  const settings = await readJsonFile<StudioSettings>(settingsPath, {
    activeThemeId: defaultStudioConfiguration.theme.activeThemeId,
    defaultEpisodeFolderName: defaultStudioConfiguration.storage.episodeFolderName,
    practiceModeEnabled: false,
    deviceDefaults: defaultDeviceDefaults,
    exportSettings: defaultExportSettings,
    onboarding: { guidedTour: "show" },
    studioWorkspace: defaultStudioWorkspaceState.settings,
    recordingPreferences: defaultRecordingPreferences
  });
  return {
    ...withDeviceDefaults(settings),
    exportSettings: { ...defaultExportSettings, ...settings.exportSettings },
    studioWorkspace: {
      ...defaultStudioWorkspaceState.settings,
      ...settings.studioWorkspace
    },
    recordingPreferences: {
      ...defaultRecordingPreferences,
      ...settings.recordingPreferences,
      countdownSeconds: 0
    }
  };
}

async function saveSettings(settings: StudioSettings) {
  await fs.mkdir(appDataRoot, { recursive: true });
  const nextSettings = {
    ...withDeviceDefaults(settings),
    exportSettings: { ...defaultExportSettings, ...settings.exportSettings },
    studioWorkspace: {
      ...defaultStudioWorkspaceState.settings,
      ...settings.studioWorkspace
    },
    recordingPreferences: {
      ...defaultRecordingPreferences,
      ...settings.recordingPreferences,
      countdownSeconds: 0
    }
  };
  const previousEpisodesRoot = getEpisodesRoot();
  const requestedEpisodesRoot = nextSettings.recordingPreferences.primaryFolderPath
    ? await validateRecordingLibraryFolder(nextSettings.recordingPreferences.primaryFolderPath)
    : undefined;
  nextSettings.recordingPreferences.primaryFolderPath = requestedEpisodesRoot;
  configureEpisodesRoot(requestedEpisodesRoot);
  if (getEpisodesRoot() !== previousEpisodesRoot) {
    if (closeProtectedWebContents.size > 0) {
      configureEpisodesRoot(previousEpisodesRoot);
      throw new Error("Stop the recording before changing the primary recording folder.");
    }
    await ensureBaseFolders();
    await restartMediaPlaybackServer();
  }
  await fs.writeFile(settingsPath, JSON.stringify(nextSettings, null, 2), "utf8");
  await logger.info("SettingsService", "Saved local studio settings.");
  return nextSettings;
}

async function saveWorkspaceState(state: StudioWorkspaceState) {
  return studioWindowManager.saveState(state);
}

app.whenReady().then(async () => {
  const initialSettings = await getSettings();
  const requestedEpisodesRoot = initialSettings.recordingPreferences?.primaryFolderPath;
  if (requestedEpisodesRoot) {
    try {
      configureEpisodesRoot(await validateRecordingLibraryFolder(requestedEpisodesRoot));
    } catch (error) {
      configureEpisodesRoot();
      initialSettings.recordingPreferences = { ...defaultRecordingPreferences, ...initialSettings.recordingPreferences, primaryFolderPath: undefined };
      await fs.writeFile(settingsPath, JSON.stringify(initialSettings, null, 2), "utf8");
      await logger.warning("App", "The selected recording library was unavailable, so the app returned to default storage.", { error: String(error) });
    }
  } else {
    configureEpisodesRoot();
  }
  await ensureBaseFolders();
  await logger.info("App", "What About It Studio launched.");
  await restartMediaPlaybackServer();
  studioWindowManager = new StudioWindowManager({
    preloadPath: path.join(__dirname, "preload.js"),
    rendererPath: path.join(__dirname, "../renderer/index.html"),
    devServerUrl: process.env.VITE_DEV_SERVER_URL,
    statePath: workspaceStatePath
  });
  await studioWindowManager.load();
  appUpdateService = new AppUpdateService();

  // Chromium performs a synchronous permission check before it makes the
  // request handled below. Electron requires both handlers for complete media
  // permission handling; without the check handler every camera can disappear
  // before Chromium reaches the normal capture request path.
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => isStudioMediaPermission(permission));
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(isStudioMediaPermission(permission));
  });

  ipcMain.handle("episodes:list", listEpisodes);
  ipcMain.handle("episodes:create", (_event, input) => createEpisode(input));
  ipcMain.handle("settings:get", getSettings);
  ipcMain.handle("settings:save", (_event, settings) => saveSettings(settings));
  ipcMain.handle("workspace:get-state", () => studioWindowManager.getState());
  ipcMain.handle("workspace:save-state", (_event, state) => saveWorkspaceState(state));
  ipcMain.handle("workspace:get-displays", () => studioWindowManager.getDisplays());
  ipcMain.handle(
    "workspace:open-panel",
    (
      _event,
      input: {
        panelId: StudioPanelId;
        episodeId?: string;
        displayId?: number;
        fullscreen?: boolean;
      }
    ) => studioWindowManager.openPanel(input.panelId, input)
  );
  ipcMain.handle("workspace:close-panel", (_event, panelId: StudioPanelId) => studioWindowManager.closePanel(panelId));
  ipcMain.handle("workspace:move-panel", (_event, input: { panelId: StudioPanelId; displayId: number }) => studioWindowManager.movePanel(input.panelId, input.displayId));
  ipcMain.handle("workspace:apply-layout", (_event, input: { layoutId: StudioLayoutProfileId; episodeId?: string }) => studioWindowManager.applyLayout(input.layoutId, input.episodeId));
  ipcMain.handle("workspace:reset-layout", () => studioWindowManager.resetLayout());
  ipcMain.handle("recording:create-session", (_event, input) => createRecordingSession(input));
  ipcMain.handle("recording:write-state", (_event, input) => writeRecordingState(input.folderPath, input.state));
  ipcMain.handle("recording:begin-media", (_event, folderPath) => beginRecordingMedia(folderPath));
  ipcMain.handle("recording:append-chunk", (_event, input) => appendRecordingChunk(input.folderPath, input.chunk));
  ipcMain.handle("recording:finalize-media", (_event, folderPath) => finalizeRecordingMedia(folderPath));
  ipcMain.handle("recording:recover", (_event, folderPath) => recoverRecordingSession(folderPath));
  ipcMain.handle("recording:open-folder", async (_event, folderPath) => shell.openPath(folderPath));
  ipcMain.handle("recording:choose-primary-folder", async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const result = parent
      ? await dialog.showOpenDialog(parent, { title: "Choose the primary recording library", properties: ["openDirectory", "createDirectory"] })
      : await dialog.showOpenDialog({ title: "Choose the primary recording library", properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return undefined;
    return validateRecordingLibraryFolder(result.filePaths[0]);
  });
  ipcMain.handle("recording:choose-backup-folder", async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const result = parent
      ? await dialog.showOpenDialog(parent, { title: "Choose a second recording backup drive", properties: ["openDirectory", "createDirectory"] })
      : await dialog.showOpenDialog({ title: "Choose a second recording backup drive", properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.on("recording:set-close-protection", (event, active: boolean) => {
    if (active) closeProtectedWebContents.add(event.sender.id);
    else closeProtectedWebContents.delete(event.sender.id);
    recordingPowerProtection.setActive(event.sender.id, active);
  });
  ipcMain.handle("recording:save-program", (_event, input) => saveProgramRecording(input.folderPath, input.bytes));
  ipcMain.handle("recording:save-tracks", (_event, input) => saveRecordedTracks(input.folderPath, input.tracks));
  ipcMain.handle("recording:append-error", (_event, input) => appendRecordingError(input.folderPath, input.message));
  ipcMain.handle("recording:list-unfinished", listUnfinishedRecordingSessions);
  ipcMain.handle("podcast-tools:load", (_event, episodeId) => loadPodcastTools(episodeId));
  ipcMain.handle("podcast-tools:save", (_event, input) => savePodcastTools(input.episodeId, input.state));
  ipcMain.handle("timeline:load", (_event, episodeId) => loadTimelineDraft(episodeId));
  ipcMain.handle("timeline:save", (_event, input) => saveTimelineDraft(input.episodeId, input.draft));
  ipcMain.handle("local-transcription:status", () => getLocalTranscriptionStatus());
  ipcMain.handle("local-transcription:start", (event, episodeId: string) => transcribeEpisodeLocally(episodeId, (progress) => event.sender.send("local-transcription:progress", progress)));
  ipcMain.handle("local-transcription:cancel", (_event, episodeId: string) => cancelLocalTranscription(episodeId));
  ipcMain.handle("review-media:load", (_event, episodeId) => loadReviewMedia(episodeId));
  ipcMain.handle("review-media:import", async (event, input: { episodeId: string; slot: ReviewMediaImportSlot }) => {
    const isVideo = input.slot.startsWith("camera-");
    const options = {
      title: isVideo ? `Choose ${input.slot.replace("camera-", "Camera ")} video` : "Choose podcast audio",
      properties: ["openFile"] as Array<"openFile">,
      filters: isVideo
        ? [
            {
              name: "Video files",
              extensions: ["mp4", "mov", "mkv", "webm", "m4v"]
            }
          ]
        : [
            {
              name: "Audio files",
              extensions: ["wav", "mp3", "m4a", "aac", "flac", "ogg"]
            }
          ]
    };
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const result = parentWindow ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return {
        canceled: true,
        inventory: await loadReviewMedia(input.episodeId),
        message: "Import canceled."
      };
    }
    const importKey = `${input.episodeId}:${input.slot}`;
    const controller = new AbortController();
    activeMediaImports.get(importKey)?.abort();
    activeMediaImports.set(importKey, controller);
    try {
      return {
        canceled: false,
        inventory: await importReviewMediaFile(input.episodeId, input.slot, result.filePaths[0], {
          signal: controller.signal,
          onProgress: (progress) => event.sender.send("review-media:import-progress", progress)
        }),
        message: `${input.slot.startsWith("camera-") ? input.slot.replace("camera-", "Camera ") : "Main audio"} imported. The full-quality original is protected and a lighter editing copy is ready.`
      };
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "AbortError") throw error;
      return {
        canceled: true,
        inventory: await loadReviewMedia(input.episodeId),
        message: "Import canceled. Existing media was left unchanged."
      };
    } finally {
      if (activeMediaImports.get(importKey) === controller) activeMediaImports.delete(importKey);
    }
  });
  ipcMain.handle("review-media:cancel-import", (_event, input: { episodeId: string; slot: ReviewMediaImportSlot }) => {
    const active = activeMediaImports.get(`${input.episodeId}:${input.slot}`);
    active?.abort();
    return Boolean(active);
  });
  ipcMain.handle("review-media:auto-sync", (_event, episodeId: string) => analyzeReviewMediaSync(episodeId));
  ipcMain.handle("review-media:verify-originals", (_event, episodeId: string) => verifyImportedMediaIntegrity(episodeId));
  ipcMain.handle("review-media:relink", async (event, input: { episodeId: string; slot: ReviewMediaImportSlot }) => {
    const isVideo = input.slot.startsWith("camera-");
    const options = {
      title: `Relink ${isVideo ? input.slot.replace("camera-", "Camera ") : "podcast audio"} original`,
      properties: ["openFile"] as Array<"openFile">,
      filters: [{ name: isVideo ? "Video files" : "Audio files", extensions: isVideo ? ["mp4", "mov", "mkv", "webm", "m4v"] : ["wav", "mp3", "m4a", "aac", "flac", "ogg"] }]
    };
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const result = parentWindow ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { canceled: true, inventory: await loadReviewMedia(input.episodeId), message: "Relink canceled." };
    return { canceled: false, inventory: await relinkImportedMediaFile(input.episodeId, input.slot, result.filePaths[0]), message: "Protected original relinked and fingerprinted." };
  });
  ipcMain.handle("episode-storage:get", (_event, episodeId: string) => getEpisodeStorageSummary(episodeId));
  ipcMain.handle("episode-storage:cleanup", (_event, input) => cleanupEpisodeStorage(input.episodeId, input.scope));
  ipcMain.handle("review-media:treatment-preview", (_event, input) => renderTrackTreatmentPreview(input));
  ipcMain.handle("auto-edit:run", (_event, input) => runAutoEdit(input));
  ipcMain.handle("export:create", (event, input) => createExport(input, (job) => event.sender.send("export:progress", job)));
  ipcMain.handle("export:choose-destination", async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "Choose where to save the editor handoff",
      buttonLabel: "Use this folder",
      properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">
    };
    const result = parentWindow ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle("export:media-tools-status", detectMediaTools);
  ipcMain.handle("export:cancel", (_event, input) => cancelExport(input.episodeId, input.job));
  ipcMain.handle("export:open-folder", (_event, input) => openExportFolder(input.episodeId, input.outputFolder));
  ipcMain.handle("diagnostics:create", (_event, input) => createDiagnosticsBundle(input));
  ipcMain.handle("storage:status", getStorageStatus);
  ipcMain.handle("media-permissions:get-camera-status", () => systemPreferences.getMediaAccessStatus("camera"));
  ipcMain.handle("media-permissions:open-camera-settings", async () => {
    if (process.platform !== "win32") return false;
    await shell.openExternal("ms-settings:privacy-webcam");
    return true;
  });
  ipcMain.handle("app-update:get-status", () => appUpdateService.getStatus());
  ipcMain.handle("app-update:check", () => appUpdateService.checkForUpdates());
  ipcMain.handle("app-update:download", () => appUpdateService.downloadUpdate());
  ipcMain.handle("app-update:install", () => appUpdateService.installUpdate());

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  recordingPowerProtection.releaseAll();
  void mediaPlaybackServer?.close();
});
