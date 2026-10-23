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
    expect(full.headers.get("access-control-allow-origin")).toBe("*");
    expect(full.headers.get("content-type")).toBe("video/webm");
    expect(await full.text()).toBe("0123456789");

    const range = await fetch(mediaUrl, { headers: { Range: "bytes=2-5" } });
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await range.text()).toBe("2345");

    const suffixRange = await fetch(mediaUrl, { headers: { Range: "bytes=-3" } });
    expect(suffixRange.status).toBe(206);
    expect(suffixRange.headers.get("content-range")).toBe("bytes 7-9/10");
    expect(await suffixRange.text()).toBe("789");

    const invalidRange = await fetch(mediaUrl, { headers: { Range: "bytes=20-" } });
    expect(invalidRange.status).toBe(416);
    expect(invalidRange.headers.get("content-range")).toBe("bytes */10");

    const outsidePath = Buffer.from(path.join(os.tmpdir(), "outside.webm"), "utf8").toString("base64url");
    expect((await fetch(`${server.baseUrl}/media/${outsidePath}`)).status).toBe(404);
  });

  it("serves generated timeline artwork with browser-decodable image types", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "wai-media-server-images-"));
    const imagePath = path.join(root, "episode-a", "Session", "Review", "morgan-mic-waveform.png");
    await fs.mkdir(path.dirname(imagePath), { recursive: true });
    await fs.writeFile(imagePath, Buffer.from("png-data"));
    server = await startMediaPlaybackServer(root);
    const encodedImagePath = Buffer.from(imagePath, "utf8").toString("base64url");

    const response = await fetch(`${server.baseUrl}/media/${encodedImagePath}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  });
  it("forwards authenticated cloud review ranges without putting credentials in media URLs", async () => {
    const calls: string[] = [];
    root = await fs.mkdtemp(path.join(os.tmpdir(), "wai-cloud-playback-"));
    server = await startMediaPlaybackServer(root, async (episodeId, relativePath, range) => {
      calls.push(`${episodeId}:${relativePath}:${range}`);
      return new Response("2345", { status: 206, headers: { "content-type": "video/mp4", "content-length": "4", "content-range": "bytes 2-5/10", "accept-ranges": "bytes" } });
    });
    const token = Buffer.from(JSON.stringify({ episodeId: "episode-a", relativePath: "objects/revision/proxy.mp4" })).toString("base64url");
    const response = await fetch(`${server.baseUrl}/cloud/${token}`, { headers: { range: "bytes=2-5" } });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const preflight = await fetch(`${server.baseUrl}/cloud/${token}`, { method: "OPTIONS", headers: { Origin: "null", "Access-Control-Request-Headers": "Range" } });
    expect(preflight.status).toBe(204);
    expect(await response.text()).toBe("2345");
    expect(calls).toEqual(["episode-a:objects/revision/proxy.mp4:bytes=2-5"]);
    expect((await fetch(`${server.baseUrl.replace(/[^/]+$/, "wrong-token")}/cloud/${token}`)).status).toBe(404);
  });

});
