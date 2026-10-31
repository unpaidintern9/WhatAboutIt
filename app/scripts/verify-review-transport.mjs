import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { build } from "esbuild";
import ffmpeg from "@ffmpeg-installer/ffmpeg";

// Exercise the actual Review component against real indexed media and the
// production range server. Fixtures live only in the caller's temporary folder.
export async function verifyReviewTransport(window, appRoot, temporary, baseUrl) {
  const video = path.join(temporary, "transport.webm");
  const audio = path.join(temporary, "transport.flac");
  const execute = promisify(execFile);
  await execute(ffmpeg.path, ["-y", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "30", "-c:v", "libvpx", "-deadline", "realtime", "-g", "30", "-c:a", "libopus", video]);
  await execute(ffmpeg.path, ["-y", "-i", video, "-vn", "-c:a", "flac", audio]);
  const url = (file) => `${baseUrl}/media/${Buffer.from(file).toString("base64url")}`;
  const asset = (id, label, kind, file) => ({ id, label, kind, relativePath: path.basename(file), filePath: file, playbackUrl: url(file), status: "ready", durationMs: 30000, message: "Ready" });
  const fixture = {
    episodeId: "transport-qa", episodeFolder: temporary, loadedAt: "transport-qa", hasPlayableProgram: true, message: "Review transport QA",
    program: asset("program", "Program video", "program", video),
    cameras: [1, 2].map((number) => ({ ...asset(`camera-${number}`, `Camera ${number}`, "camera", video), pairedAudioId: "morgan-mic" })),
    audio: [asset("morgan-mic", "Morgan Mic", "audio", audio)]
  };
  const source = (file) => JSON.stringify(path.join(appRoot, "src", file).replaceAll("\\", "/"));
  const entry = path.join(temporary, "transport.tsx");
  await fs.writeFile(entry, `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {TimelineReview} from ${source("renderer/components/TimelineReview.tsx")};
    import {createTimelineDraft} from ${source("shared/timeline.ts")};
    import ${source("renderer/styles.css")};
    import ${source("renderer/workflow.css")};
    import ${source("renderer/studio-clean.css")};
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext { constructor(options) { super({...options, sinkId:{type:'none'}}); } };
    function ReviewQA() {
      const [draft,setDraft]=useState(createTimelineDraft({episodeId:'transport-qa',durationMs:30000,deviceDefaults:{cameras:{camera1:'one',camera2:'two'},microphones:{morganMic:'one'}}}));
      const [media,setMedia]=useState(${JSON.stringify(fixture)});
      window.reviewQA={setMedia};
      return <TimelineReview draft={draft} media={media} onDraftChange={setDraft} onSaveDraft={()=>{}} onExport={()=>{}} onAutoEdit={()=>{}} />;
    }
    createRoot(document.getElementById('root')).render(<ReviewQA/>);
  `);
  await build({ entryPoints: [entry], outfile: path.join(temporary, "transport.js"), bundle: true, jsx: "automatic", nodePaths: [path.join(appRoot, "node_modules")], logLevel: "silent" });
  const page = path.join(temporary, "transport.html");
  await fs.writeFile(page, '<!doctype html><title>What About It Studio — Review transport</title><link rel="stylesheet" href="transport.css"><div id="root"></div><script src="transport.js"></script>');
  await window.loadFile(page);
  const result = await window.webContents.executeJavaScript(`(async () => {
    const wait = async (predicate, message) => {
      const end = performance.now()+5000;
      while (!predicate()) { if(performance.now()>end) throw new Error(message); await new Promise(resolve=>setTimeout(resolve,20)); }
    };
    const currentVideo=()=>document.querySelector('.review-player-stage video.active');
    const playhead=()=>Number(document.querySelector('[aria-label="Episode playhead"]').value);
    const press=(label)=>document.querySelector('[aria-label="'+label+'"]').click();
    const near=(value,target)=>Math.abs(value-target)<0.25;
    const setRange=(value)=>{const input=document.querySelector('[aria-label="Episode playhead"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));};
    await wait(()=>currentVideo()?.readyState>=2,'Video metadata did not load');
    document.querySelector('.transport-play').click();
    await wait(()=>currentVideo().currentTime>0.35,'Video did not play');
    await wait(()=>playhead()>100,'Microphone mix stalled the transport clock');
    document.querySelector('.transport-play').click();
    await wait(()=>currentVideo().paused,'Pause did not stop the video');
    const start=currentVideo().currentTime;
    press('Forward 5 seconds');
    await wait(()=>!currentVideo().seeking && near(currentVideo().currentTime,start+5) && near(playhead()/1000,start+5),'Forward did not seek the video and playhead');
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'j',bubbles:true}));
    await wait(()=>!currentVideo().seeking && near(currentVideo().currentTime,start),'J did not rewind');
    setRange(22000);
    await wait(()=>!currentVideo().seeking && near(currentVideo().currentTime,22) && near(playhead()/1000,22),'Scrubber did not seek');
    if(!currentVideo().paused) throw new Error('Paused scrub unexpectedly started playback');
    const microphone=document.querySelector('.review-player-stage audio');
    if(!near(microphone.currentTime,22)) throw new Error('Microphone did not follow scrub');
    setRange(12000); setRange(18000);
    await wait(()=>!currentVideo().seeking && near(currentVideo().currentTime,18) && near(playhead()/1000,18),'Rapid scrubbing lost the latest target');
    window.reviewQA.setMedia(media=>({...media,program:{...media.program,playbackUrl:media.program.playbackUrl+'?review-refresh=1'}}));
    await wait(()=>currentVideo().currentSrc.includes('review-refresh=1') && currentVideo().readyState>=2 && !currentVideo().seeking && near(currentVideo().currentTime,18),'Review source refresh lost the seek target');
    const camera=[...document.querySelectorAll('.review-source-tabs button')].find(button=>button.textContent.includes('Camera 2'));
    camera.click();
    await wait(()=>currentVideo()?.getAttribute('aria-label')==='Camera 2 playback' && currentVideo().readyState>=2 && !currentVideo().seeking && near(currentVideo().currentTime,18),'Camera source switch lost the playhead');
    document.querySelector('.transport-play').click();
    await wait(()=>!currentVideo().paused && currentVideo().currentTime>18.2,'Camera source did not resume');
    const beforeSkip=currentVideo().currentTime;
    press('Forward 5 seconds');
    await wait(()=>!currentVideo().seeking && currentVideo().currentTime>beforeSkip+4.8 && !currentVideo().paused,'Forward during playback did not preserve playing state');
    const meaningfulScreen=document.body.innerText.includes('Playback controls') || Boolean(document.querySelector('[aria-label="Playback controls"]'));
    return {meaningfulScreen,playheadMs:playhead(),videoSeconds:currentVideo().currentTime,audioSeconds:document.querySelector('.review-player-stage audio')?.currentTime,forward:true,rewind:true,scrub:true,rapidScrub:true,sourceRefresh:true,cameraSwitch:true};
  })()`, true);
  assert.ok(result.meaningfulScreen);
  await fs.writeFile(path.join(temporary, "review-transport.png"), (await window.webContents.capturePage()).toPNG());
  return result;
}
