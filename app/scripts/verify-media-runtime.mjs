// Synthetic media only. This CLI harness never opens the user's studio data or cloud credentials.
import { app, BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyReviewTransport } from "./verify-review-transport.mjs";
const appRoot = fileURLToPath(new URL("..", import.meta.url));
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
let mediaServer;
let temporary;
let window;
const timeout = setTimeout(() => {
  console.error("Electron media verification timed out");
  app.exit(1);
}, 45000);
app.whenReady().then(async () => {
  try {
    const { startMediaPlaybackServer } = await import(
      pathToFileURL(path.join(appRoot, "dist/main/media-playback-server.js"))
        .href
    );
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "wai-electron-media-"));
    const file = path.join(temporary, "signal.wav");
    const wav = Buffer.alloc(44 + 48000 * 2);
    wav.write("RIFF");
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(48000, 24);
    wav.writeUInt32LE(96000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(96000, 40);
    for (let frame = 0; frame < 48000; frame++)
      wav.writeInt16LE(
        Math.round(Math.sin((frame * 2 * Math.PI * 440) / 48000) * 10000),
        44 + frame * 2,
      );
    await fs.writeFile(file, wav);
    mediaServer = await startMediaPlaybackServer(temporary);
    const mediaUrl = `${mediaServer.baseUrl}/media/${Buffer.from(file).toString("base64url")}`;
    window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 860,
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await window.loadFile(path.join(appRoot, "dist/renderer/index.html"));
    const result = await window.webContents.executeJavaScript(
      `(async () => {
      const context = new AudioContext({ sampleRate: 48000, sinkId: { type: 'none' } });
      await context.audioWorklet.addModule(new URL('pcm-capture-worklet.js', document.baseURI).href);
      const node = new AudioWorkletNode(context, 'wai-pcm-capture');
      const oscillator = context.createOscillator(); const silence = context.createGain(); silence.gain.value = 0;
      oscillator.connect(node).connect(silence).connect(context.destination); oscillator.start(); await context.resume();
      const pcm = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('No PCM samples received')), 5000);
        node.port.onmessage = ({ data }) => { if (data.bytes) { clearTimeout(timer); resolve({ bytes: data.bytes.byteLength, frames: data.frames }); } };
        node.port.postMessage('start');
      });
      oscillator.stop(); node.disconnect();
      const audio = new Audio(); audio.crossOrigin = 'anonymous'; audio.src = ${JSON.stringify(mediaUrl)};
      const source = context.createMediaElementSource(audio); const analyser = context.createAnalyser();
      source.connect(analyser).connect(context.destination); await audio.play();
      await new Promise(resolve => setTimeout(resolve, 250));
      const samples = new Float32Array(1024); analyser.getFloatTimeDomainData(samples);
      const peak = Math.max(...samples.map(value => Math.abs(value)));
      audio.pause(); source.disconnect(); await context.close();
      return { pcm, peak, secureContext: window.isSecureContext, title: document.title, meaningfulScreen: document.body.innerText.includes('Studio Setup') };
    })()`,
      true,
    );
    assert.equal(result.pcm.frames, 48000);
    assert.equal(result.pcm.bytes, 144000);
    assert.ok(result.peak > 0.05, `Web Audio received silence: ${result.peak}`);
    assert.ok(result.secureContext && result.meaningfulScreen);
    result.reviewTransport = await verifyReviewTransport(window, appRoot, temporary, mediaServer.baseUrl);
    console.log(JSON.stringify({ passed: true, ...result }));
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    window?.destroy();
    await mediaServer?.close();
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
    app.quit();
  }
});
