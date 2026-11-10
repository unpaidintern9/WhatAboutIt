import fs from "node:fs/promises";

// Reviewed operation IDs are non-secret. Only the existing private service key
// can inspect/recover an upload, and the Worker rejects a changed cloud revision.
const input = new URL("../../../.github/whataboutit-recovery.json", import.meta.url);
let operation;
try { operation = JSON.parse(await fs.readFile(input, "utf8")); }
catch (error) { if (error.code === "ENOENT") process.exit(0); throw error; }
if (!/^[A-Za-z0-9._-]{1,160}$/.test(operation.episodeId) || !/^[A-Za-z0-9_-]{1,80}$/.test(operation.operationId)) throw new Error("Invalid reviewed recovery operation.");
const secret = process.env.WHATABOUTIT_MORGAN_ACCESS_KEY || process.env.WHATABOUTIT_LEGACY_ACCESS_KEY;
if (!secret || secret.length < 24) throw new Error("Recovery requires an existing editor credential.");
const base = "https://whataboutit-collab.whataboutit-collab.workers.dev";
const url = `${base}/episodes/${encodeURIComponent(operation.episodeId)}/upload-recovery?operationId=${encodeURIComponent(operation.operationId)}`;
async function request(method) {
  const response = await fetch(url, { method, headers: { "x-whataboutit-key": secret }, signal: AbortSignal.timeout(120000) });
  const body = await response.json();
  console.log(JSON.stringify({ method, httpStatus: response.status, ...body }));
  if (!response.ok) throw new Error(`Recovery ${method} failed (${response.status}). The existing cloud revision was preserved.`);
  return body;
}
const state = await request("GET");
if (state.phase === "complete" && state.verification === "manifest-verified") {
  console.log("This reviewed backup is already published and verified.");
} else {
  if (!state.canRecover) throw new Error("The pending backup needs conflict resolution. No cloud revision was overwritten.");
  const result = await request("POST");
  if (result.status?.phase !== "complete" || result.status?.verification !== "manifest-verified" || result.status?.completionPercent !== 100) throw new Error("The recovered backup has no final verification receipt.");
  console.log("PASS: recovered the reviewed full backup without retransmitting media.");
}

if (operation.organizeFiles) {
  const organizeUrl = url.replace("/upload-recovery?", "/upload-organization?");
  async function organize(method, relativePath) {
    const target = new URL(organizeUrl);
    if (relativePath) target.searchParams.set("relativePath", relativePath);
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const response = await fetch(target, { method, headers: { "x-whataboutit-key": secret }, signal: AbortSignal.timeout(15 * 60 * 1000) });
        const result = await response.json();
        if (!response.ok) throw new Error(`Organization ${response.status}: ${result.error}`);
        return result;
      } catch (error) {
        if (attempt === 4) throw error;
        console.log(`Retrying organized copy: ${relativePath || "publication"}, attempt ${attempt}`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  const plan = await organize("GET");
  if (!plan.published) {
    let index = 0, completed = 0;
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (index < plan.files.length) {
        const asset = plan.files[index++];
        await organize("POST", asset.relativePath);
        console.log(`Organized and SHA-256 verified ${++completed}/${plan.files.length}: ${asset.relativePath}`);
      }
    }));
    const result = await organize("POST");
    if (!result.published || result.status?.completionPercent !== 100 || result.status?.verification !== "manifest-verified") throw new Error("Organized backup publication did not verify.");
  }
  console.log(`PASS: ${plan.files.length} backup files published in dated category folders; original revision retained.`);
}
