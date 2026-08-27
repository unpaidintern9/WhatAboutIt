import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { CloudEpisodeManifest } from "../shared/collaboration";
import { isProjectCollaborationAsset } from "../shared/collaboration";
import type { EpisodeMetadata } from "../shared/types";
import { getEpisodesRoot } from "./config-service";
import { fetchCollaborationApi, getCollaborationRemoteConfig, uploadEpisodeToCloud } from "./collaboration-remote-service";

interface ProjectSyncMarker {
  episodeId: string;
  remoteUploadedAt?: string;
  remoteRevisionId?: string;
  syncedAt: string;
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
  const response = await apiFetch(`/episodes/${encodeURIComponent(episodeId)}/manifest`);
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

    const response = await apiFetch(`/episodes/${encodeURIComponent(episodeId)}/assets/${encodeURIComponent(asset.relativePath)}`);
    if (!response?.ok || !response.body) throw new Error(`Could not download changed project file ${asset.relativePath}.`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const bytes = new Uint8Array(await response.arrayBuffer());
    await fs.writeFile(destination, bytes);
    changed += 1;
  }

  await writeMarker(episodeId, manifest);
  return { changed, remoteUploadedAt: manifest.uploadedAt };
}

/** Refuses a stale local edit after another computer has published a newer project revision. */
export async function assertProjectRevisionCurrent(episodeId: string) {
  const config = await getCollaborationRemoteConfig();
  if (!config.apiUrl) return;
  const [marker, manifest] = await Promise.all([readMarker(episodeId), getRemoteManifest(episodeId)]);
  if (!manifest || (!marker?.remoteUploadedAt && !marker?.remoteRevisionId)) return;
  const changedRevision = manifest.revisionId
    ? manifest.revisionId !== marker.remoteRevisionId
    : manifest.uploadedAt > (marker.remoteUploadedAt ?? "");
  if (changedRevision) {
    throw new Error("Newer project changes are available from Cloudflare. Reopen this episode to apply them before editing so no newer work is overwritten.");
  }
}

/** Uploads only timeline/comments/captions/markers/metadata after a local project save. */
export async function pushProjectChanges(episodeId: string) {
  const config = await getCollaborationRemoteConfig();
  if (!config.apiUrl) return undefined;
  const metadata = JSON.parse(await fs.readFile(path.join(episodeFolder(episodeId), "metadata.json"), "utf8")) as EpisodeMetadata;
  const result = await uploadEpisodeToCloud({ ...metadata, folderPath: episodeFolder(episodeId) }, "project-only");
  const manifest = await getRemoteManifest(episodeId);
  await writeMarker(episodeId, manifest);
  return result;
}

/** Called after a deliberate full cloud materialization so future project pulls are safe. */
export async function markProjectMaterialized(episodeId: string) {
  const manifest = await getRemoteManifest(episodeId);
  if (manifest) await writeMarker(episodeId, manifest);
}
