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
  // R2 validates the full checksum while streaming, without whole-file Worker hashing.
  const bytes = Buffer.alloc(33 * 1024 * 1024, 43);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const episodeId = "local-runtime-canary";
  const progressUrl = `/episodes/${episodeId}/upload-status`;
  const progress = { operationId: "runtime-upload", sequence: 1, selection: "full-backup", phase: "transferring", completedAssets: 0, totalAssets: 1, transferredBytes: 5 * 1024 * 1024, totalBytes: bytes.length, eventCount: 1, events: [{ type: "retry", message: "A part was retried." }] };
  assert.equal((await request(progressUrl, { method: "PUT", body: JSON.stringify(progress) })).status, 200);
  assert.equal((await (await request(progressUrl)).json()).completionPercent, 15);
  const relative = `objects/runtime/${hash}/program review 50% 🎥.mp4`;
  const assetUrl = `/episodes/${episodeId}/assets/${encodeURIComponent(relative)}`;
  const create = await request(`${assetUrl}?multipart=create`, {
    method: "POST",
    headers: { "content-type": "video/mp4", "x-content-sha256": hash },
  });
  assert.equal(create.status, 200, await create.clone().text());
  const { uploadId } = await create.json();
  const parts = [];
  for (const [index, part] of Array.from({ length: Math.ceil(bytes.length / (16 * 1024 * 1024)) }, (_, index) => bytes.subarray(index * 16 * 1024 * 1024, (index + 1) * 16 * 1024 * 1024)).entries()) {
    const response = await request(
      `${assetUrl}?multipart=part&uploadId=${encodeURIComponent(uploadId)}&partNumber=${index + 1}`,
      { method: "PUT", body: part },
    );
    assert.equal(response.status, 200, await response.clone().text());
    parts.push(await response.json());
  }
  const complete = await request(
    `${assetUrl}?multipart=complete&uploadId=${encodeURIComponent(uploadId)}`,
    { method: "POST", body: JSON.stringify({ verification: "bounded-v1", parts }) },
  );
  assert.equal(complete.status, 200, await complete.clone().text());
  let verification = await complete.json();
  assert.equal((await request(assetUrl, { method: "HEAD" })).headers.get("x-content-verified"), "true");
  let verificationSteps = 0;
  while (verification.verificationPending) {
    const response = await request(`${assetUrl}?multipart=verify&uploadId=${encodeURIComponent(uploadId)}`, { method: "POST", body: "{}" });
    assert.ok(response.ok, await response.clone().text());
    verification = await response.json();
    verificationSteps++;
    assert.ok(verificationSteps <= 3);
  }
  assert.equal(verificationSteps, 0);
  const head = await request(assetUrl, { method: "HEAD" });
  assert.equal(head.headers.get("x-content-verified"), "true");
  assert.equal(head.headers.get("x-content-sha256"), hash);
  const range = await request(assetUrl, { headers: { range: "bytes=2-33" } });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 32);
  const manifest = {
    uploadOperationId: "runtime-upload",
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
  const finishedProgress = await request(progressUrl, { method: "PUT", body: JSON.stringify({ ...progress, sequence: 2, phase: "complete", completedAssets: 1, transferredBytes: bytes.length, manifestRevisionId: manifest.revisionId }) });
  assert.equal(finishedProgress.status, 200, await finishedProgress.clone().text());
  const finalProgress = await (await request(progressUrl)).json();
  assert.equal(finalProgress.completionPercent, 100);
  assert.equal(finalProgress.verification, "manifest-verified");
  assert.equal((await (await request(progressUrl + "?operationId=runtime-upload")).json()).events[0].type, "retry");
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
  const recoverOperation = "runtime-recovery";
  const recoveryProgress = await request(progressUrl, { method: "PUT", body: JSON.stringify({ ...progress, operationId: recoverOperation, sequence: 1, phase: "error", completedAssets: 1, transferredBytes: bytes.length }) });
  assert.equal(recoveryProgress.status, 200);
  const prior = await request(`/episodes/${episodeId}/manifest`);
  const weak = `W/${prior.headers.get("etag")}`;
  const recoveryManifest = { ...manifest, uploadOperationId: recoverOperation, revisionId: "recovered-runtime", parentRevisionId: manifest.revisionId };
  const weakPublish = await request(`/episodes/${episodeId}/manifest`, { method: "PUT", headers: { "if-match": weak }, body: JSON.stringify(recoveryManifest) });
  assert.equal(weakPublish.status, 200, await weakPublish.clone().text());
  const recoveryUrl = `/episodes/${episodeId}/upload-recovery?operationId=${recoverOperation}`;
  const recovered = await request(recoveryUrl, { method: "POST" });
  assert.equal(recovered.status, 200, await recovered.clone().text());
  assert.equal((await recovered.json()).status.completionPercent, 100);
  assert.equal((await request(recoveryUrl, { method: "POST" })).status, 200);
  const competing = await request(`/episodes/${episodeId}/manifest`, { method: "PUT", headers: { "if-match": weak }, body: JSON.stringify({ ...recoveryManifest, revisionId: "stale-runtime" }) });
  assert.equal(competing.status, 412);
  const organizeUrl = recoveryUrl.replace("upload-recovery", "upload-organization");
  const organizePlan = await request(organizeUrl);
  assert.equal(organizePlan.status, 200, await organizePlan.clone().text());
  const copy = await request(organizeUrl + "&relativePath=" + encodeURIComponent(manifest.assets[0].relativePath), { method: "POST" });
  assert.equal(copy.status, 200, await copy.clone().text());
  const organized = await request(organizeUrl, { method: "POST" });
  assert.equal(organized.status, 200, await organized.clone().text());
  const organizedManifest = await (await request(`/episodes/${episodeId}/manifest`)).json();
  assert.ok(organizedManifest.assets[0].cloudPath.includes("/Session/versions/"));
  const organizedAsset = `/episodes/${episodeId}/assets/` + encodeURIComponent(organizedManifest.assets[0].cloudPath.slice(`episodes/${episodeId}/`.length));
  assert.equal((await request(organizedAsset, { method: "HEAD" })).headers.get("x-content-verified"), "true");
  assert.equal((await request(assetUrl, { method: "HEAD" })).headers.get("x-content-verified"), "true");
  assert.equal((await request(organizedAsset, { method: "DELETE" })).status, 409);
  const plainRoute = `/episodes/${episodeId}/current-files`;
  const plainPlan = await (await request(plainRoute)).json();
  assert.equal(plainPlan.currentFilesReady, false);
  assert.equal(plainPlan.files[0].path, "Review/program-review.mp4");
  const plainCopy = plainRoute + "?relativePath=" + encodeURIComponent(plainPlan.files[0].relativePath);
  const copied = await request(plainCopy, { method: "POST" });
  assert.equal(copied.status, 200, await copied.clone().text());
  assert.equal((await copied.json()).copiedBytes, bytes.length);
  assert.equal((await (await request(plainCopy, { method: "POST" })).json()).copiedBytes, 0);
  assert.equal((await request(plainRoute, { method: "POST" })).status, 200);
  assert.equal((await (await request(plainRoute)).json()).currentFilesReady, true);
  const direct = await request(`/episodes/${episodeId}/assets/Review%2Fprogram-review.mp4`, { headers: { range: "bytes=2-33" } });
  assert.equal(direct.status, 206);
  assert.equal((await direct.arrayBuffer()).byteLength, 32);
  console.log("PASS: direct readable filenames, unchanged-media reuse, checksum verification and playback.");
  console.log("PASS: organized 33 MiB R2 streaming copy, checksum receipt, publication and retention of original bytes.");
  console.log("PASS: logical revision CAS, idempotent recovery and rejection of competing publication in workerd/R2.");
  console.log(
    "PASS: local workerd/R2 bounded resumable SHA-256, multipart upload, private progress/logs, verified publication, range playback and failed-publication isolation.",
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
