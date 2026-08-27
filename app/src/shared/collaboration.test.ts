import { describe, expect, it } from "vitest";
import { createLocalCollaborationWorkspace, isInternalCollaborationAssetPath, transferableCollaborationAssets } from "./collaboration";

describe("createLocalCollaborationWorkspace", () => {
  it("starts local-only with Morgan and Susan ready to collaborate", () => {
    const workspace = createLocalCollaborationWorkspace("episode-1", "Episode One", "2026-08-24T20:00:00.000Z");
    expect(workspace.provider).toBe("local");
    expect(workspace.remoteState).toBe("not-connected");
    expect(workspace.status).toBe("working");
    expect(workspace.members).toEqual([
      expect.objectContaining({ id: "morgan-owner", name: "Morgan", role: "owner", status: "active" }),
      expect.objectContaining({ id: "susan-editor", name: "Susan", role: "editor", status: "invited" })
    ]);
    expect(workspace.comments).toEqual([]);
  });
});

describe("isInternalCollaborationAssetPath", () => {
  it("excludes machine-local sync markers from cloud transfer manifests", () => {
    expect(isInternalCollaborationAssetPath("Collaboration/project-sync.json")).toBe(true);
    expect(isInternalCollaborationAssetPath("Session\\cloud-download-complete.json")).toBe(true);
    expect(isInternalCollaborationAssetPath("Collaboration/workspace.json")).toBe(false);
    expect(isInternalCollaborationAssetPath("Program/program.webm")).toBe(false);
  });

  it("removes legacy sync markers without dropping episode content", () => {
    const assets = [
      { relativePath: "Collaboration/project-sync.json", bytes: 10 },
      { relativePath: "Session/cloud-download-complete.json", bytes: 20 },
      { relativePath: "Collaboration/workspace.json", bytes: 30 },
      { relativePath: "Program/program.webm", bytes: 40 }
    ];
    expect(transferableCollaborationAssets(assets)).toEqual(assets.slice(2));
  });
});
