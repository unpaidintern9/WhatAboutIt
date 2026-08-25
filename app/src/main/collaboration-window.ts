import { BrowserWindow } from "electron";

let collaborationWindow: BrowserWindow | undefined;

const collaborationHtml = `<!doctype html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>What About It — Collaboration</title>
<style>
:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background:#160f10; color:#f7eee7; }
* { box-sizing:border-box; }
body { margin:0; min-height:100vh; background:radial-gradient(circle at top left,#382126 0,#160f10 38%); }
header { position:sticky; top:0; z-index:4; padding:22px 28px; border-bottom:1px solid #4c3235; background:#160f10ee; backdrop-filter:blur(16px); display:flex; justify-content:space-between; gap:20px; align-items:center; }
h1,h2,h3,p { margin-top:0; } h1 { margin-bottom:4px; font-size:26px; } h2 { margin-bottom:6px; font-size:20px; } h3 { margin-bottom:6px; font-size:15px; }
.eyebrow { color:#d9a46d; text-transform:uppercase; letter-spacing:.14em; font-size:11px; font-weight:800; }
.shell { padding:22px 28px 40px; display:grid; grid-template-columns:300px minmax(0,1fr); gap:20px; }
.sidebar,.card { background:#211719; border:1px solid #4b3134; border-radius:16px; box-shadow:0 18px 50px #0005; }
.sidebar { align-self:start; position:sticky; top:104px; padding:18px; }
.card { padding:18px; } .stack { display:grid; gap:14px; } .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
label { display:block; color:#cbbab2; font-size:12px; margin:13px 0 6px; }
input,select,textarea { width:100%; background:#120c0d; color:#fff7ef; border:1px solid #654447; border-radius:10px; padding:10px 12px; }
textarea { min-height:90px; resize:vertical; }
button { border:0; border-radius:10px; padding:10px 14px; cursor:pointer; font-weight:750; background:#a64d49; color:white; }
button.secondary { background:#3a292b; } button.ghost { background:transparent; border:1px solid #654447; } button:disabled { opacity:.45; cursor:not-allowed; }
.buttonRow { display:flex; flex-wrap:wrap; gap:8px; } .buttonRow button { flex:0 0 auto; }
.muted { color:#ae9b93; font-size:13px; line-height:1.5; } .small { font-size:11px; }
.safety { padding:12px; border:1px solid #4d725b; background:#173122; border-radius:12px; color:#d7f4df; }
.warning { padding:12px; border:1px solid #8a643e; background:#382817; border-radius:12px; color:#f4d7af; }
.syncHero { display:grid; grid-template-columns:1fr auto; gap:16px; align-items:start; }
.metricRow { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-top:14px; }
.metric { padding:12px; border-radius:12px; background:#170f11; border:1px solid #3c292c; } .metric strong { display:block; font-size:20px; margin-bottom:3px; }
.member,.comment,.asset,.uploadChoice { padding:12px; border-radius:12px; background:#170f11; border:1px solid #3c292c; }
.badge { display:inline-flex; border:1px solid #6c494d; border-radius:999px; padding:3px 8px; font-size:11px; color:#d9c7bc; margin:4px 4px 0 0; }
.badge.good { border-color:#4d725b; color:#bce7c9; } .badge.warn { border-color:#8a643e; color:#f4d7af; }
.asset { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:12px; align-items:center; } .asset strong { display:block; overflow-wrap:anywhere; }
.uploadGrid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin-top:12px; }
.uploadChoice { cursor:pointer; } .uploadChoice.selected { border-color:#b96861; box-shadow:0 0 0 1px #b96861 inset; } .uploadChoice input { width:auto; margin-right:6px; }
.sectionHead { display:flex; align-items:end; justify-content:space-between; gap:16px; margin-bottom:12px; }
.empty { padding:18px; text-align:center; color:#9f8c85; border:1px dashed #4d3437; border-radius:12px; }
hr { border:0; border-top:1px solid #3c292c; margin:18px 0; }
@media(max-width:900px){ .shell{grid-template-columns:1fr}.sidebar{position:static}.grid2,.uploadGrid,.metricRow{grid-template-columns:1fr 1fr} }
@media(max-width:620px){ header{align-items:flex-start;flex-direction:column}.grid2,.uploadGrid,.metricRow{grid-template-columns:1fr}.syncHero{grid-template-columns:1fr} }
</style>
</head>
<body>
<header>
  <div><div class="eyebrow">What About It Studio</div><h1>Episode Collaboration</h1><div class="muted">Morgan + Susan · episode-first review, sharing, and cloud handoff</div></div>
  <div><span id="cloudBadge" class="badge warn">Cloudflare not connected</span></div>
</header>
<div class="shell">
  <aside class="sidebar">
    <div class="eyebrow">Episode library</div>
    <label for="episode">Current episode</label><select id="episode"></select>
    <div id="workspaceSummary" class="muted" style="margin-top:10px"></div>
    <div class="buttonRow" style="margin-top:12px"><button id="openFolder" class="secondary">Open local folder</button><button id="refreshAssets" class="ghost">Scan files</button></div>
    <hr />
    <div class="safety"><strong>Local originals stay protected</strong><div class="small" style="margin-top:5px">Cloud sync copies files. It never replaces or deletes Morgan's original recording library.</div></div>
    <hr />
    <div class="eyebrow">Workflow</div>
    <label for="status">Episode status</label><select id="status"><option value="working">Working</option><option value="ready-for-review">Ready for review</option><option value="changes-requested">Changes requested</option><option value="approved">Approved</option></select>
  </aside>
  <main class="stack">
    <section class="card">
      <div class="syncHero"><div><div class="eyebrow">Episode overview</div><h2 id="title">No episode selected</h2><p id="episodeState" class="muted"></p></div><div class="badge good">Local safety copy on</div></div>
      <div class="metricRow"><div class="metric"><strong id="assetCount">0</strong><span class="muted">Indexed files</span></div><div class="metric"><strong id="originalCount">0</strong><span class="muted">Protected originals</span></div><div class="metric"><strong id="proxyCount">0</strong><span class="muted">Editing proxies</span></div><div class="metric"><strong id="commentCount">0</strong><span class="muted">Open comments</span></div></div>
    </section>
    <section class="card">
      <div class="sectionHead"><div><div class="eyebrow">Upload / sync episode</div><h2>Choose what goes to Cloudflare</h2><p class="muted">The app prepares an incremental upload plan from this episode's manifest. Re-scanning detects changed files by content hash.</p></div></div>
      <div class="uploadGrid">
        <label class="uploadChoice selected" data-choice="project-only"><div><input type="radio" name="uploadMode" value="project-only" checked /><strong>Project only</strong></div><div class="muted small">Timeline, comments, captions, markers, metadata. Fastest sync.</div></label>
        <label class="uploadChoice" data-choice="project-and-proxies"><div><input type="radio" name="uploadMode" value="project-and-proxies" /><strong>Project + proxies</strong></div><div class="muted small">Best for Susan. Adds lightweight editing media without full originals.</div></label>
        <label class="uploadChoice" data-choice="full-backup"><div><input type="radio" name="uploadMode" value="full-backup" /><strong>Full cloud backup</strong></div><div class="muted small">Copies originals and project data to cloud while retaining every local original.</div></label>
      </div>
      <div class="buttonRow" style="margin-top:14px"><button id="prepareUpload">Prepare upload</button></div>
      <div id="uploadPlan" class="warning" style="margin-top:12px">Cloudflare connection will be added next. You can build and inspect the upload plan now.</div>
    </section>
    <section class="card">
      <div class="sectionHead"><div><div class="eyebrow">Episode files</div><h2>Local + cloud manifest</h2></div><button id="refreshAssetsTop" class="secondary">Refresh manifest</button></div>
      <div id="assets" class="stack"><div class="empty">Scan the episode to index its media and project files.</div></div>
    </section>
    <div class="grid2">
      <section class="card">
        <div class="eyebrow">People</div><h2>Episode collaborators</h2><div id="members" class="stack"></div>
        <hr /><div class="eyebrow">Invite collaborator</div><label for="name">Name</label><input id="name" placeholder="Susan" /><label for="email">Email</label><input id="email" type="email" placeholder="Optional until Cloudflare is connected" /><label for="role">Role</label><select id="role"><option value="editor">Editor</option><option value="reviewer">Reviewer</option></select><button id="invite" style="margin-top:12px;width:100%">Add collaborator</button>
      </section>
      <section class="card">
        <div class="eyebrow">Review</div><h2>Comments and handoff notes</h2><label for="comment">Add a comment</label><textarea id="comment" placeholder="Leave an edit note, review note, or handoff instruction…"></textarea><button id="addComment" style="margin-top:10px">Post comment</button><div id="comments" class="stack" style="margin-top:16px"></div>
      </section>
    </div>
  </main>
</div>
<script>
const studio = window.studio;
let currentWorkspace;
const byId = (id) => document.getElementById(id);
function esc(value){ return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll(String.fromCharCode(34),'&quot;'); }
function formatBytes(bytes){ if(!bytes)return '0 B'; const units=['B','KB','MB','GB','TB']; let value=bytes,index=0; while(value>=1024&&index<units.length-1){ value/=1024; index++; } return value.toFixed(index ? 1 : 0)+' '+units[index]; }
function renderPlan(workspace){
  const plan=workspace.lastUploadPlan;
  if(!plan){ byId('uploadPlan').textContent='Cloudflare connection will be added next. You can build and inspect the upload plan now.'; return; }
  const originals=plan.assets.filter(a=>a.localOriginal).length;
  const prefix=plan.blockedReason ? 'Upload plan ready — waiting for Cloudflare connection. ' : 'Upload queued. ';
  byId('uploadPlan').textContent=prefix+plan.assets.length+' files · '+formatBytes(plan.totalBytes)+' · '+originals+' protected originals copied, never moved.';
}
function renderAssets(workspace){
  const assets=workspace.assets || [];
  if(!assets.length){ byId('assets').innerHTML='<div class="empty">Scan the episode to index its media and project files.</div>'; return; }
  byId('assets').innerHTML=assets.map(a=>'<div class="asset"><div><strong>'+esc(a.relativePath)+'</strong><div><span class="badge">'+esc(a.kind)+'</span>'+(a.localOriginal?'<span class="badge good">local original protected</span>':'')+'<span class="badge">'+esc(a.state)+'</span></div></div><div class="muted small">'+formatBytes(a.bytes)+'</div></div>').join('');
}
function render(workspace){
  currentWorkspace=workspace;
  byId('title').textContent=workspace.episodeTitle;
  byId('status').value=workspace.status;
  byId('workspaceSummary').textContent=workspace.remoteState==='not-connected'?'Everything is organized inside this local episode. Cloudflare is not connected yet.':'Cloud collaboration is connected.';
  byId('cloudBadge').textContent=workspace.remoteState==='not-connected'?'Cloudflare not connected':'Cloudflare '+workspace.remoteState;
  byId('cloudBadge').className='badge '+(workspace.remoteState==='ready'?'good':'warn');
  byId('episodeState').textContent='Status: '+workspace.status.replaceAll('-',' ')+' · Updated '+new Date(workspace.updatedAt).toLocaleString();
  const assets=workspace.assets || [];
  byId('assetCount').textContent=assets.length;
  byId('originalCount').textContent=assets.filter(a=>a.localOriginal).length;
  byId('proxyCount').textContent=assets.filter(a=>a.kind==='proxy-video').length;
  byId('commentCount').textContent=workspace.comments.filter(c=>!c.resolvedAt).length;
  byId('members').innerHTML=workspace.members.map(m=>'<div class="member"><strong>'+esc(m.name)+'</strong><span class="muted">'+esc(m.email || (m.status==='active'?'Local owner':'Invite activates when cloud identity is connected'))+'</span><div><span class="badge">'+esc(m.role)+'</span><span class="badge">'+esc(m.status)+'</span></div></div>').join('');
  const memberNames=Object.fromEntries(workspace.members.map(m=>[m.id,m.name]));
  const unresolved=workspace.comments.filter(c=>!c.resolvedAt).slice().reverse();
  byId('comments').innerHTML=unresolved.length?unresolved.map(c=>'<div class="comment"><strong>'+esc(memberNames[c.authorMemberId]||'Collaborator')+'</strong><div class="muted small">'+new Date(c.createdAt).toLocaleString()+(c.timelineMs!=null?' · '+Math.floor(c.timelineMs/60000)+':'+String(Math.floor((c.timelineMs%60000)/1000)).padStart(2,'0'):'')+'</div><p>'+esc(c.body)+'</p><button class="secondary resolve" data-id="'+esc(c.id)+'">Resolve</button></div>').join(''):'<div class="empty">No open comments yet.</div>';
  document.querySelectorAll('.resolve').forEach(btn=>btn.addEventListener('click',async()=>render(await studio.resolveCollaborationComment(workspace.episodeId,btn.dataset.id))));
  renderAssets(workspace); renderPlan(workspace);
}
async function loadEpisode(){ const id=byId('episode').value; if(!id)return; render(await studio.getCollaborationWorkspace(id)); }
async function refreshAssets(){ if(!currentWorkspace)return; byId('workspaceSummary').textContent='Scanning episode files and hashing changes…'; render(await studio.refreshCollaborationAssets(currentWorkspace.episodeId)); }
async function boot(){
  const episodes=await studio.listEpisodes();
  byId('episode').innerHTML=episodes.map(e=>'<option value="'+esc(e.id)+'">'+esc(e.title)+'</option>').join('');
  if(!episodes.length){ byId('workspaceSummary').textContent='Create an episode first.'; return; }
  await loadEpisode();
}
document.querySelectorAll('.uploadChoice').forEach(choice=>choice.addEventListener('click',()=>{ document.querySelectorAll('.uploadChoice').forEach(x=>x.classList.remove('selected')); choice.classList.add('selected'); choice.querySelector('input').checked=true; }));
byId('episode').addEventListener('change',loadEpisode);
byId('refreshAssets').addEventListener('click',refreshAssets); byId('refreshAssetsTop').addEventListener('click',refreshAssets);
byId('openFolder').addEventListener('click',async()=>{ if(currentWorkspace)await studio.openCollaborationEpisodeFolder(currentWorkspace.episodeId); });
byId('prepareUpload').addEventListener('click',async()=>{ if(!currentWorkspace)return; const selection=document.querySelector('input[name="uploadMode"]:checked').value; byId('uploadPlan').textContent='Building upload plan…'; render(await studio.prepareCollaborationUpload(currentWorkspace.episodeId,selection)); });
byId('invite').addEventListener('click',async()=>{ const name=byId('name').value.trim(); if(!name||!currentWorkspace)return; render(await studio.inviteCollaborator(currentWorkspace.episodeId,{name,email:byId('email').value.trim()||undefined,role:byId('role').value})); byId('name').value=''; byId('email').value=''; });
byId('status').addEventListener('change',async()=>{ if(currentWorkspace)render(await studio.setCollaborationStatus(currentWorkspace.episodeId,byId('status').value)); });
byId('addComment').addEventListener('click',async()=>{ const body=byId('comment').value.trim(); if(!body||!currentWorkspace)return; const owner=currentWorkspace.members.find(m=>m.role==='owner')||currentWorkspace.members[0]; render(await studio.addCollaborationComment(currentWorkspace.episodeId,{authorMemberId:owner.id,body})); byId('comment').value=''; });
boot().catch(error=>{ byId('workspaceSummary').textContent='Collaboration could not load: '+error.message; });
</script>
</body></html>`;

export function openCollaborationWindow(preloadPath: string) {
  if (collaborationWindow && !collaborationWindow.isDestroyed()) {
    collaborationWindow.focus();
    return collaborationWindow;
  }
  collaborationWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 800,
    minHeight: 640,
    title: "What About It — Collaboration",
    backgroundColor: "#160f10",
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false }
  });
  collaborationWindow.on("closed", () => { collaborationWindow = undefined; });
  void collaborationWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(collaborationHtml)}`);
  return collaborationWindow;
}
