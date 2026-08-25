import { contextBridge, ipcRenderer } from "electron";
import type { EpisodeMetadata, StudioSettings } from "../shared/types";
import type { RecordingChunkInput, RecordingFinalizeResult, RecordingSession, RecordingSessionCreateInput, RecordingState, RecordingTrackSaveInput, RecordingTrackSaveResult } from "../shared/recording";
import type { PodcastToolsState } from "../shared/podcast-tools";
import type { TimelineDraft } from "../shared/timeline";
import type { ExportJob, ExportRequest, MediaToolsStatus } from "../shared/export";
import type { AutoEditLearningProfile, AutoEditMode, AutoEditResult } from "../shared/auto-edit";
import type { DiagnosticsBundleRequest, DiagnosticsBundleResult, LiveLogInfo, RuntimeLogEntry, StorageStatus } from "../shared/diagnostics";
import type { ReviewMediaImportProgress, ReviewMediaImportResult, ReviewMediaImportSlot, ReviewMediaIntegrityResult, ReviewMediaInventory, ReviewMediaSyncResult, ReviewMediaTreatmentPreview } from "../shared/review-media";
import type { EpisodeCleanupScope, EpisodeStorageSummary } from "../shared/episode-maintenance";
import type { StudioDisplayInfo, StudioLayoutProfileId, StudioPanelId, StudioWindowState, StudioWorkspaceState } from "../shared/studio-workspace";
import type { AppUpdateStatus } from "../shared/app-update";
import type { LocalTranscriptionProgress, LocalTranscriptionResult, LocalTranscriptionStatus } from "../shared/local-transcription";
import type { MediaAccessStatus } from "../shared/media-permissions";
import type { CloudEpisodeSummary, CollaborationSyncResult, CollaborationUploadSelection } from "../shared/collaboration";

contextBridge.exposeInMainWorld("studio", {
  listEpisodes: (): Promise<EpisodeMetadata[]> => ipcRenderer.invoke("episodes:list"),
  createEpisode: (input: { title: string; guestName?: string; description?: string }): Promise<EpisodeMetadata> => ipcRenderer.invoke("episodes:create", input),
  openEpisodeFolder: (episodeId: string): Promise<string> => ipcRenderer.invoke("episodes:open-folder", episodeId),
  openEpisodeLibraryFolder: (): Promise<string> => ipcRenderer.invoke("episodes:open-library-folder"),
  chooseLocalEpisodeFolder: (): Promise<EpisodeMetadata | undefined> => ipcRenderer.invoke("episodes:choose-local"),
  listCloudEpisodes: (): Promise<CloudEpisodeSummary[]> => ipcRenderer.invoke("collaboration:cloud:list"),
  uploadEpisodeToCloud: (episodeId: string, selection: CollaborationUploadSelection = "full-backup"): Promise<CollaborationSyncResult> => ipcRenderer.invoke("collaboration:cloud:upload", { episodeId, selection }),
  downloadCloudEpisode: (episodeId: string): Promise<{ episode: EpisodeMetadata; sync: CollaborationSyncResult }> => ipcRenderer.invoke("collaboration:cloud:download", episodeId),
  getSettings: (): Promise<StudioSettings> => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: StudioSettings): Promise<StudioSettings> => ipcRenderer.invoke("settings:save", settings),
  createRecordingSession: (input: RecordingSessionCreateInput): Promise<RecordingSession> => ipcRenderer.invoke("recording:create-session", input),
  writeRecordingState: (folderPath: string, state: RecordingState): Promise<RecordingState> => ipcRenderer.invoke("recording:write-state", { folderPath, state }),
  beginRecordingMedia: (folderPath: string): Promise<void> => ipcRenderer.invoke("recording:begin-media", folderPath),
  appendRecordingChunk: (folderPath: string, chunk: RecordingChunkInput): Promise<{ bytesWritten: number; lastChunkAt: string }> => ipcRenderer.invoke("recording:append-chunk", { folderPath, chunk }),
  finalizeRecordingMedia: (folderPath: string): Promise<RecordingFinalizeResult> => ipcRenderer.invoke("recording:finalize-media", folderPath),
  recoverRecordingSession: (folderPath: string): Promise<RecordingFinalizeResult> => ipcRenderer.invoke("recording:recover", folderPath),
  openRecordingFolder: (folderPath: string): Promise<string> => ipcRenderer.invoke("recording:open-folder", folderPath),
  chooseRecordingPrimaryFolder: (): Promise<string | undefined> => ipcRenderer.invoke("recording:choose-primary-folder"),
  chooseRecordingBackupFolder: (): Promise<string | undefined> => ipcRenderer.invoke("recording:choose-backup-folder"),
  setRecordingCloseProtection: (active: boolean): void => ipcRenderer.send("recording:set-close-protection", active),
  saveProgramRecording: (folderPath: string, bytes: Uint8Array): Promise<string> => ipcRenderer.invoke("recording:save-program", { folderPath, bytes }),
  saveRecordedTracks: (folderPath: string, tracks: RecordingTrackSaveInput[]): Promise<RecordingTrackSaveResult[]> => ipcRenderer.invoke("recording:save-tracks", { folderPath, tracks }),
  appendRecordingError: (folderPath: string, message: string): Promise<void> => ipcRenderer.invoke("recording:append-error", { folderPath, message }),
  listUnfinishedRecordingSessions: (): Promise<RecordingSession[]> => ipcRenderer.invoke("recording:list-unfinished"),
  loadPodcastTools: (episodeId: string): Promise<PodcastToolsState> => ipcRenderer.invoke("podcast-tools:load", episodeId),
  savePodcastTools: (episodeId: string, state: PodcastToolsState): Promise<PodcastToolsState> => ipcRenderer.invoke("podcast-tools:save", { episodeId, state }),
  loadTimelineDraft: (episodeId: string): Promise<TimelineDraft | null> => ipcRenderer.invoke("timeline:load", episodeId),
  saveTimelineDraft: (episodeId: string, draft: TimelineDraft): Promise<TimelineDraft> => ipcRenderer.invoke("timeline:save", { episodeId, draft }),
  getLocalTranscriptionStatus: (): Promise<LocalTranscriptionStatus> => ipcRenderer.invoke("local-transcription:status"),
  transcribeEpisodeLocally: (episodeId: string): Promise<LocalTranscriptionResult> => ipcRenderer.invoke("local-transcription:start", episodeId),
  cancelLocalTranscription: (episodeId: string): Promise<boolean> => ipcRenderer.invoke("local-transcription:cancel", episodeId),
  onLocalTranscriptionProgress: (listener: (progress: LocalTranscriptionProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: LocalTranscriptionProgress) => listener(progress);
    ipcRenderer.on("local-transcription:progress", handler);
    return () => ipcRenderer.removeListener("local-transcription:progress", handler);
  },
  loadReviewMedia: (episodeId: string): Promise<ReviewMediaInventory> => ipcRenderer.invoke("review-media:load", episodeId),
  importReviewMedia: (episodeId: string, slot: ReviewMediaImportSlot): Promise<ReviewMediaImportResult> => ipcRenderer.invoke("review-media:import", { episodeId, slot }),
  cancelReviewMediaImport: (episodeId: string, slot: ReviewMediaImportSlot): Promise<boolean> => ipcRenderer.invoke("review-media:cancel-import", { episodeId, slot }),
  onReviewMediaImportProgress: (listener: (progress: ReviewMediaImportProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ReviewMediaImportProgress) => listener(progress);
    ipcRenderer.on("review-media:import-progress", handler);
    return () => ipcRenderer.removeListener("review-media:import-progress", handler);
  },
  autoSyncReviewMedia: (episodeId: string): Promise<ReviewMediaSyncResult> => ipcRenderer.invoke("review-media:auto-sync", episodeId),
  verifyReviewMediaOriginals: (episodeId: string): Promise<ReviewMediaIntegrityResult> => ipcRenderer.invoke("review-media:verify-originals", episodeId),
  relinkReviewMedia: (episodeId: string, slot: ReviewMediaImportSlot): Promise<ReviewMediaImportResult> => ipcRenderer.invoke("review-media:relink", { episodeId, slot }),
  getEpisodeStorageSummary: (episodeId: string): Promise<EpisodeStorageSummary> => ipcRenderer.invoke("episode-storage:get", episodeId),
  cleanupEpisodeStorage: (episodeId: string, scope: EpisodeCleanupScope): Promise<EpisodeStorageSummary> => ipcRenderer.invoke("episode-storage:cleanup", { episodeId, scope }),
  renderTrackTreatmentPreview: (episodeId: string, draft: TimelineDraft, trackId: string, timestampMs: number): Promise<ReviewMediaTreatmentPreview> => ipcRenderer.invoke("review-media:treatment-preview", { episodeId, draft, trackId, timestampMs }),
  runAutoEdit: (episodeId: string, draft: TimelineDraft, mode: AutoEditMode, practice?: boolean, learningProfile?: AutoEditLearningProfile): Promise<AutoEditResult> =>
    ipcRenderer.invoke("auto-edit:run", {
      episodeId,
      draft,
      mode,
      practice,
      learningProfile
    }),
  createExport: (request: ExportRequest): Promise<ExportJob> => ipcRenderer.invoke("export:create", request),
  chooseExportDestinationFolder: (): Promise<string | undefined> => ipcRenderer.invoke("export:choose-destination"),
  onExportProgress: (listener: (job: ExportJob) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, job: ExportJob) => listener(job);
    ipcRenderer.on("export:progress", handler);
    return () => ipcRenderer.removeListener("export:progress", handler);
  },
  getMediaToolsStatus: (): Promise<MediaToolsStatus> => ipcRenderer.invoke("export:media-tools-status"),
  cancelExport: (episodeId: string, job: ExportJob): Promise<ExportJob> => ipcRenderer.invoke("export:cancel", { episodeId, job }),
  openExportFolder: (episodeId: string, outputFolder?: string): Promise<string> => ipcRenderer.invoke("export:open-folder", { episodeId, outputFolder }),
  createDiagnosticsBundle: (input: DiagnosticsBundleRequest): Promise<DiagnosticsBundleResult> => ipcRenderer.invoke("diagnostics:create", input),
  getLiveLogInfo: (): Promise<LiveLogInfo> => ipcRenderer.invoke("diagnostics:get-live-log-info"),
  openLiveLogs: (): Promise<LiveLogInfo> => ipcRenderer.invoke("diagnostics:open-live-logs"),
  writeRuntimeLog: (entry: RuntimeLogEntry): Promise<void> => ipcRenderer.invoke("diagnostics:write-runtime-log", entry),
  getStorageStatus: (): Promise<StorageStatus> => ipcRenderer.invoke("storage:status"),
  getCameraAccessStatus: (): Promise<MediaAccessStatus> => ipcRenderer.invoke("media-permissions:get-camera-status"),
  openCameraPrivacySettings: (): Promise<boolean> => ipcRenderer.invoke("media-permissions:open-camera-settings"),
  getWorkspaceState: (): Promise<StudioWorkspaceState> => ipcRenderer.invoke("workspace:get-state"),
  saveWorkspaceState: (state: StudioWorkspaceState): Promise<StudioWorkspaceState> => ipcRenderer.invoke("workspace:save-state", state),
  getDisplays: (): Promise<StudioDisplayInfo[]> => ipcRenderer.invoke("workspace:get-displays"),
  openWorkspacePanel: (panelId: StudioPanelId, input?: { episodeId?: string; displayId?: number; fullscreen?: boolean }): Promise<StudioWindowState> => ipcRenderer.invoke("workspace:open-panel", { panelId, ...input }),
  closeWorkspacePanel: (panelId: StudioPanelId): Promise<StudioWindowState> => ipcRenderer.invoke("workspace:close-panel", panelId),
  moveWorkspacePanel: (panelId: StudioPanelId, displayId: number): Promise<StudioWindowState> => ipcRenderer.invoke("workspace:move-panel", { panelId, displayId }),
  applyWorkspaceLayout: (layoutId: StudioLayoutProfileId, episodeId?: string): Promise<StudioWorkspaceState> => ipcRenderer.invoke("workspace:apply-layout", { layoutId, episodeId }),
  resetWorkspaceLayout: (): Promise<StudioWorkspaceState> => ipcRenderer.invoke("workspace:reset-layout"),
  getAppUpdateStatus: (): Promise<AppUpdateStatus> => ipcRenderer.invoke("app-update:get-status"),
  checkForAppUpdate: (): Promise<AppUpdateStatus> => ipcRenderer.invoke("app-update:check"),
  downloadAppUpdate: (): Promise<AppUpdateStatus> => ipcRenderer.invoke("app-update:download"),
  installAppUpdate: (): Promise<boolean> => ipcRenderer.invoke("app-update:install"),
  onAppUpdateStatus: (listener: (status: AppUpdateStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: AppUpdateStatus) => listener(status);
    ipcRenderer.on("app:update-status", handler);
    return () => ipcRenderer.removeListener("app:update-status", handler);
  }
});

function ensureReviewCollaborationButton() {
  const navReview = document.querySelector<HTMLButtonElement>('button[data-label="Review"]');
  if (navReview) {
    navReview.disabled = false;
    navReview.title = "Choose a local or Cloudflare episode to review";
  }
  const actions = document.querySelector<HTMLElement>(".timeline-review .edit-studio-actions");
  if (!actions) return;
  if (!actions.querySelector("[data-episode-library-launcher]")) {
    const episodesButton = document.createElement("button");
    episodesButton.type = "button";
    episodesButton.dataset.episodeLibraryLauncher = "true";
    episodesButton.textContent = "Episodes";
    episodesButton.title = "Choose another local or Cloudflare episode to review";
    episodesButton.addEventListener("click", () => void openReviewEpisodeLibrary());
    actions.prepend(episodesButton);
  }
  if (!actions.querySelector("[data-collaboration-launcher]")) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.collaborationLauncher = "true";
    button.textContent = "Collaborate / Sync";
    button.title = "Open episode collaboration, comments, file manifest, and cloud upload";
    button.addEventListener("click", () => void ipcRenderer.invoke("collaboration:open-center"));
    actions.prepend(button);
  }
}

const reviewLibraryStyle = `
  position:fixed;inset:0;z-index:2147483646;background:rgba(8,5,6,.78);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:28px;
`;

let reviewLibraryOpen = false;
let activatingRequestedEpisode = false;

function makeActionButton(label: string, action: string, episodeId?: string, secondary = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.libraryAction = action;
  if (episodeId) button.dataset.episodeId = episodeId;
  button.style.cssText = `border:1px solid ${secondary ? "#68484b" : "#b65a54"};background:${secondary ? "#342426" : "#a64d49"};color:#fff;border-radius:9px;padding:8px 11px;font-weight:700;cursor:pointer;`;
  return button;
}

function episodeRow(title: string, detail: string, source: "local" | "cloud", episodeId: string) {
  const row = document.createElement("div");
  row.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center;padding:14px;border:1px solid #4b3134;border-radius:12px;background:#211719;margin-top:10px;";
  const info = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = title;
  heading.style.cssText = "display:block;font-size:15px;color:#fff6ef;margin-bottom:4px;";
  const metadata = document.createElement("span");
  metadata.textContent = detail;
  metadata.style.cssText = "font-size:12px;color:#bda9a2;";
  info.append(heading, metadata);
  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end;";
  if (source === "local") {
    actions.append(makeActionButton("Review", "review-local", episodeId), makeActionButton("Open Folder", "open-folder", episodeId, true), makeActionButton("Upload / Sync", "upload", episodeId, true));
  } else {
    actions.append(makeActionButton("Review from Cloud", "review-cloud", episodeId));
  }
  row.append(info, actions);
  return row;
}

async function populateReviewLibrary(container: HTMLElement, status: HTMLElement) {
  container.replaceChildren();
  status.textContent = "Loading local and cloud episodes…";
  const [localEpisodes, cloudResult, config] = await Promise.all([
    ipcRenderer.invoke("episodes:list") as Promise<EpisodeMetadata[]>,
    (ipcRenderer.invoke("collaboration:cloud:list") as Promise<CloudEpisodeSummary[]>).catch(() => []),
    (ipcRenderer.invoke("collaboration:remote-config:get") as Promise<{ apiUrl?: string }>).catch((): { apiUrl?: string } => ({}))
  ]);

  const localTitle = document.createElement("h3");
  localTitle.textContent = "On this computer";
  localTitle.style.cssText = "margin:4px 0 3px;color:#f6e5dd;font-size:16px;";
  container.append(localTitle);
  if (localEpisodes.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No local episodes yet.";
    empty.style.cssText = "color:#bda9a2;font-size:13px;";
    container.append(empty);
  } else {
    localEpisodes.forEach((episode) => container.append(episodeRow(episode.title, `${episode.guestName || "Solo episode"} · ${new Date(episode.createdAt).toLocaleDateString()} · Local`, "local", episode.id)));
  }

  const cloudTitle = document.createElement("h3");
  cloudTitle.textContent = "Cloudflare shared episodes";
  cloudTitle.style.cssText = "margin:22px 0 3px;color:#f6e5dd;font-size:16px;";
  container.append(cloudTitle);
  if (!config.apiUrl) {
    const empty = document.createElement("p");
    empty.textContent = "Cloudflare is not connected yet. Local review still works normally.";
    empty.style.cssText = "color:#bda9a2;font-size:13px;";
    container.append(empty);
  } else if (cloudResult.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No episodes have been uploaded to Cloudflare yet.";
    empty.style.cssText = "color:#bda9a2;font-size:13px;";
    container.append(empty);
  } else {
    cloudResult.forEach((episode) => container.append(episodeRow(episode.title, `${episode.guestName || "Solo episode"} · ${episode.assetCount} files · Cloud`, "cloud", episode.id)));
  }
  status.textContent = "Choose an episode. Local originals stay on the recording computer; cloud review downloads only what needs updating.";
}

function requestEpisodeActivation(episodeId: string) {
  window.sessionStorage.setItem("whataboutit-review-episode-id", episodeId);
  const next = new URL(window.location.href);
  next.searchParams.set("view", "home");
  next.searchParams.set("reviewEpisode", episodeId);
  window.location.assign(next.toString());
}

async function activateRequestedEpisode() {
  if (activatingRequestedEpisode) return;
  const episodeId = window.sessionStorage.getItem("whataboutit-review-episode-id") || new URLSearchParams(window.location.search).get("reviewEpisode");
  if (!episodeId) return;
  const cards = Array.from(document.querySelectorAll<HTMLButtonElement>(".episode-card"));
  if (cards.length === 0) return;
  activatingRequestedEpisode = true;
  try {
    const episodes = (await ipcRenderer.invoke("episodes:list")) as EpisodeMetadata[];
    const index = episodes.findIndex((episode) => episode.id === episodeId);
    if (index < 0 || !cards[index]) return;
    window.sessionStorage.removeItem("whataboutit-review-episode-id");
    cards[index].click();
  } finally {
    activatingRequestedEpisode = false;
  }
}

async function openReviewEpisodeLibrary() {
  if (reviewLibraryOpen) return;
  reviewLibraryOpen = true;
  const overlay = document.createElement("div");
  overlay.dataset.reviewEpisodeLibrary = "true";
  overlay.style.cssText = reviewLibraryStyle;
  const panel = document.createElement("section");
  panel.style.cssText = "width:min(920px,96vw);max-height:88vh;overflow:auto;background:#160f10;border:1px solid #5d3a3d;border-radius:18px;padding:20px;box-shadow:0 24px 80px rgba(0,0,0,.5);font-family:Inter,system-ui,sans-serif;color:#f7eee7;";
  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;gap:16px;align-items:flex-start;";
  const copy = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = "Review an Episode";
  title.style.cssText = "margin:0;font-size:24px;";
  const subtitle = document.createElement("p");
  subtitle.textContent = "Open a local episode or a shared Cloudflare episode. The selected episode's file folder opens with Review.";
  subtitle.style.cssText = "margin:6px 0 0;color:#bda9a2;font-size:13px;";
  copy.append(title, subtitle);
  const close = makeActionButton("Close", "close", undefined, true);
  header.append(copy, close);
  const utilities = document.createElement("div");
  utilities.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 8px;";
  utilities.append(makeActionButton("Open from this computer", "choose-local"), makeActionButton("Open Episodes Folder", "open-library", undefined, true), makeActionButton("Refresh", "refresh", undefined, true));
  const status = document.createElement("p");
  status.style.cssText = "min-height:18px;color:#ceb9b0;font-size:12px;margin:10px 0;";
  const list = document.createElement("div");
  panel.append(header, utilities, status, list);
  overlay.append(panel);
  document.body.append(overlay);

  const closeOverlay = () => {
    reviewLibraryOpen = false;
    overlay.remove();
  };

  overlay.addEventListener("click", async (event) => {
    if (event.target === overlay) {
      closeOverlay();
      return;
    }
    const button = (event.target as Element | null)?.closest("[data-library-action]") as HTMLButtonElement | null;
    if (!button) return;
    const action = button.dataset.libraryAction;
    const episodeId = button.dataset.episodeId;
    try {
      if (action === "close") return closeOverlay();
      if (action === "refresh") return void populateReviewLibrary(list, status);
      if (action === "open-library") {
        await ipcRenderer.invoke("episodes:open-library-folder");
        return;
      }
      if (action === "choose-local") {
        const episode = (await ipcRenderer.invoke("episodes:choose-local")) as EpisodeMetadata | undefined;
        if (episode) requestEpisodeActivation(episode.id);
        return;
      }
      if (!episodeId) return;
      if (action === "open-folder") {
        await ipcRenderer.invoke("episodes:open-folder", episodeId);
        return;
      }
      if (action === "review-local") {
        await ipcRenderer.invoke("episodes:open-folder", episodeId);
        requestEpisodeActivation(episodeId);
        return;
      }
      if (action === "upload") {
        button.disabled = true;
        status.textContent = "Uploading changed episode files to Cloudflare. Local originals are staying in place…";
        const result = (await ipcRenderer.invoke("collaboration:cloud:upload", { episodeId, selection: "full-backup" })) as CollaborationSyncResult;
        status.textContent = result.message;
        button.disabled = false;
        await populateReviewLibrary(list, status);
        return;
      }
      if (action === "review-cloud") {
        button.disabled = true;
        status.textContent = "Syncing this Cloudflare episode to the local episode folder…";
        const result = (await ipcRenderer.invoke("collaboration:cloud:download", episodeId)) as { episode: EpisodeMetadata; sync: CollaborationSyncResult };
        status.textContent = result.sync.message;
        requestEpisodeActivation(result.episode.id);
      }
    } catch (error) {
      button.disabled = false;
      status.textContent = error instanceof Error ? error.message : "That episode action could not finish.";
    }
  });

  await populateReviewLibrary(list, status).catch((error) => {
    status.textContent = error instanceof Error ? error.message : "The episode library could not load.";
  });
}

function interceptReviewNavigation() {
  document.addEventListener(
    "click",
    (event) => {
      const reviewButton = (event.target as Element | null)?.closest('button[data-label="Review"]') as HTMLButtonElement | null;
      if (!reviewButton) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void openReviewEpisodeLibrary();
    },
    true
  );
}

window.addEventListener("DOMContentLoaded", () => {
  ensureReviewCollaborationButton();
  interceptReviewNavigation();
  void activateRequestedEpisode();
  const observer = new MutationObserver(() => {
    ensureReviewCollaborationButton();
    void activateRequestedEpisode();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
});
