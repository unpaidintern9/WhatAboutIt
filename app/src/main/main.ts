import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import type { EpisodeMetadata, StudioSettings } from "../shared/types";

const appDataRoot = path.join(app.getPath("documents"), "WhatAboutItStudioData");
const episodesRoot = path.join(appDataRoot, "episodes");
const settingsPath = path.join(appDataRoot, "settings.json");

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
  return metadata;
}

async function getSettings(): Promise<StudioSettings> {
  await fs.mkdir(appDataRoot, { recursive: true });
  return readJsonFile<StudioSettings>(settingsPath, {
    activeThemeId: "what-about-it",
    defaultEpisodeFolderName: "episodes",
    practiceModeEnabled: false
  });
}

async function saveSettings(settings: StudioSettings) {
  await fs.mkdir(appDataRoot, { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8");
  return settings;
}

app.whenReady().then(async () => {
  await ensureBaseFolders();

  ipcMain.handle("episodes:list", listEpisodes);
  ipcMain.handle("episodes:create", (_event, input) => createEpisode(input));
  ipcMain.handle("settings:get", getSettings);
  ipcMain.handle("settings:save", (_event, settings) => saveSettings(settings));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

