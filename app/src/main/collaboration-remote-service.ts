import { app, net, safeStorage } from "electron";
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
import { requestCollaborationWithRetry, uploadCollaborationAsset } from "./collaboration-asset-upload";
import { getUploadCheckpoint, setUploadCheckpoint } from "./collaboration-upload-journal";
import { recordCollaborationDownloadComplete, recordCollaborationUploadComplete, refreshCollaborationAssets } from "./collaboration-store";
import { logger } from "./logger";

type RemoteConfig = {
  apiUrl?: string;
  accessKey?: string;
  personId: CollaborationPersonId;
};

type StoredRemoteConfig = Omit<RemoteConfig, "accessKey"> & {
  accessKey?: string;
  accessKeyEncrypted?: string;
};

export type CollaborationRemoteConfigSummary = {
  apiUrl?: string;
  personId: CollaborationPersonId;
  accessKeyConfigured: boolean;
};

type CloudDownloadResult = {
  episode: EpisodeMetadata;
  sync: CollaborationSyncResult;
};

const defaultConfig: RemoteConfig = { personId: "morgan-owner" };

function encryptionAvailable() {
  try {
    return Boolean(safeStorage?.isEncryptionAvailable?.());
  } catch {
    return false;
  }
}

function configPath() {
  return path.join(app.getPath("userData"), "collaboration-remote.json");
}

async function readConfig(): Promise<RemoteConfig> {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath(), "utf8")) as Partial<StoredRemoteConfig>;
    const personId: CollaborationPersonId = parsed.personId === "susan-editor" ? "susan-editor" : "morgan-owner";
    let accessKey = parsed.accessKey?.trim() || undefined;
    if (parsed.accessKeyEncrypted && encryptionAvailable()) {
      accessKey = safeStorage.decryptString(Buffer.from(parsed.accessKeyEncrypted, "base64")).trim() || undefined;
    }
    const config = { personId, apiUrl: parsed.apiUrl?.trim().replace(/\/$/, "") || undefined, accessKey };
    if (parsed.accessKey && encryptionAvailable()) await writeConfig(config);
    return config;
  } catch {
    return defaultConfig;
  }
}

async function writeConfig(config: RemoteConfig) {
  await fs.mkdir(path.dirname(configPath()), { recursive: true });
  const stored: StoredRemoteConfig = { personId: config.personId, apiUrl: config.apiUrl };
  if (config.accessKey) {
    if (encryptionAvailable()) stored.accessKeyEncrypted = safeStorage.encryptString(config.accessKey).toString("base64");
    else stored.accessKey = config.accessKey;
  }
  await fs.writeFile(configPath(), JSON.stringify(stored, null, 2), "utf8");
  return config;
}

export async function getCollaborationRemoteConfig() {
  const config = await readConfig();
  return { apiUrl: config.apiUrl, personId: config.personId, accessKeyConfigured: Boolean(config.accessKey) } satisfies CollaborationRemoteConfigSummary;
}

export async function setCollaborationRemoteConfig(input: { apiUrl?: string; accessKey?: string; personId?: CollaborationPersonId }) {
  const current = await readConfig();
  const personId: CollaborationPersonId = input.personId === "susan-editor" ? "susan-editor" : input.personId === "morgan-owner" ? "morgan-owner" : current.personId;
  const apiUrl = input.apiUrl === undefined ? current.apiUrl : input.apiUrl.trim().replace(/\/$/, "") || undefined;
  const accessKey = input.accessKey === undefined ? current.accessKey : input.accessKey.trim() || undefined;
  const saved = await writeConfig({ personId, apiUrl, accessKey });
  return { apiUrl: saved.apiUrl, personId: saved.personId, accessKeyConfigured: Boolean(saved.accessKey) } satisfies CollaborationRemoteConfigSummary;
}

export async function fetchCollaborationApi(pathname: string, init?: RequestInit): Promise<Response> {
  const config = await readConfig();
  if (!config.apiUrl) throw new Error("What About It collaboration service URL is not configured yet.");
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type") && init?.body) headers.set("content-type", "application/json");
  if (config.accessKey) headers.set("x-whataboutit-key", config.accessKey);
  const url = `${config.apiUrl}${pathname}`;
  try {
    return await net.fetch(url, { ...init, headers });
  } catch (chromiumError) {
    try {
      return await fetch(url, { ...init, headers });
    } catch (nodeError) {
      const chromiumMessage = chromiumError instanceof Error ? chromiumError.message : String(chromiumError);
      const nodeMessage = nodeError instanceof Error ? nodeError.message : String(nodeError);
      const host = new URL(config.apiUrl).host;
      const connection = net.isOnline() ? "Windows reports an internet connection" : "Windows reports that this computer is offline";
      throw new Error(`Could not reach ${host}. ${connection}. Chromium: ${chromiumMessage}. Node: ${nodeMessage}.`, { cause: nodeError });
    }
  }
}

const apiFetch = fetchCollaborationApi;

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
  const response = await requestCollaborationWithRetry(
    `check ${relativePath}`,
    () => apiFetch(`/episodes/${encodeURIComponent(episodeId)}/assets/${encodeURIComponent(relativePath)}`, { method: "HEAD" }),
    {
      onRetry: (event) => logger.warning("CollaborationUpload", "Retrying a temporary cloud preflight failure.", { episodeId, relativePath, ...event })
    }
  );
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Could not check cloud asset ${relativePath} (${response.status}).`);
  return response.headers.get("x-content-sha256") === contentHash;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  const errors: unknown[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = await task(items[index]);
      } catch (error) {
        errors.push(error);
      }
    }
  });
  await Promise.all(workers);
  if (errors.length > 0) throw errors[0];
  return results;
}

export async function uploadEpisodeToCloud(episode: EpisodeMetadata, selection: CollaborationUploadSelection = "full-backup"): Promise<CollaborationSyncResult> {
  const config = await readConfig();
  if (!config.apiUrl) throw new Error("Connect the What About It collaboration service before uploading.");
  const workspace = await refreshCollaborationAssets(episode.folderPath, episode.id, episode.title);
  const selectedAssets = workspace.assets.filter((asset) => shouldIncludeCollaborationAsset(asset.kind, selection));
  const assetResults = await mapWithConcurrency(selectedAssets, 2, async (asset) => {
    const absolutePath = safeLocalAssetPath(episode.folderPath, asset.relativePath);
    if (await remoteAssetMatches(episode.id, asset.relativePath, asset.contentHash)) {
      await setUploadCheckpoint(episode.id, asset.relativePath, undefined);
      return { uploaded: 0, skipped: 1, bytes: 0 };
    }
    const bytes = asset.bytes ?? (await fs.stat(absolutePath)).size;
    await logger.info("CollaborationUpload", "Uploading episode asset.", { episodeId: episode.id, relativePath: asset.relativePath, bytes });
    try {
      await uploadCollaborationAsset({
        apiFetch,
        pathname: `/episodes/${encodeURIComponent(episode.id)}/assets/${encodeURIComponent(asset.relativePath)}`,
        absolutePath,
        bytes,
        contentType: contentType(asset.relativePath),
        contentHash: asset.contentHash,
        checkpoint: await getUploadCheckpoint(episode.id, asset.relativePath),
        onCheckpoint: (checkpoint) => setUploadCheckpoint(episode.id, asset.relativePath, checkpoint),
        onRetry: (event) => logger.warning("CollaborationUpload", "Retrying a temporary cloud upload failure.", {
          episodeId: episode.id,
          relativePath: asset.relativePath,
          ...event
        })
      });
    } catch (error) {
      await logger.error("CollaborationUpload", "Episode asset upload failed.", {
        episodeId: episode.id,
        relativePath: asset.relativePath,
        bytes,
        error: String(error)
      });
      throw new Error(`Upload failed for ${asset.relativePath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    await logger.info("CollaborationUpload", "Episode asset upload completed.", { episodeId: episode.id, relativePath: asset.relativePath, bytes });
    return { uploaded: 1, skipped: 0, bytes };
  });
  const uploadedAssets = assetResults.reduce((total, result) => total + result.uploaded, 0);
  const skippedAssets = assetResults.reduce((total, result) => total + result.skipped, 0);
  const uploadedBytes = assetResults.reduce((total, result) => total + result.bytes, 0);

  let existingAssets = [] as CloudEpisodeManifest["assets"];
  const existingResponse = await requestCollaborationWithRetry(
    "read cloud episode manifest",
    () => apiFetch(`/episodes/${encodeURIComponent(episode.id)}/manifest`),
    {
      onRetry: (event) => logger.warning("CollaborationUpload", "Retrying a temporary cloud manifest read failure.", { episodeId: episode.id, ...event })
    }
  );
  let existingEtag: string | undefined;
  let existingRevisionId: string | undefined;
  if (existingResponse.ok) {
    const existing = (await existingResponse.json()) as CloudEpisodeManifest;
    existingAssets = Array.isArray(existing.assets) ? existing.assets : [];
    existingEtag = existingResponse.headers.get("etag") ?? undefined;
    existingRevisionId = existing.revisionId;
  } else if (existingResponse.status !== 404) {
    throw new Error(`Could not read the existing cloud episode manifest (${existingResponse.status}).`);
  }
  const mergedByPath = new Map(
    existingAssets
      .filter((asset) => !shouldIncludeCollaborationAsset(asset.kind, selection))
      .map((asset) => [asset.relativePath, asset])
  );
  selectedAssets.forEach((asset) => mergedByPath.set(asset.relativePath, { ...asset, state: "synced" }));
  const manifest: CloudEpisodeManifest = {
    version: 1,
    revisionId: crypto.randomUUID(),
    parentRevisionId: existingRevisionId,
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
  const manifestResponse = await requestCollaborationWithRetry(
    "save cloud episode manifest",
    () => apiFetch(`/episodes/${encodeURIComponent(episode.id)}/manifest`, {
      method: "PUT",
      body: JSON.stringify(manifest),
      headers: existingEtag ? { "if-match": existingEtag } : { "if-none-match": "*" }
    }),
    {
      onRetry: (event) => logger.warning("CollaborationUpload", "Retrying a temporary cloud manifest save failure.", { episodeId: episode.id, ...event })
    }
  );
  if (!manifestResponse.ok) {
    const body = (await manifestResponse.json().catch(() => ({}))) as { error?: string };
    if (manifestResponse.status === 412) throw new Error("Another computer published this episode while the upload was running. Reopen the episode to receive those changes, then retry the upload.");
    throw new Error(body.error || `Could not save the cloud episode manifest (${manifestResponse.status}).`);
  }
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
