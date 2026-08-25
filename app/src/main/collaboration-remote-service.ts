import { app } from "electron";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { EpisodeMetadata } from "../shared/types";
import type {
  CloudEpisodeManifest,
  CloudEpisodeSummary,
  CollaborationPresenceMode,
  CollaborationPersonId,
  CollaborationPresenceSnapshot,
  CollaborationRemoteState
} from "../shared/collaboration-presence";
import { collaborationPeople } from "../shared/collaboration-presence";
import type { CollaborationSyncResult, CollaborationUploadSelection } from "../shared/collaboration";
import { shouldIncludeCollaborationAsset } from "../shared/collaboration";
import { getEpisodesRoot } from "./config-service";
import { recordCollaborationDownloadComplete, recordCollaborationUploadComplete, refreshCollaborationAssets } from "./collaboration-store";

type RemoteConfig = {
  apiUrl?: string;
  accessKey?: string;
  personId: CollaborationPersonId;
};

type CloudDownloadResult = {
  episode: EpisodeMetadata;
  sync: CollaborationSyncResult;
};

const defaultConfig: RemoteConfig = { personId: "morgan-owner" };

function configPath() {
  return path.join(app.getPath("userData"), "collaboration-remote.json");
}

async function readConfig(): Promise<RemoteConfig> {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath(), "utf8")) as Partial<RemoteConfig>;
    const personId: CollaborationPersonId = parsed.personId === "susan-editor" ? "susan-editor" : "morgan-owner";
    return { personId, apiUrl: parsed.apiUrl?.trim().replace(/\/$/, "") || undefined, accessKey: parsed.accessKey?.trim() || undefined };
  } catch {
    return defaultConfig;
  }
}

async function writeConfig(config: RemoteConfig) {
  await fs.mkdir(path.dirname(configPath()), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(config, null, 2), "utf8");
  return config;
}

export async function getCollaborationRemoteConfig() {
  return readConfig();
}

export async function setCollaborationRemoteConfig(input: { apiUrl?: string; accessKey?: string; personId?: CollaborationPersonId }) {
  const current = await readConfig();
  const personId: CollaborationPersonId = input.personId === "susan-editor" ? "susan-editor" : input.personId === "morgan-owner" ? "morgan-owner" : current.personId;
  const apiUrl = input.apiUrl === undefined ? current.apiUrl : input.apiUrl.trim().replace(/\/$/, "") || undefined;
  const accessKey = input.accessKey === undefined ? current.accessKey : input.accessKey.trim() || undefined;
  return writeConfig({ personId, apiUrl, accessKey });
}

async function apiFetch(pathname: string, init?: RequestInit): Promise<Response> {
  const config = await readConfig();
  if (!config.apiUrl) throw new Error("What About It collaboration service URL is not configured yet.");
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type") && init?.body) headers.set("content-type", "application/json");
  if (config.accessKey) headers.set("x-whataboutit-key", config.accessKey);
  return fetch(`${config.apiUrl}${pathname}`, { ...init, headers });
}

async function requestJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(pathname, init);
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    const error = new Error(body.error || `Collaboration request failed (${response.status}).`) as Error & { status?: number; payload?: unknown };
    error.status = response.status;
    error.payload = body;
    throw error;
  }
  return body;
}

async function requestRemote<T>(episodeId: string, suffix: string, init?: RequestInit): Promise<T> {
  return requestJson<T>(`/episodes/${encodeURIComponent(episodeId)}${suffix}`, init);
}

function snapshotFromState(episodeId: string, personId: CollaborationPersonId, state: CollaborationRemoteState): CollaborationPresenceSnapshot {
  const self = collaborationPeople[personId];
  const now = Date.now();
  const people: CollaborationPresenceSnapshot["people"] = (Object.values(collaborationPeople) as Array<(typeof collaborationPeople)[CollaborationPersonId]>).map((person) => {
    const entry = state.presence?.[person.memberId];
    const mode: CollaborationPresenceMode = entry && entry.expiresAt > now ? entry.mode : "offline";
    return { ...person, mode, lastSeenAt: entry?.lastSeenAt };
  });
  return {
    configured: true,
    connected: true,
    episodeId,
    self,
    activeEditor: state.activeEditor,
    people,
    canEdit: !state.activeEditor || state.activeEditor.memberId === self.memberId
  };
}

export async function getCollaborationPresence(episodeId: string): Promise<CollaborationPresenceSnapshot> {
  const config = await readConfig();
  const self = collaborationPeople[config.personId];
  if (!config.apiUrl) {
    return {
      configured: false,
      connected: false,
      episodeId,
      self,
      activeEditor: null,
      people: Object.values(collaborationPeople).map((person) => ({ ...person, mode: "offline" })),
      canEdit: true,
      error: "Collaboration service is not configured yet."
    };
  }
  try {
    const state = await requestRemote<CollaborationRemoteState>(episodeId, "/state");
    return snapshotFromState(episodeId, config.personId, state);
  } catch (error) {
    return {
      configured: true,
      connected: false,
      episodeId,
      self,
      activeEditor: null,
      people: Object.values(collaborationPeople).map((person) => ({ ...person, mode: "offline" })),
      canEdit: false,
      error: error instanceof Error ? error.message : "Collaboration service unavailable."
    };
  }
}

export async function sendCollaborationPresence(episodeId: string, mode: "viewing" | "editing") {
  const config = await readConfig();
  const self = collaborationPeople[config.personId];
  const result = await requestRemote<{ state: CollaborationRemoteState }>(episodeId, "/presence", {
    method: "POST",
    body: JSON.stringify({ ...self, mode })
  });
  return snapshotFromState(episodeId, config.personId, result.state);
}

export async function acquireCollaborationEditorLease(episodeId: string) {
  const config = await readConfig();
  const self = collaborationPeople[config.personId];
  try {
    const result = await requestRemote<{ state: CollaborationRemoteState }>(episodeId, "/lock", {
      method: "POST",
      body: JSON.stringify(self)
    });
    return snapshotFromState(episodeId, config.personId, result.state);
  } catch (error) {
    const payload = (error as Error & { payload?: { state?: CollaborationRemoteState } }).payload;
    if (payload?.state) return snapshotFromState(episodeId, config.personId, payload.state);
    throw error;
  }
}

export async function heartbeatCollaborationEditorLease(episodeId: string) {
  const config = await readConfig();
  const self = collaborationPeople[config.personId];
  const result = await requestRemote<{ state: CollaborationRemoteState }>(episodeId, "/lock/heartbeat", {
    method: "POST",
    body: JSON.stringify(self)
  });
  return snapshotFromState(episodeId, config.personId, result.state);
}

export async function releaseCollaborationEditorLease(episodeId: string) {
  const config = await readConfig();
  const self = collaborationPeople[config.personId];
  const result = await requestRemote<{ state: CollaborationRemoteState }>(episodeId, `/lock?memberId=${encodeURIComponent(self.memberId)}`, { method: "DELETE" });
  return snapshotFromState(episodeId, config.personId, result.state);
}

export async function leaveCollaborationPresence(episodeId: string) {
  const config = await readConfig();
  const self = collaborationPeople[config.personId];
  try {
    const result = await requestRemote<{ state: CollaborationRemoteState }>(episodeId, `/presence?memberId=${encodeURIComponent(self.memberId)}`, { method: "DELETE" });
    return snapshotFromState(episodeId, config.personId, result.state);
  } catch {
    return getCollaborationPresence(episodeId);
  }
}

export async function listCloudEpisodes(): Promise<CloudEpisodeSummary[]> {
  const config = await readConfig();
  if (!config.apiUrl) return [];
  const result = await requestJson<{ episodes: CloudEpisodeSummary[] }>("/episodes");
  return Array.isArray(result.episodes) ? result.episodes : [];
}

function contentType(relativePath: string) {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".json") return "application/json";
  if (extension === ".mp4" || extension === ".m4v") return "video/mp4";
  if (extension === ".webm") return "video/webm";
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".wav") return "audio/wav";
  if (extension === ".m4a") return "audio/mp4";
  if (extension === ".mp3") return "audio/mpeg";
  if (extension === ".vtt") return "text/vtt";
  if (extension === ".srt" || extension === ".txt") return "text/plain";
  return "application/octet-stream";
}

async function sha256(filePath: string) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function safeLocalAssetPath(episodeFolder: string, relativePath: string) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === "..")) throw new Error("Cloud episode contains an unsafe asset path.");
  const resolvedRoot = path.resolve(episodeFolder);
  const resolved = path.resolve(episodeFolder, ...normalized.split("/"));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Cloud episode asset escaped its episode folder.");
  return resolved;
}

async function remoteAssetMatches(episodeId: string, relativePath: string, contentHash?: string) {
  if (!contentHash) return false;
  const response = await apiFetch(`/episodes/${encodeURIComponent(episodeId)}/assets/${encodeURIComponent(relativePath)}`, { method: "HEAD" });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Could not check cloud asset ${relativePath} (${response.status}).`);
  return response.headers.get("x-content-sha256") === contentHash;
}

export async function uploadEpisodeToCloud(episode: EpisodeMetadata, selection: CollaborationUploadSelection = "full-backup"): Promise<CollaborationSyncResult> {
  const config = await readConfig();
  if (!config.apiUrl) throw new Error("Connect the What About It collaboration service before uploading.");
  const workspace = await refreshCollaborationAssets(episode.folderPath, episode.id, episode.title);
  const selectedAssets = workspace.assets.filter((asset) => shouldIncludeCollaborationAsset(asset.kind, selection));
  let uploadedAssets = 0;
  let skippedAssets = 0;
  let uploadedBytes = 0;

  for (const asset of selectedAssets) {
    const absolutePath = safeLocalAssetPath(episode.folderPath, asset.relativePath);
    if (await remoteAssetMatches(episode.id, asset.relativePath, asset.contentHash)) {
      skippedAssets += 1;
      continue;
    }
    const stream = createReadStream(absolutePath);
    const response = await apiFetch(`/episodes/${encodeURIComponent(episode.id)}/assets/${encodeURIComponent(asset.relativePath)}`, {
      method: "PUT",
      body: Readable.toWeb(stream) as ReadableStream,
      headers: {
        "content-type": contentType(asset.relativePath),
        "x-content-sha256": asset.contentHash ?? ""
      },
      duplex: "half"
    } as RequestInit & { duplex: "half" });
    if (!response.ok) {
      stream.destroy();
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || `Upload failed for ${asset.relativePath} (${response.status}).`);
    }
    uploadedAssets += 1;
    uploadedBytes += asset.bytes ?? 0;
  }

  let existingAssets = [] as CloudEpisodeManifest["assets"];
  const existingResponse = await apiFetch(`/episodes/${encodeURIComponent(episode.id)}/manifest`);
  if (existingResponse.ok) {
    const existing = (await existingResponse.json()) as CloudEpisodeManifest;
    existingAssets = Array.isArray(existing.assets) ? existing.assets : [];
  } else if (existingResponse.status !== 404) {
    throw new Error(`Could not read the existing cloud episode manifest (${existingResponse.status}).`);
  }
  const mergedByPath = new Map(existingAssets.map((asset) => [asset.relativePath, asset]));
  selectedAssets.forEach((asset) => mergedByPath.set(asset.relativePath, { ...asset, state: "synced" }));
  const manifest: CloudEpisodeManifest = {
    version: 1,
    episode: {
      id: episode.id,
      title: episode.title,
      guestName: episode.guestName,
      description: episode.description,
      status: episode.status,
      createdAt: episode.createdAt,
      updatedAt: new Date().toISOString()
    },
    collaborationStatus: workspace.status,
    uploadedAt: new Date().toISOString(),
    assets: [...mergedByPath.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  };
  await requestRemote(episode.id, "/manifest", { method: "PUT", body: JSON.stringify(manifest) });
  await recordCollaborationUploadComplete(episode.folderPath, episode.id, episode.title, selectedAssets.map((asset) => asset.id));

  return {
    episodeId: episode.id,
    uploadedAssets,
    skippedAssets,
    totalBytes: uploadedBytes,
    message: uploadedAssets > 0 ? `Uploaded ${uploadedAssets} changed episode files. ${skippedAssets} unchanged files stayed in Cloudflare.` : "Cloudflare already has the current episode files."
  };
}

async function downloadResponseToFile(response: Response, destination: string) {
  if (!response.body) throw new Error("Cloudflare returned an empty file response.");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.cloud-download`;
  try {
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(temporary));
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function downloadCloudEpisode(episodeId: string): Promise<CloudDownloadResult> {
  const manifest = await requestRemote<CloudEpisodeManifest>(episodeId, "/manifest");
  if (manifest.episode.id !== episodeId) throw new Error("Cloud episode manifest does not match the requested episode.");
  const episodeFolder = path.join(getEpisodesRoot(), episodeId);
  await fs.mkdir(episodeFolder, { recursive: true });
  const safetyStamp = new Date().toISOString().replaceAll(":", "-");
  let downloadedAssets = 0;
  let skippedAssets = 0;
  let downloadedBytes = 0;

  for (const asset of manifest.assets) {
    const destination = safeLocalAssetPath(episodeFolder, asset.relativePath);
    let exists: boolean;
    let matches = false;
    try {
      const stat = await fs.stat(destination);
      exists = stat.isFile();
      if (exists && asset.contentHash && stat.size === asset.bytes) matches = (await sha256(destination)) === asset.contentHash;
    } catch {
      exists = false;
    }
    if (matches) {
      skippedAssets += 1;
      continue;
    }
    if (exists && asset.localOriginal) {
      // Never overwrite a local original with a cloud copy. The local recording
      // remains the safety source of truth on the machine that recorded it.
      skippedAssets += 1;
      continue;
    }
    if (exists) {
      const backup = path.join(episodeFolder, "Backup", "CloudSyncSafety", safetyStamp, ...asset.relativePath.split("/"));
      await fs.mkdir(path.dirname(backup), { recursive: true });
      await fs.copyFile(destination, backup);
    }
    const response = await apiFetch(`/episodes/${encodeURIComponent(episodeId)}/assets/${encodeURIComponent(asset.relativePath)}`);
    if (!response.ok) throw new Error(`Could not download ${asset.relativePath} (${response.status}).`);
    await downloadResponseToFile(response, destination);
    downloadedAssets += 1;
    downloadedBytes += asset.bytes ?? 0;
  }

  const metadataPath = path.join(episodeFolder, "metadata.json");
  let episode: EpisodeMetadata;
  try {
    episode = JSON.parse(await fs.readFile(metadataPath, "utf8")) as EpisodeMetadata;
  } catch {
    const now = new Date().toISOString();
    episode = {
      id: manifest.episode.id,
      title: manifest.episode.title,
      guestName: manifest.episode.guestName,
      description: manifest.episode.description,
      status: manifest.episode.status as EpisodeMetadata["status"],
      createdAt: manifest.episode.createdAt || now,
      updatedAt: manifest.episode.updatedAt || now,
      folderPath: episodeFolder,
      phase: "phase-1-shell"
    };
    await fs.writeFile(metadataPath, JSON.stringify(episode, null, 2), "utf8");
  }
  episode = { ...episode, folderPath: episodeFolder };
  await fs.writeFile(metadataPath, JSON.stringify(episode, null, 2), "utf8");
  await recordCollaborationDownloadComplete(episodeFolder, episode.id, episode.title);

  return {
    episode,
    sync: {
      episodeId,
      downloadedAssets,
      skippedAssets,
      totalBytes: downloadedBytes,
      message: downloadedAssets > 0 ? `Downloaded ${downloadedAssets} changed cloud files. ${skippedAssets} local files were already current or protected.` : "This episode is already current on this computer."
    }
  };
}
