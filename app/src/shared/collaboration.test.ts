import { describe, expect, it } from "vitest";
import { createLocalCollaborationWorkspace } from "./collaboration";

describe("createLocalCollaborationWorkspace", () => {
  it("starts local-only with Morgan as the owner", () => {
    const workspace = createLocalCollaborationWorkspace("episode-1", "Episode One", "2026-08-24T20:00:00.000Z");
    expect(workspace.provider).toBe("local");
    expect(workspace.remoteState).toBe("not-connected");
    expect(workspace.status).toBe("working");
    expect(workspace.members).toEqual([
      expect.objectContaining({ id: "morgan-owner", name: "Morgan", role: "owner", status: "active" })
    ]);
    expect(workspace.comments).toEqual([]);
  });
});
