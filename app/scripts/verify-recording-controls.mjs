import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

// Synthetic UI and audio only; never opens a user's capture devices or recordings.
export async function verifyRecordingControls(window, appRoot, temporary) {
  const source = (file) => JSON.stringify(path.join(appRoot, "src", file).replaceAll("\\", "/"));
  const entry = path.join(temporary, "recording-controls.tsx");
  await fs.writeFile(entry, `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {RecordingStudio} from ${source("renderer/components/RecordingStudio.tsx")};
    import {reconnectMicrophoneSelections,assignTwoInputInterface,defaultDeviceDefaults} from ${source("shared/device-config.ts")};
    import {createDefaultPodcastToolsState} from ${source("shared/podcast-tools.ts")};
    import {BrowserMediaRecorderPlugin} from ${source("renderer/plugins/recording/browser-media-recorder-plugin.ts")};
    import ${source("renderer/styles.css")};
    import ${source("renderer/workflow.css")};
    import ${source("renderer/studio-clean.css")};
    const NativeContext=window.AudioContext;
    window.AudioContext=class extends NativeContext {constructor(options){super({...options,sinkId:{type:'none'}})}};
    window.qaPlugin=BrowserMediaRecorderPlugin;
    const microphones=[{id:'new-duo',label:'Line 1/2 (M-Audio M-Track Solo and Duo)',kind:'microphone'}];
    function QA(){
      const [defaults,setDefaults]=useState({...assignTwoInputInterface(defaultDeviceDefaults,'old-duo','Line 1/2 (3- M-Audio M-Track Solo and Duo)'),cameras:{camera1:'one',camera2:'two',camera3:'three'}});
      const [snapshot,setSnapshot]=useState({status:'idle',elapsedMs:0,trackStatuses:[],localSaveMessage:'Ready',mutedMicrophones:[]});
      const unavailable=async()=>{throw new Error('Synthetic QA: no physical devices opened')};
      return <main className="studio-shell studio-shell--recording"><aside className="sidebar">Studio QA</aside><section className="workspace"><RecordingStudio
        episodeTitle="Recording controls QA" defaults={defaults} onDefaultsChange={setDefaults}
        detection={{cameras:['one','two','three'].map(id=>({id,label:id,kind:'camera'})),microphones,speakers:[],permissionNeeded:false}}
        snapshot={snapshot} unfinishedSessions={[]} podcastTools={createDefaultPodcastToolsState('qa')}
        onReconnectInputs={async()=>setDefaults(reconnectMicrophoneSelections(defaults,microphones))}
        onRecordingMuteChange={(slot,muted)=>setSnapshot(s=>({...s,mutedMicrophones:muted?[...s.mutedMicrophones,slot]:s.mutedMicrophones.filter(v=>v!==slot)}))}
        onStart={()=>{window.qaStarted=true;setSnapshot(s=>({...s,status:'recording',health:{programActive:true,sources:[],warnings:[]}}))}}
        onPause={()=>{}} onResume={()=>{}} onStop={()=>{}} onAutoEdit={()=>{}} onExport={()=>{}} onDismissRecovery={()=>{}} onNext={()=>{}}
        onPodcastToolsChange={()=>{}} onPlayTestSound={()=>{}} onOpenCameraPreview={unavailable} onOpenMicrophoneStream={unavailable}
        onReleaseCameraPreview={()=>{}} onReleaseMicrophoneStream={()=>{}} /></section></main>
    }
    createRoot(document.getElementById('root')).render(<QA/>);
  `);
  await build({ entryPoints: [entry], outfile: path.join(temporary, "recording-controls.js"), bundle: true, jsx: "automatic", nodePaths: [path.join(appRoot, "node_modules")], logLevel: "silent" });
  const page = path.join(temporary, "recording-controls.html");
  await fs.writeFile(page, '<!doctype html><title>What About It Studio — Recording controls</title><body data-studio-theme="what-about-it"><link rel="stylesheet" href="recording-controls.css"><div id="root"></div><script src="recording-controls.js"></script></body>');
  window.setContentSize(1280, 720);
  await window.loadFile(page);
  const result = await window.webContents.executeJavaScript(`(async()=>{
    const wait=()=>new Promise(r=>setTimeout(r,100));
    for(let i=0;i<30&&!document.querySelector('button.record');i++)await wait();
    const check=(condition,message)=>{if(!condition)throw new Error(message)};
    const record=document.querySelector('button.record');
    check(record?.disabled,'Missing saved endpoint must block capture');
    check(document.body.innerText.includes('Unavailable saved inputs: Morgan, Guest.'),'Missing inputs should name the mic roles');
    [...document.querySelectorAll('button')].find(b=>b.textContent==='Reconnect inputs').click();await wait();
    check(!record.disabled,'Reconnect should restore the matched interface and enable Record');
    record.click();await wait();check(window.qaStarted,'Record must respond after reconnect');
    const mute=document.querySelector('[aria-label="Morgan recording mute"]');
    check(mute&&!mute.disabled,'Mute must remain available during recording');
    mute.click();await wait();check(mute.getAttribute('aria-pressed')==='true','Recording mute indicator must turn on');
    mute.click();await wait();check(mute.getAttribute('aria-pressed')==='false','Recording mute must toggle off');
    return {meaningfulScreen:document.body.innerText.includes('Recording controls QA'),reconnect:true,record:true,liveMuteControl:true};
  })()`, true);
  const viewports = [];
  for (const [width, height] of [[980, 540], [1366, 768]]) {
    window.setContentSize(width, height);
    const state = await window.webContents.executeJavaScript(`(async()=>{
      await new Promise(r=>setTimeout(r,100));
      const workspace=document.querySelector('.workspace');
      const details=document.querySelector('.secondary-studio-tools');if(details)details.open=true;
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      workspace.scrollTop=workspace.scrollHeight;
      await new Promise(r=>requestAnimationFrame(r));
      const endScrollTop=workspace.scrollTop;
      const transport=document.querySelector('.giant-control-row');
      transport.scrollIntoView({block:'center'});
      await new Promise(r=>requestAnimationFrame(r));
      const controls=transport.getBoundingClientRect();
      return {width:innerWidth,height:innerHeight,endScrollTop,scrollTop:workspace.scrollTop,clientHeight:workspace.clientHeight,scrollHeight:workspace.scrollHeight,controlsReachable:controls.top<innerHeight&&controls.bottom>0};
    })()`, true);
    assert.ok(state.endScrollTop > 0 && state.controlsReachable, JSON.stringify(state));
    viewports.push(state);
  }
  await fs.writeFile(path.join(temporary, "recording-controls.png"), (await window.webContents.capturePage()).toPNG());
  const muteSignal = await window.webContents.executeJavaScript(`(async()=>{
    const context=new AudioContext({sampleRate:48000});const plugin=new window.qaPlugin();
    const merger=context.createChannelMerger(2),destination=context.createMediaStreamDestination();
    const first=context.createOscillator(),second=context.createOscillator();first.frequency.value=440;second.frequency.value=660;
    first.connect(merger,0,0);second.connect(merger,0,1);merger.connect(destination);first.start();second.start();await context.resume();
    plugin.captureDefaults={cameras:{},microphones:{morganMic:'duo',guestMic:'duo'},microphoneChannels:{morganMic:'input-1',guestMic:'input-2'}};
    const router=plugin.createSharedMicrophoneRouter('duo',destination.stream);
    for(const input of ['input-1','input-2'])plugin.cloneSharedMicrophoneRoute(router,input);
    const analysers=['input-1','input-2'].map(input=>{const a=router.audioContext.createAnalyser();router.routes.get(input).route.output.connect(a);return a});
    const levels=()=>analysers.map(a=>{const x=new Float32Array(a.fftSize);a.getFloatTimeDomainData(x);return Math.max(...x.map(Math.abs))});
    const wait=()=>new Promise(r=>setTimeout(r,200));
    try{await wait();const before=levels();plugin.setMicrophoneMuted('morganMic',true);await wait();const muted=levels();plugin.setMicrophoneMuted('morganMic',false);await wait();return {before,muted,restored:levels()}}
    finally{await plugin.shutdown();first.stop();second.stop();await context.close()}
  })()`, true);
  assert.ok(muteSignal.before.every((peak) => peak > 0.1), JSON.stringify(muteSignal));
  assert.ok(muteSignal.muted[0] < 0.000001 && muteSignal.muted[1] > 0.1, JSON.stringify(muteSignal));
  assert.ok(muteSignal.restored.every((peak) => peak > 0.1), JSON.stringify(muteSignal));
  return { ...result, viewports, muteSignal };
}
