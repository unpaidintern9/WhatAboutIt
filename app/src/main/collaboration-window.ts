import { BrowserWindow } from "electron";

let collaborationWindow: BrowserWindow | undefined;

const collaborationHtml = `<!doctype html>
<html>
<head>
<meta charset="UTF-8" />
<title>What About It — Collaboration</title>
<style>
:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background:#160f10; color:#f7eee7; }
* { box-sizing:border-box; }
body { margin:0; min-height:100vh; background:radial-gradient(circle at top left,#352024 0,#160f10 42%); }
header { padding:28px 32px 18px; border-bottom:1px solid #4c3235; display:flex; justify-content:space-between; gap:24px; align-items:end; }
h1 { margin:0; font-size:28px; } .eyebrow { color:#d9a46d; text-transform:uppercase; letter-spacing:.14em; font-size:12px; font-weight:700; }
main { padding:24px 32px 40px; display:grid; grid-template-columns:minmax(260px,340px) 1fr; gap:22px; }
.card { background:#211719; border:1px solid #4b3134; border-radius:16px; padding:18px; box-shadow:0 18px 50px #0005; }
label { display:block; color:#cbbab2; font-size:12px; margin:14px 0 6px; } input,select,textarea { width:100%; background:#120c0d; color:#fff7ef; border:1px solid #654447; border-radius:10px; padding:10px 12px; }
textarea { min-height:92px; resize:vertical; } button { border:0; border-radius:10px; padding:10px 14px; cursor:pointer; font-weight:700; background:#a64d49; color:white; } button.secondary { background:#3a292b; } button:disabled { opacity:.45; cursor:not-allowed; }
.row { display:flex; gap:10px; align-items:center; } .row > * { flex:1; } .stack { display:grid; gap:12px; } .muted { color:#ae9b93; font-size:13px; line-height:1.45; }
.member,.comment { padding:12px; border-radius:12px; background:#170f11; border:1px solid #3c292c; } .member strong,.comment strong { display:block; } .badge { display:inline-flex; border:1px solid #6c494d; border-radius:999px; padding:3px 8px; font-size:11px; color:#d9c7bc; margin-top:5px; }
.status { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:14px; } .status strong { font-size:18px; }
.empty { padding:20px; text-align:center; color:#9f8c85; border:1px dashed #4d3437; border-radius:12px; }
@media(max-width:820px){ main{grid-template-columns:1fr} header{align-items:start;flex-direction:column} }
</style>
</head>
<body>
<header><div><div class="eyebrow">What About It Studio</div><h1>Episode Collaboration</h1></div><div class="muted">Local-first now · Cloudflare sync connects next</div></header>
<main>
<section class="card">
  <div class="eyebrow">Episode</div>
  <label for="episode">Choose episode</label><select id="episode"></select>
  <div id="workspaceSummary" class="muted" style="margin-top:12px"></div>
  <hr style="border:0;border-top:1px solid #3c292c;margin:20px 0" />
  <div class="eyebrow">Invite collaborator</div>
  <label for="name">Name</label><input id="name" placeholder="Susan" />
  <label for="email">Email (optional until Cloudflare is connected)</label><input id="email" type="email" placeholder="susan@example.com" />
  <label for="role">Role</label><select id="role"><option value="editor">Editor</option><option value="reviewer">Reviewer</option></select>
  <button id="invite" style="margin-top:12px;width:100%">Add collaborator</button>
</section>
<section class="stack">
  <section class="card"><div class="status"><div><div class="eyebrow">Workflow</div><strong id="title">No episode selected</strong></div><select id="status" style="max-width:220px"><option value="working">Working</option><option value="ready-for-review">Ready for review</option><option value="changes-requested">Changes requested</option><option value="approved">Approved</option></select></div><div id="members" class="stack"></div></section>
  <section class="card"><div class="eyebrow">Notes & review comments</div><label for="comment">Add a comment</label><textarea id="comment" placeholder="Leave an edit note, review note, or handoff instruction…"></textarea><button id="addComment" style="margin-top:10px">Post comment</button><div id="comments" class="stack" style="margin-top:16px"></div></section>
</section>
</main>
<script>
const studio = window.studio;
let currentWorkspace;
const byId = (id) => document.getElementById(id);
function esc(value){ return String(value ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c])); }
function render(workspace){
  currentWorkspace = workspace;
  byId('title').textContent = workspace.episodeTitle;
  byId('status').value = workspace.status;
  byId('workspaceSummary').textContent = workspace.remoteState === 'not-connected' ? 'Stored inside this episode. Nothing is uploaded yet.' : 'Cloud collaboration is connected.';
  byId('members').innerHTML = workspace.members.map(m => '<div class="member"><strong>'+esc(m.name)+'</strong><span class="muted">'+esc(m.email || (m.status === 'active' ? 'Local owner' : 'Email can be added later'))+'</span><div><span class="badge">'+esc(m.role)+'</span> <span class="badge">'+esc(m.status)+'</span></div></div>').join('');
  const memberNames = Object.fromEntries(workspace.members.map(m => [m.id,m.name]));
  const unresolved = workspace.comments.filter(c => !c.resolvedAt).slice().reverse();
  byId('comments').innerHTML = unresolved.length ? unresolved.map(c => '<div class="comment"><strong>'+esc(memberNames[c.authorMemberId] || 'Collaborator')+'</strong><div class="muted">'+new Date(c.createdAt).toLocaleString()+'</div><p>'+esc(c.body)+'</p><button class="secondary resolve" data-id="'+esc(c.id)+'">Resolve</button></div>').join('') : '<div class="empty">No open comments yet.</div>';
  document.querySelectorAll('.resolve').forEach(btn => btn.addEventListener('click', async () => render(await studio.resolveCollaborationComment(workspace.episodeId, btn.dataset.id))));
}
async function loadEpisode(){ const id=byId('episode').value; if(!id)return; render(await studio.getCollaborationWorkspace(id)); }
async function boot(){
  const episodes = await studio.listEpisodes();
  byId('episode').innerHTML = episodes.map(e => '<option value="'+esc(e.id)+'">'+esc(e.title)+'</option>').join('');
  if(!episodes.length){ byId('workspaceSummary').textContent='Create an episode first.'; return; }
  await loadEpisode();
}
byId('episode').addEventListener('change', loadEpisode);
byId('invite').addEventListener('click', async () => { const name=byId('name').value.trim(); if(!name||!currentWorkspace)return; render(await studio.inviteCollaborator(currentWorkspace.episodeId,{name,email:byId('email').value.trim()||undefined,role:byId('role').value})); byId('name').value=''; byId('email').value=''; });
byId('status').addEventListener('change', async () => { if(currentWorkspace) render(await studio.setCollaborationStatus(currentWorkspace.episodeId,byId('status').value)); });
byId('addComment').addEventListener('click', async () => { const body=byId('comment').value.trim(); if(!body||!currentWorkspace)return; const owner=currentWorkspace.members.find(m=>m.role==='owner') || currentWorkspace.members[0]; render(await studio.addCollaborationComment(currentWorkspace.episodeId,{authorMemberId:owner.id,body})); byId('comment').value=''; });
boot().catch(error => { byId('workspaceSummary').textContent = 'Collaboration could not load: '+error.message; });
</script>
</body></html>`;

export function openCollaborationWindow(preloadPath: string) {
  if (collaborationWindow && !collaborationWindow.isDestroyed()) {
    collaborationWindow.focus();
    return collaborationWindow;
  }
  collaborationWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 760,
    minHeight: 620,
    title: "What About It — Collaboration",
    backgroundColor: "#160f10",
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false }
  });
  collaborationWindow.on("closed", () => { collaborationWindow = undefined; });
  void collaborationWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(collaborationHtml)}`);
  return collaborationWindow;
}
