import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteLocalEpisode } from "./episode-delete-store";

const paths = vi.hoisted(() => ({ root: "" }));
vi.mock("./config-service", () => ({ getEpisodesRoot: () => paths.root }));

describe("delete local episode", () => {
  beforeEach(async () => { paths.root = await fs.mkdtemp(path.join(os.tmpdir(), "wai-delete-")); });
  afterEach(async () => { await fs.rm(paths.root, { recursive: true, force: true }); });
  async function create(id: string) {
    const folder = path.join(paths.root, id);
    await fs.mkdir(path.join(folder, "Audio"), { recursive: true });
    await fs.writeFile(path.join(folder, "metadata.json"), JSON.stringify({ id, title: "Morgan interview", folderPath: "/untrusted/external-path" }));
    await fs.writeFile(path.join(folder, "Audio", "mic.wav"), "original");
    return folder;
  }
  function options() { return { isBusy: vi.fn(() => false), confirm: vi.fn(async () => true), beforeDelete: vi.fn(async () => undefined) }; }

  it("deletes the confirmed episode and its media while preserving another episode", async () => {
    const target = await create("episode-a"), other = await create("episode-b");
    const handlers = options();
    expect(await deleteLocalEpisode("episode-a", handlers)).toBe(true);
    expect(handlers.confirm).toHaveBeenCalledWith(expect.objectContaining({ id: "episode-a", folderPath: target }));
    expect(handlers.beforeDelete).toHaveBeenCalledWith(target);
    await expect(fs.stat(target)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(path.join(other, "Audio", "mic.wav"), "utf8")).toBe("original");
  });

  it("keeps all files when confirmation is cancelled", async () => {
    const target = await create("episode-a");
    const handlers = options(); handlers.confirm.mockResolvedValue(false);
    expect(await deleteLocalEpisode("episode-a", handlers)).toBe(false);
    expect(handlers.beforeDelete).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(target, "Audio", "mic.wav"), "utf8")).toBe("original");
  });

  it("blocks active capture and rechecks work started during confirmation", async () => {
    const target = await create("episode-a");
    const handlers = options(); handlers.isBusy.mockReturnValue(true);
    await expect(deleteLocalEpisode("episode-a", handlers)).rejects.toThrow("Finish recording");
    expect(handlers.confirm).not.toHaveBeenCalled();
    handlers.isBusy.mockReturnValueOnce(false).mockReturnValue(true);
    await expect(deleteLocalEpisode("episode-a", handlers)).rejects.toThrow("Finish recording");
    expect(await fs.readFile(path.join(target, "Audio", "mic.wav"), "utf8")).toBe("original");
  });

  it.each(["", ".", "..", "../outside", "a/b", "a\\b", "/outside"])("rejects unsafe episode ID %s", async (id) => {
    await expect(deleteLocalEpisode(id, options())).rejects.toThrow("invalid");
  });

  it("rejects a symlink or junction to another episode", async () => {
    const target = await create("episode-a");
    await fs.symlink(target, path.join(paths.root, "episode-link"), "junction");
    await expect(deleteLocalEpisode("episode-link", options())).rejects.toThrow("local episode folder");
    expect(await fs.readFile(path.join(target, "Audio", "mic.wav"), "utf8")).toBe("original");
  });

  it("refuses mismatched metadata", async () => {
    const target = await create("episode-a");
    await fs.writeFile(path.join(target, "metadata.json"), JSON.stringify({ id: "episode-b" }));
    await expect(deleteLocalEpisode("episode-a", options())).rejects.toThrow("does not match");
  });
});
