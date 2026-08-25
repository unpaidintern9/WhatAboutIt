import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type { CollaborationPersonId, CollaborationPresenceSnapshot, CollaborationRemoteState } from "../shared/collaboration-presence";
import { collaborationPeople } from "../shared/collaboration-presence";

type RemoteConfig = {
  apiUrl?: string;
  accessKey?: string;
  personId: CollaborationPersonId;
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

async function requestRemote<T>(episodeId: string, suffix: string, init?: RequestInit): Promise<T> {
  const config = await readConfig();
  if (!config.apiUrl) throw new Error("What About It collaboration service URL is not configured yet.");
  const response = await fetch(`${config.apiUrl}/episodes/${encodeURIComponent(episodeId)}${suffix}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(config.accessKey ? { "x-whataboutit-key": config.accessKey } : {}),
      ...(init?.headers || {})
    }
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    const error = new Error(body.error || `Collaboration request failed (${response.status}).`) as Error & { status?: number; payload?: unknown };
    error.status = response.status;
    error.payload = body;
    throw error;
  }
  return body;
}

function snapshotFromState(episodeId: string, personId: CollaborationPersonId, state: CollaborationRemoteState): CollaborationPresenceSnapshot {
  const self = collaborationPeople[personId];
  const now = Date.now();
  const people = (Object.values(collaborationPeople) as Array<(typeof collaborationPeople)[CollaborationPersonId]>).map((person) => {
    const entry = state.presence?.[person.memberId];
    const mode = entry && entry.expiresAt > now ? entry.mode : "offline";
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
