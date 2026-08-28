import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type {
  CollaborationCommentInput,
  CollaborationEpisodeStatus,
  CollaborationInviteInput,
  CollaborationSyncHistoryEntry,
  CollaborationUploadPlan,
  CollaborationUploadSelection,
  CollaborationWorkspace
} from "../shared/collaboration";
import { createLocalCollaborationWorkspace, shouldIncludeCollaborationAsset } from "../shared/collaboration";
import { buildEpisodeAssetManifest } from "./collaboration-asset-index";

function workspacePath(episodeFolder: string) {
  return path.join(episodeFolder, "Collaboration", "workspace.json");
}

async function writeWorkspace(episodeFolder: string, workspace: CollaborationWorkspace) {
  const filePath = workspacePath(episodeFolder);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const nextWorkspace = { ...workspace, updatedAt: new Date().toISOString() };
  await fs.writeFile(filePath, JSON.stringify(nextWorkspace, null, 2), "utf8");
  return nextWorkspace;
}

function hydrateWorkspace(parsed: Partial<CollaborationWorkspace>, episodeId: string, episodeTitle: string): CollaborationWorkspace {
  const defaults = createLocalCollaborationWorkspace(episodeId, episodeTitle, parsed.updatedAt ?? new Date().toISOString());
  return {
    ...defaults,
    ...parsed,
    episodeId,
    episodeTitle,
    provider: parsed.provider ?? defaults.provider,
    remoteState: parsed.remoteState ?? defaults.remoteState,
    status: parsed.status ?? defaults.status,
    members: parsed.members?.length ? parsed.members : defaults.members,
    comments: parsed.comments ?? defaults.comments,
    assets: parsed.assets ?? defaults.assets,
    syncHistory: parsed.syncHistory ?? defaults.syncHistory,
    uploadPolicy: {
      ...defaults.uploadPolicy,
      ...parsed.uploadPolicy,
      keepLocalOriginals: true,
      proxyFirstForCollaborators: true
    },
    updatedAt: parsed.updatedAt ?? defaults.updatedAt
  };
}

export async function loadCollaborationWorkspace(episodeFolder: string, episodeId: string, episodeTitle: string): Promise<CollaborationWorkspace> {
  const filePath = workspacePath(episodeFolder);
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as Partial<CollaborationWorkspace>;
    const hydrated = hydrateWorkspace(parsed, episodeId, episodeTitle);
    if (!parsed.assets || !parsed.uploadPolicy) return writeWorkspace(episodeFolder, hydrated);
    return hydrated;
  } catch {
    return writeWorkspace(episodeFolder, createLocalCollaborationWorkspace(episodeId, episodeTitle));
  }
}

export async function refreshCollaborationAssets(episodeFolder: string, episodeId: string, episodeTitle: string) {
  const workspace = await loadCollaborationWorkspace(episodeFolder, episodeId, episodeTitle);
  const previousByPath = new Map(workspace.assets.map((asset) => [asset.relativePath, asset]));
  const scanned = await buildEpisodeAssetManifest(episodeFolder, episodeId);
  workspace.assets = scanned.map((asset) => {
    const previous = previousByPath.get(asset.relativePath);
    if (!previous || previous.contentHash !== asset.contentHash) return asset;
    return { ...asset, state: previous.state, cloudPath: previous.cloudPath ?? asset.cloudPath };
  });
  return writeWorkspace(episodeFolder, workspace);
}

export async function prepareCollaborationUpload(
  episodeFolder: string,
  episodeId: string,
  episodeTitle: string,
  selection: CollaborationUploadSelection
): Promise<CollaborationWorkspace> {
  const workspace = await refreshCollaborationAssets(episodeFolder, episodeId, episodeTitle);
  const included = workspace.assets.filter((asset) => shouldIncludeCollaborationAsset(asset.kind, selection));
  const plan: CollaborationUploadPlan = {
    episodeId,
    selection,
    generatedAt: new Date().toISOString(),
    totalBytes: included.reduce((total, asset) => total + (asset.bytes ?? 0), 0),
    assets: included.map((asset) => ({ ...asset, state: workspace.remoteState === "not-connected" ? asset.state : "queued" })),
    blockedReason: workspace.remoteState === "not-connected" ? "cloudflare-not-connected" : undefined
  };
  workspace.lastUploadPlan = plan;
  if (workspace.remoteState !== "not-connected") {
    const selectedIds = new Set(plan.assets.map((asset) => asset.id));
    workspace.assets = workspace.assets.map((asset) => (selectedIds.has(asset.id) ? { ...asset, state: "queued" } : asset));
  }
  return writeWorkspace(episodeFolder, workspace);
}

export async function recordCollaborationUploadComplete(
  episodeFolder: string,
  episodeId: string,
  episodeTitle: string,
  syncedAssetIds: string[]
) {
  const workspace = await loadCollaborationWorkspace(episodeFolder, episodeId, episodeTitle);
  const synced = new Set(syncedAssetIds);
  workspace.provider = "cloudflare";
  workspace.remoteState = "ready";
  workspace.lastUploadedAt = new Date().toISOString();
  const completedAssets = workspace.assets.filter((asset) => synced.has(asset.id));
  const historyEntry: CollaborationSyncHistoryEntry = {
    id: crypto.randomUUID(),
    direction: "upload",
    selection: workspace.lastUploadPlan?.selection,
    status: "complete",
    completedAt: workspace.lastUploadedAt,
    totalBytes: completedAssets.reduce((total, asset) => total + (asset.bytes ?? 0), 0),
    assetCount: completedAssets.length,
    message: `Uploaded ${completedAssets.length} changed file${completedAssets.length === 1 ? "" : "s"} to Cloudflare.`
  };
  workspace.syncHistory = [historyEntry, ...(workspace.syncHistory ?? [])].slice(0, 50);
  workspace.assets = workspace.assets.map((asset) => (synced.has(asset.id) ? { ...asset, state: "synced" } : asset));
  if (workspace.lastUploadPlan) {
    workspace.lastUploadPlan = {
      ...workspace.lastUploadPlan,
      blockedReason: undefined,
      assets: workspace.lastUploadPlan.assets.map((asset) => (synced.has(asset.id) ? { ...asset, state: "synced" } : asset))
    };
  }
  return writeWorkspace(episodeFolder, workspace);
}

export async function recordCollaborationDownloadComplete(
  episodeFolder: string,
  episodeId: string,
  episodeTitle: string,
  expectedAssets?: Array<{ relativePath: string; contentHash?: string }>
) {
  // Every downloaded asset was already size- and SHA-256-verified by the
  // transfer. Re-scanning here used to hash the entire episode a second time,
  // leaving large downloads apparently stuck at 100% for minutes.
  const workspace = await loadCollaborationWorkspace(episodeFolder, episodeId, episodeTitle);
  const expectedByPath = new Map((expectedAssets ?? []).map((asset) => [asset.relativePath, asset.contentHash]));
  workspace.provider = "cloudflare";
  workspace.remoteState = "ready";
  workspace.lastDownloadedAt = new Date().toISOString();
  const downloadedAssets = workspace.assets.filter((asset) => expectedByPath.size === 0 || expectedByPath.get(asset.relativePath) === asset.contentHash);
  const historyEntry: CollaborationSyncHistoryEntry = {
    id: crypto.randomUUID(),
    direction: "download",
    status: "complete",
    completedAt: workspace.lastDownloadedAt,
    totalBytes: downloadedAssets.reduce((total, asset) => total + (asset.bytes ?? 0), 0),
    assetCount: downloadedAssets.length,
    message: `Downloaded and verified ${downloadedAssets.length} file${downloadedAssets.length === 1 ? "" : "s"}.`
  };
  workspace.syncHistory = [historyEntry, ...(workspace.syncHistory ?? [])].slice(0, 50);
  workspace.assets = workspace.assets.map((asset) => ({
    ...asset,
    state: expectedByPath.size === 0 || expectedByPath.get(asset.relativePath) === asset.contentHash ? "synced" : asset.state
  }));
  return writeWorkspace(episodeFolder, workspace);
}

export async function inviteCollaborator(
  episodeFolder: string,
  episodeId: string,
  episodeTitle: string,
  input: CollaborationInviteInput
) {
  const workspace = await loadCollaborationWorkspace(episodeFolder, episodeId, episodeTitle);
  const name = input.name.trim();
  const email = input.email?.trim().toLowerCase() || undefined;
  if (!name) throw new Error("Collaborator name is required.");
  if (email && workspace.members.some((member) => member.email?.toLowerCase() === email)) {
    throw new Error("That collaborator is already in this episode.");
  }
  workspace.members.push({
    id: crypto.randomUUID(),
    name,
    email,
    role: input.role ?? "editor",
    status: "invited",
    invitedAt: new Date().toISOString()
  });
  return writeWorkspace(episodeFolder, workspace);
}

export async function addCollaborationComment(
  episodeFolder: string,
  episodeId: string,
  episodeTitle: string,
  input: CollaborationCommentInput
) {
  const workspace = await loadCollaborationWorkspace(episodeFolder, episodeId, episodeTitle);
  const body = input.body.trim();
  if (!body) throw new Error("Comment cannot be empty.");
  if (!workspace.members.some((member) => member.id === input.authorMemberId)) throw new Error("Comment author is not a collaborator.");
  workspace.comments.push({
    id: crypto.randomUUID(),
    authorMemberId: input.authorMemberId,
    body,
    createdAt: new Date().toISOString(),
    timelineMs: input.timelineMs
  });
  return writeWorkspace(episodeFolder, workspace);
}

export async function resolveCollaborationComment(
  episodeFolder: string,
  episodeId: string,
  episodeTitle: string,
  commentId: string
) {
  const workspace = await loadCollaborationWorkspace(episodeFolder, episodeId, episodeTitle);
  workspace.comments = workspace.comments.map((comment) =>
    comment.id === commentId ? { ...comment, resolvedAt: comment.resolvedAt ?? new Date().toISOString() } : comment
  );
  return writeWorkspace(episodeFolder, workspace);
}

export async function setCollaborationStatus(
  episodeFolder: string,
  episodeId: string,
  episodeTitle: string,
  status: CollaborationEpisodeStatus
) {
  const workspace = await loadCollaborationWorkspace(episodeFolder, episodeId, episodeTitle);
  workspace.status = status;
  return writeWorkspace(episodeFolder, workspace);
}
