import { BrowserWindow } from "electron";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

// Synthetic episode data only; no user files, cloud keys, or live service calls.
export async function verifyCollaborationWindow(appRoot, temporary) {
  const assets = [
    ...["metadata.json", "Collaboration/workspace.json", "Session/draft-timeline.json", "Session/proxy-catalog.json"].map(relativePath => ({ relativePath, kind: "metadata", bytes: 1000, localOriginal: false })),
    ...["program", "camera-1", "camera-2", "camera-3", "guest-mic", "morgan-mic"].map(name => ({ relativePath: `Session/Proxies/${name}-review.mp4`, kind: "proxy-video", bytes: 63000000, localOriginal: false }))
  ];
  const workspace = { episodeId: "review-example", episodeTitle: "Example 32-minute episode", assets, members: [], comments: [], status: "working", remoteState: "ready", durationMs: 1920000, updatedAt: "2026-11-10T23:00:00Z" };
  const cloudFiles = { episodeId: workspace.episodeId, assetCount: 10, totalBytes: 380700000, originalCount: 0, reviewCount: 6, fullBackupVerified: false, durationMs: 1920000, currentFilesReady: true, files: [{ relativePath: "Session/Proxies/program-review.mp4", path: "Review/program-review.mp4", label: "program-review.mp4", type: "review", bytes: 63000000 }] };
  const preload = path.join(temporary, "collaboration-proof.cjs");
  await fs.writeFile(preload, `const {contextBridge}=require('electron');const workspace=${JSON.stringify(workspace)};const cloudFiles=${JSON.stringify(cloudFiles)};contextBridge.exposeInMainWorld('studio',{listEpisodes:async()=>[{id:workspace.episodeId,title:workspace.episodeTitle}],getCollaborationWorkspace:async()=>workspace,getCollaborationRemoteConfig:async()=>({apiUrl:'https://synthetic.invalid'}),getProjectSyncStatus:async()=>({connected:true,remoteExists:true,remoteChangesAvailable:false,cloudFiles}),onCloudTransferProgress:()=>()=>{}});`);
  const window = new BrowserWindow({ width: 1180, height: 820, show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  try {
    const { createCollaborationWindowHtml } = await import(pathToFileURL(path.join(appRoot, "dist/main/collaboration-window.js")).href);
    await window.loadURL("data:text/html;charset=UTF-8," + encodeURIComponent(createCollaborationWindowHtml(workspace.episodeId)));
    let result;
    for (let attempt = 0; attempt < 40; attempt++) {
      result = await window.webContents.executeJavaScript(`({cloud:document.querySelector('#cloudFilesTitle').textContent,files:document.querySelector('#assetCount').textContent,duration:document.querySelector('#episodeDuration').textContent,disabled:document.querySelector('#syncNow').disabled,mode:document.querySelector('#uploadMode').value,buttonBottom:document.querySelector('#syncNow').getBoundingClientRect().bottom,viewport:innerHeight})`);
      if (result.cloud.includes("Review copy only")) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.match(result.cloud, /Review copy only/);
    assert.equal(result.files, "10");
    assert.equal(result.duration, "32:00");
    assert.equal(result.mode, "full-backup");
    assert.equal(result.disabled, true);
    assert.ok(result.buttonBottom <= result.viewport, "The primary backup control must fit in the default window without opening the file list.");
    window.showInactive();
    await window.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
    await fs.writeFile(path.join(process.env.RUNNER_TEMP || os.tmpdir(), "wai-collaboration-proof.png"), (await window.webContents.capturePage()).toPNG());
    return { actualInventory: true, reviewCopyExplicit: true, durationVisible: true, fullBackupDefault: true, primaryControlVisible: true };
  } finally { window.destroy(); }
}
