import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type {
  CollaborationCommentInput,
  CollaborationEpisodeStatus,
  CollaborationInviteInput,
  CollaborationWorkspace
} from "../shared/collaboration";
import { createLocalCollaborationWorkspace } from "../shared/collaboration";

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
