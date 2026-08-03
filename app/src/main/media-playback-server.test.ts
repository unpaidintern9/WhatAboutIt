import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startMediaPlaybackServer, type MediaPlaybackServer } from "./media-playback-server";

describe("media playback server", () => {
  let root = "";
  let server: MediaPlaybackServer | undefined;

  afterEach(async () => {
    await server?.close();
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("streams episode media with byte-range support and blocks outside files", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "wai-media-server-"));
    const mediaPath = path.join(root, "episode-a", "Program", "program.webm");
    await fs.mkdir(path.dirname(mediaPath), { recursive: true });
    await fs.writeFile(mediaPath, Buffer.from("0123456789"));
    server = await startMediaPlaybackServer(root);
    const encodedMediaPath = Buffer.from(mediaPath, "utf8").toString("base64url");
    const mediaUrl = `${server.baseUrl}/media/${encodedMediaPath}`;

    const full = await fetch(mediaUrl);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("video/webm");
    expect(await full.text()).toBe("0123456789");

    const range = await fetch(mediaUrl, { headers: { Range: "bytes=2-5" } });
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await range.text()).toBe("2345");

    const outsidePath = Buffer.from(path.join(os.tmpdir(), "outside.webm"), "utf8").toString("base64url");
    expect((await fetch(`${server.baseUrl}/media/${outsidePath}`)).status).toBe(404);
  });
});
