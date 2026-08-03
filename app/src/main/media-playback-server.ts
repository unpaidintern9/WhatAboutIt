import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";

const mediaTypes: Record<string, string> = {
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mkv": "video/x-matroska"
};

export interface MediaPlaybackServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startMediaPlaybackServer(episodesRoot: string): Promise<MediaPlaybackServer> {
  const root = path.resolve(episodesRoot);
  const accessToken = crypto.randomBytes(24).toString("base64url");
  const server = http.createServer((request, response) => {
    void serveMediaRequest(root, accessToken, request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local media playback server did not start.");

  return {
    baseUrl: `http://127.0.0.1:${address.port}/${accessToken}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function serveMediaRequest(
  root: string,
  accessToken: string,
  request: http.IncomingMessage,
  response: http.ServerResponse
) {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") return sendStatus(response, 405);
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 3 || parts[0] !== accessToken || parts[1] !== "media") return sendStatus(response, 404);

    const filePath = Buffer.from(parts[2], "base64url").toString("utf8");
    const resolvedPath = path.resolve(filePath);
    const relativePath = path.relative(root, resolvedPath);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) return sendStatus(response, 404);

    const stat = await fs.stat(resolvedPath);
    if (!stat.isFile()) return sendStatus(response, 404);
    const range = parseRange(request.headers.range, stat.size);
    const start = range?.start ?? 0;
    const end = range?.end ?? stat.size - 1;
    const status = range ? 206 : 200;

    response.writeHead(status, {
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Type": mediaTypes[path.extname(resolvedPath).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": String(end - start + 1),
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` } : {})
    });
    if (request.method === "HEAD") return response.end();
    createReadStream(resolvedPath, { start, end }).on("error", () => response.destroy()).pipe(response);
  } catch {
    sendStatus(response, 404);
  }
}

function parseRange(header: string | undefined, size: number) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(header ?? "");
  if (!match) return undefined;
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(requestedEnd) || start < 0 || start >= size || requestedEnd < start) return undefined;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function sendStatus(response: http.ServerResponse, status: number) {
  if (response.headersSent) return response.end();
  response.writeHead(status, { "Cache-Control": "no-store" });
  response.end();
}
