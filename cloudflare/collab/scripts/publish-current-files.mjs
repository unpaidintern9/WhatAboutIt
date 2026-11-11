import fs from "node:fs/promises";
let request;
try { request = JSON.parse(await fs.readFile(new URL("../../../.github/whataboutit-current-files.json", import.meta.url), "utf8")); }
catch (error) { if (error.code === "ENOENT") process.exit(0); throw error; }
const secret = process.env.WHATABOUTIT_MORGAN_ACCESS_KEY || process.env.WHATABOUTIT_LEGACY_ACCESS_KEY;
if (!secret || secret.length < 24) throw new Error("An existing editor credential is required.");
for (const episodeId of request.episodeIds || []) {
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(episodeId)) throw new Error("Invalid reviewed episode ID.");
  const route = `https://whataboutit-collab.whataboutit-collab.workers.dev/episodes/${encodeURIComponent(episodeId)}/current-files`;
  async function call(method, relativePath) {
    const url = new URL(route); if (relativePath) url.searchParams.set("relativePath", relativePath);
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const response = await fetch(url, { method, headers: { "x-whataboutit-key": secret }, signal: AbortSignal.timeout(15 * 60 * 1000) });
        const value = await response.json();
        if (!response.ok) throw new Error(`${response.status}: ${value.error}`);
        return value;
      } catch (error) { if (attempt === 4) throw error; await new Promise(resolve => setTimeout(resolve, attempt * 1000)); }
    }
  }
  const summary = await call("GET");
  console.log(JSON.stringify({ episodeId, assetCount: summary.assetCount, totalBytes: summary.totalBytes, originalCount: summary.originalCount, reviewCount: summary.reviewCount, durationMs: summary.durationMs, fullBackupVerified: summary.fullBackupVerified, currentFilesReady: summary.currentFilesReady }));
  if (!summary.currentFilesReady) {
    let index = 0, copiedBytes = 0;
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (index < summary.files.length) {
        const file = summary.files[index++];
        const result = await call("POST", file.relativePath);
        copiedBytes += result.copiedBytes || 0;
        console.log(`Current file ready: ${result.path} (${result.copiedBytes ? "changed file copied" : "unchanged file reused"})`);
      }
    }));
    const result = await call("POST");
    if (!result.ready) throw new Error("The simple file list did not publish.");
    console.log(JSON.stringify({ episodeId, ready: true, files: result.files, copiedBytes }));
  }
}
