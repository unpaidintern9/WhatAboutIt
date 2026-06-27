import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import type { EpisodeMetadata, StudioSettings } from "../shared/types";
import { defaultStudioConfiguration } from "../shared/config";
import { defaultDeviceDefaults, withDeviceDefaults } from "../shared/device-config";
import { defaultExportSettings } from "../shared/export";
import { getAppDataRoot, getEpisodesRoot, getSettingsPath } from "./config-service";
import { logger } from "./logger";
import {
  appendRecordingError,
  createRecordingSession,
  listUnfinishedRecordingSessions,
  saveProgramRecording,
  writeRecordingState
} from "./recording-session-store";
import { loadPodcastTools, savePodcastTools } from "./podcast-tools-store";
import { loadTimelineDraft, saveTimelineDraft } from "./timeline-store";
import { cancelExport, createExport, openExportFolder } from "./export-store";

const appDataRoot = getAppDataRoot();
const episodesRoot = getEpisodesRoot();
const settingsPath = getSettingsPath();

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 720,
    title: "What About It? Studio",
    backgroundColor: "#1a1110",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

async function ensureBaseFolders() {
  await fs.mkdir(episodesRoot, { recursive: true });
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
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "new-episode";
}

async function listEpisodes(): Promise<EpisodeMetadata[]> {
  await ensureBaseFolders();
  const entries = await fs.readdir(episodesRoot, { withFileTypes: true });
  const episodes = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const metadataPath = path.join(episodesRoot, entry.name, "metadata.json");
        return readJsonFile<EpisodeMetadata | null>(metadataPath, null);
      })
  );

  return episodes
    .filter((episode): episode is EpisodeMetadata => Boolean(episode))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function createEpisode(input: { title: string; guestName?: string; description?: string }) {
  await ensureBaseFolders();
  const now = new Date().toISOString();
  const id = `${now.slice(0, 10)}-${slugify(input.title)}-${crypto.randomUUID().slice(0, 8)}`;
  const folderPath = path.join(episodesRoot, id);

  await fs.mkdir(path.join(folderPath, "media"), { recursive: true });
  await fs.mkdir(path.join(folderPath, "drafts"), { recursive: true });
  await fs.mkdir(path.join(folderPath, "exports"), { recursive: true });
  await fs.mkdir(path.join(folderPath, "reports"), { recursive: true });

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
  await logger.info("EpisodeService", "Created local episode metadata.", { episodeId: metadata.id });
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
    onboarding: { guidedTour: "show" }
  });
  return { ...withDeviceDefaults(settings), exportSettings: { ...defaultExportSettings, ...settings.exportSettings } };
}

async function saveSettings(settings: StudioSettings) {
  await fs.mkdir(appDataRoot, { recursive: true });
  const nextSettings = { ...withDeviceDefaults(settings), exportSettings: { ...defaultExportSettings, ...settings.exportSettings } };
  await fs.writeFile(settingsPath, JSON.stringify(nextSettings, null, 2), "utf8");
  await logger.info("SettingsService", "Saved local studio settings.");
  return nextSettings;
}

app.whenReady().then(async () => {
  await ensureBaseFolders();
  await logger.info("App", "What About It? Studio launched.");

  ipcMain.handle("episodes:list", listEpisodes);
  ipcMain.handle("episodes:create", (_event, input) => createEpisode(input));
  ipcMain.handle("settings:get", getSettings);
  ipcMain.handle("settings:save", (_event, settings) => saveSettings(settings));
  ipcMain.handle("recording:create-session", (_event, input) => createRecordingSession(input));
  ipcMain.handle("recording:write-state", (_event, input) => writeRecordingState(input.folderPath, input.state));
  ipcMain.handle("recording:save-program", (_event, input) =>
    saveProgramRecording(input.folderPath, Uint8Array.from(input.bytes))
  );
  ipcMain.handle("recording:append-error", (_event, input) => appendRecordingError(input.folderPath, input.message));
  ipcMain.handle("recording:list-unfinished", listUnfinishedRecordingSessions);
  ipcMain.handle("podcast-tools:load", (_event, episodeId) => loadPodcastTools(episodeId));
  ipcMain.handle("podcast-tools:save", (_event, input) => savePodcastTools(input.episodeId, input.state));
  ipcMain.handle("timeline:load", (_event, episodeId) => loadTimelineDraft(episodeId));
  ipcMain.handle("timeline:save", (_event, input) => saveTimelineDraft(input.episodeId, input.draft));
  ipcMain.handle("export:create", (_event, input) => createExport(input));
  ipcMain.handle("export:cancel", (_event, input) => cancelExport(input.episodeId, input.job));
  ipcMain.handle("export:open-folder", (_event, episodeId) => openExportFolder(episodeId));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
