import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

// Every binding is local and disposable. No production URL or credentials are used.
const root = fileURLToPath(new URL("..", import.meta.url));
const storage = await fs.mkdtemp(path.join(os.tmpdir(), "wai-r2-runtime-"));
const listener = net.createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const preload = path.join(storage, "local-only.cjs");
// Some managed runners forbid interface enumeration but permit loopback binding.
// Advertise only the explicit test interface; never discover or expose a LAN address.
await fs.writeFile(
  preload,
  `const os=require('node:os');try{os.networkInterfaces()}catch{os.networkInterfaces=()=>({lo:[{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}]})}`,
);
const testKey = "local-runtime-test-only-32-characters";
const child = spawn(
  process.execPath,
  [
    "--require",
    preload,
    path.join(root, "node_modules/wrangler/bin/wrangler.js"),
    "dev",
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--persist-to",
    storage,
    "--var",
    `WHATABOUTIT_COLLAB_ACCESS_KEYS:${JSON.stringify({ runtime: testKey })}`,
    "--log-level",
    "error",
  ],
  {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  },
);
let logs = "";
child.stdout.on("data", (data) => {
  logs = (logs + data).slice(-8000);
});
child.stderr.on("data", (data) => {
  logs = (logs + data).slice(-8000);
});
const base = `http://127.0.0.1:${port}`;
const request = (pathname, init = {}) =>
  fetch(`${base}${pathname}`, {
    ...init,
    headers: { "x-whataboutit-key": testKey, ...init.headers },
    signal: AbortSignal.timeout(20000),
  });
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null)
      throw new Error(`Local Worker exited: ${logs}`);
    try {
      ready = (await request("/health")).ok;
    } catch {
      /* Local runtime is still starting. */
    }
    if (ready) break;
    await delay(250);
  }
  assert.ok(ready, `Local Worker did not start: ${logs}`);
  // Exceeds the bounded non-streaming fallback: this must use crypto.DigestStream.
  const bytes = Buffer.alloc(9 * 1024 * 1024, 43);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const episodeId = "local-runtime-canary";
  const relative = `objects/runtime/${hash}/program.mp4`;
  const assetUrl = `/episodes/${episodeId}/assets/${encodeURIComponent(relative)}`;
  const create = await request(`${assetUrl}?multipart=create`, {
    method: "POST",
    headers: { "content-type": "video/mp4", "x-content-sha256": hash },
  });
  assert.equal(create.status, 200, await create.clone().text());
  const { uploadId } = await create.json();
  const parts = [];
  for (const [index, part] of [
    bytes.subarray(0, 5 * 1024 * 1024),
    bytes.subarray(5 * 1024 * 1024),
  ].entries()) {
    const response = await request(
      `${assetUrl}?multipart=part&uploadId=${encodeURIComponent(uploadId)}&partNumber=${index + 1}`,
      { method: "PUT", body: part },
    );
    assert.equal(response.status, 200, await response.clone().text());
    parts.push(await response.json());
  }
  const complete = await request(
    `${assetUrl}?multipart=complete&uploadId=${encodeURIComponent(uploadId)}`,
    { method: "POST", body: JSON.stringify({ parts }) },
  );
  assert.equal(complete.status, 200, await complete.clone().text());
  const head = await request(assetUrl, { method: "HEAD" });
  assert.equal(head.headers.get("x-content-verified"), "true");
  assert.equal(head.headers.get("x-content-sha256"), hash);
  const range = await request(assetUrl, { headers: { range: "bytes=2-33" } });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 32);
  const manifest = {
    revisionId: "runtime-revision",
    uploadedAt: "2026-10-23T00:00:00Z",
    episode: { id: episodeId },
    assets: [
      {
        relativePath: "Session/Proxies/program-review.mp4",
        cloudPath: `episodes/${episodeId}/${relative}`,
        bytes: bytes.length,
        contentHash: hash,
      },
    ],
  };
  const publish = await request(`/episodes/${episodeId}/manifest`, {
    method: "PUT",
    headers: { "if-none-match": "*" },
    body: JSON.stringify(manifest),
  });
  assert.equal(publish.status, 200, await publish.clone().text());
  const failed = await request(`/episodes/${episodeId}/manifest`, {
    method: "PUT",
    body: JSON.stringify({
      ...manifest,
      revisionId: "invalid",
      assets: [{ ...manifest.assets[0], contentHash: "0".repeat(64) }],
    }),
  });
  assert.equal(failed.status, 400);
  assert.equal(
    (await (await request(`/episodes/${episodeId}/manifest`)).json())
      .revisionId,
    "runtime-revision",
  );
  console.log(
    "PASS: local workerd/R2 streamed SHA-256, multipart upload, verified publication, range playback and failed-publication isolation.",
  );
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(3000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  await fs.rm(storage, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
