import { cloudAssetPath } from "../shared/cloud-assets";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { CloudEpisodeManifest, CollaborationProjectSyncStatus, CollaborationUploadSelection } from "../shared/collaboration";
import { isProjectCollaborationAsset } from "../shared/collaboration";
import type { EpisodeMetadata } from "../shared/types";
import { getEpisodesRoot } from "./config-service";
import { fetchCollaborationApi, getCollaborationRemoteConfig, uploadEpisodeToCloud } from "./collaboration-remote-service";
import type { CollaborationTransferOptions } from "./collaboration-remote-service";

import { readPendingProjectSave } from "./local-project-save";

interface ProjectSyncMarker {
  episodeId: string;
  remoteUploadedAt?: string;
  remoteRevisionId?: string;
  syncedAt: string;
}

const cloudPublishes = new Map<string, Promise<unknown>>();

export async function publishEpisodeToCloud(episode: EpisodeMetadata, selection: CollaborationUploadSelection, options: CollaborationTransferOptions = {}) {
  const previous = cloudPublishes.get(episode.id);
  // A background project save and a manual media sync share one cloud revision.
  // Queue them without blocking durable local saves or uploads of other episodes.
  const task = Promise.resolve(previous).catch(() => undefined).then(async () => {
    options.signal?.throwIfAborted();
    const marker = await readMarker(episode.id);
    const { manifest, result } = await uploadEpisodeToCloud(episode, selection, {
      ...options,
      expectedRevision: marker?.remoteRevisionId || marker?.remoteUploadedAt ? {
        revisionId: marker.remoteRevisionId,
        uploadedAt: marker.remoteUploadedAt
      } : undefined
    });
    await writeMarker(episode.id, manifest);
    return result;
  });
  cloudPublishes.set(episode.id, task);
  try {
    return await task;
  } finally {
    if (cloudPublishes.get(episode.id) === task) cloudPublishes.delete(episode.id);
  }
}

function markerPath(episodeId: string) {
  return path.join(getEpisodesRoot(), episodeId, "Collaboration", "project-sync.json");
}

function episodeFolder(episodeId: string) {
  return path.join(getEpisodesRoot(), episodeId);
}

async function readMarker(episodeId: string): Promise<ProjectSyncMarker | undefined> {
  try {
    return JSON.parse(await fs.readFile(markerPath(episodeId), "utf8")) as ProjectSyncMarker;
  } catch {
    return undefined;
  }
}

async function writeMarker(episodeId: string, manifest?: Pick<CloudEpisodeManifest, "uploadedAt" | "revisionId">) {
  const filePath = markerPath(episodeId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify({ episodeId, remoteUploadedAt: manifest?.uploadedAt, remoteRevisionId: manifest?.revisionId, syncedAt: new Date().toISOString() } satisfies ProjectSyncMarker, null, 2),
    "utf8"
  );
}

async function apiFetch(pathname: string, init?: RequestInit) {
  const config = await getCollaborationRemoteConfig();
  if (!config.apiUrl) return undefined;
  return fetchCollaborationApi(pathname, init);
}

async function getRemoteManifest(episodeId: string): Promise<CloudEpisodeManifest | undefined> {
  const response = await apiFetch(`/episodes/${encodeURIComponent(episodeId)}/manifest`, { cache: "no-store" });
  if (!response || response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Could not read cloud project state (${response.status}).`);
  return response.json() as Promise<CloudEpisodeManifest>;
}

async function sha256(filePath: string) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function safePath(root: string, relativePath: string) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === "..")) {
    throw new Error("Cloud project contains an unsafe file path.");
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, ...normalized.split("/"));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Cloud project file escaped the episode folder.");
  }
  return resolved;
}

async function localFileMatches(filePath: string, contentHash?: string) {
  if (!contentHash) return false;
  try {
    return (await sha256(filePath)) === contentHash;
  } catch {
    return false;
  }
}

async function hasLocalProjectChangesSinceMarker(episodeId: string, marker: ProjectSyncMarker | undefined, manifest: CloudEpisodeManifest | undefined) {
  if (await readPendingProjectSave(episodeId)) return true;
  if (!marker?.syncedAt || !manifest) return false;
  const syncedAt = Date.parse(marker.syncedAt);
  if (!Number.isFinite(syncedAt)) return false;
  for (const asset of manifest.assets.filter((candidate) => isProjectCollaborationAsset(candidate.kind))) {
    try {
      if ((await fs.stat(safePath(episodeFolder(episodeId), asset.relativePath))).mtimeMs > syncedAt + 1000) return true;
    } catch {
      // A missing local project file is not an unpublished local edit.
    }
  }
  return false;
}

export async function getProjectSyncStatus(episodeId: string): Promise<CollaborationProjectSyncStatus> {
  const config = await getCollaborationRemoteConfig();
  const marker = await readMarker(episodeId);
  if (!config.apiUrl) return { episodeId, connected: false, remoteExists: false, localRevisionId: marker?.remoteRevisionId, lastSyncedAt: marker?.syncedAt, remoteChangesAvailable: false, localChangesSinceSync: false };
  const manifest = await getRemoteManifest(episodeId);
  const filesResponse = manifest ? await apiFetch(`/episodes/${encodeURIComponent(episodeId)}/current-files`, { cache: "no-store" }) : undefined;
  const cloudFiles = filesResponse?.ok ? await filesResponse.json().catch(() => undefined) as import("../shared/collaboration").CloudEpisodeFiles | undefined : undefined;
  const remoteChangesAvailable = Boolean(manifest && (manifest.revisionId ? manifest.revisionId !== marker?.remoteRevisionId : manifest.uploadedAt > (marker?.remoteUploadedAt ?? "")));
  return {
    episodeId,
    connected: true,
    cloudFiles,
    remoteExists: Boolean(manifest),
    remoteRevisionId: manifest?.revisionId,
    localRevisionId: marker?.remoteRevisionId,
    remoteUpdatedAt: manifest?.uploadedAt,
    remoteUpdatedBy: manifest?.uploadedBy,
    lastSyncedAt: marker?.syncedAt,
    remoteChangesAvailable,
    localChangesSinceSync: await hasLocalProjectChangesSinceMarker(episodeId, marker, manifest)
  };
}

/**
 * Applies only project/edit metadata from Cloudflare after this installation
 * has established a sync marker. First-time local projects are never silently
 * replaced; a full Review-from-Cloud materialization establishes the local copy.
 */
export async function pullLatestProjectChanges(episodeId: string) {
  const [marker, manifest] = await Promise.all([readMarker(episodeId), getRemoteManifest(episodeId)]);
  if (!manifest) return { changed: 0, remoteUploadedAt: undefined as string | undefined };
  if (manifest.episode.id !== episodeId) throw new Error("Cloud project does not match this episode.");
  if (!marker?.remoteUploadedAt && !marker?.remoteRevisionId) return { changed: 0, remoteUploadedAt: manifest.uploadedAt };
  if (manifest.revisionId && marker.remoteRevisionId === manifest.revisionId) return { changed: 0, remoteUploadedAt: manifest.uploadedAt };
  if (!manifest.revisionId && manifest.uploadedAt <= (marker.remoteUploadedAt ?? "")) return { changed: 0, remoteUploadedAt: manifest.uploadedAt };
  if (await hasLocalProjectChangesSinceMarker(episodeId, marker, manifest)) {
    throw new Error("This computer has project changes that have not been synced, so the cloud update was not pulled. Save/sync those changes first or restore a previous cloud safety backup.");
  }

  const root = episodeFolder(episodeId);
  const safetyStamp = new Date().toISOString().replaceAll(":", "-");
  let changed = 0;
  for (const asset of manifest.assets.filter((candidate) => isProjectCollaborationAsset(candidate.kind))) {
    const destination = safePath(root, asset.relativePath);
    if (await localFileMatches(destination, asset.contentHash)) continue;

    try {
      const stat = await fs.stat(destination);
      if (stat.isFile()) {
        const backup = path.join(root, "Backup", "CloudSyncSafety", safetyStamp, ...asset.relativePath.replaceAll("\\", "/").split("/"));
        await fs.mkdir(path.dirname(backup), { recursive: true });
        await fs.copyFile(destination, backup);
      }
    } catch {
      // Missing project files are materialized directly below.
    }

    const response = await apiFetch(cloudAssetPath(episodeId, asset));
    if (!response?.ok || !response.body) throw new Error(`Could not download changed project file ${asset.relativePath}.`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (asset.bytes !== bytes.length || (asset.contentHash && crypto.createHash("sha256").update(bytes).digest("hex") !== asset.contentHash)) throw new Error(`Cloud project checksum failed for ${asset.relativePath}.`);
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, bytes); await fs.rename(temporary, destination); }
    finally { await fs.rm(temporary, { force: true }); }
    changed += 1;
  }

  await writeMarker(episodeId, manifest);
  return { changed, remoteUploadedAt: manifest.uploadedAt };
}

/** Uploads only timeline/comments/captions/markers/metadata after a local project save. */
export async function pushProjectChanges(episodeId: string) {
  const config = await getCollaborationRemoteConfig();
  if (!config.apiUrl) return undefined;
  const metadata = JSON.parse(await fs.readFile(path.join(episodeFolder(episodeId), "metadata.json"), "utf8")) as EpisodeMetadata;
  return publishEpisodeToCloud({ ...metadata, folderPath: episodeFolder(episodeId) }, "project-only");
}

/** Called after a deliberate full cloud materialization so future project pulls are safe. */
export async function markProjectMaterialized(episodeId: string) {
  const manifest = await getRemoteManifest(episodeId);
  if (manifest) await writeMarker(episodeId, manifest);
}
