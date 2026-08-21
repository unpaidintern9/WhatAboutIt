import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Brush, Camera, CheckCircle2, Clapperboard, Circle, Compass, Download, FolderOpen, Headphones, HardDrive, Mic2, Plus, RefreshCw, Scissors, Settings, ShieldCheck, Sparkles, ListVideo, Wand2, X } from "lucide-react";
import type { DeviceDefaults, EpisodeMetadata, StudioSettings } from "../shared/types";
import { defaultRecordingPreferences } from "../shared/types";
import type { RecordingSession } from "../shared/recording";
import type { PodcastToolsState, SoundSlot } from "../shared/podcast-tools";
import { createDefaultPodcastToolsState, createLiveMarker, withPodcastToolDefaults } from "../shared/podcast-tools";
import type { TimelineDraft } from "../shared/timeline";
import { createTimelineDraft, setTimelineEditOperationEnabled, syncTimelineTracksWithMedia, updateTimelineSyncOffsets, withTimelineDraftDefaults } from "../shared/timeline";
import type { ExportJob, ExportMasteringMode, ExportQualityPreset, ExportType, MediaToolsStatus } from "../shared/export";
import { defaultExportSettings } from "../shared/export";
import type { ReviewMediaImportProgress, ReviewMediaImportSlot, ReviewMediaInventory } from "../shared/review-media";
import type { AutoEditMode, AutoEditResult } from "../shared/auto-edit";
import { learnAutoEditProfile, runOfflineAutoEdit } from "../shared/auto-edit";
import type { StudioDisplayInfo, StudioLayoutProfileId, StudioPanelId, StudioWorkspaceState } from "../shared/studio-workspace";
import { defaultStudioWorkspaceState, studioPanelLabels, withStudioWorkspaceDefaults } from "../shared/studio-workspace";
import type { AppUpdateStatus } from "../shared/app-update";
import { createInitialAppUpdateStatus } from "../shared/app-update";
import type { LocalTranscriptionProgress, LocalTranscriptionResult, LocalTranscriptionStatus } from "../shared/local-transcription";
import { defaultDeviceDefaults, withDeviceDefaults } from "../shared/device-config";
import type { HardwareTestResults, HardwareTestStep } from "../shared/hardware-test";
import { createHardwareTestResults, didDeviceDisconnectDuringRecording, getHardwareDeviceReadiness, getExportTestStatus, getFriendlyHardwareFailureMessage, getNextHardwareTestStep, getRecordingTestStatus, type DiagnosticsBundleResult, type HardwareDeviceSummary } from "../shared/hardware-test";
import type { LiveLogInfo, StorageStatus } from "../shared/diagnostics";
import { assessRecordingStorage } from "../shared/diagnostics";
import { cameraAccessMessage, type MediaAccessStatus } from "../shared/media-permissions";
import { AutoEditReview, Button, CameraPreview, DeviceSetupWizard, ExportEpisode, RecordingStudio, TimelineReview } from "./components";
import { AudioMeter } from "./components";
import { StudioPopOutPanel } from "./components/StudioToolPanels";
import { browserDevicePlugin } from "./plugins/devices/browser-device-plugin";
import { BrowserMediaRecorderPlugin } from "./plugins/recording/browser-media-recorder-plugin";
import type { DeviceDetectionResult } from "./plugins/devices/types";
import { DeviceService, ExportService, RecordingService, formatRecordingTime, type RecordingServiceSnapshot } from "./services";
import { TimelineSaveQueue } from "./services/timeline-save-queue";
import { applyTheme, builtInThemes, findTheme } from "./theme/themes";
import "./styles.css";

type View = "home" | "new-episode" | "device-setup" | "recording" | "timeline-review" | "auto-edit-review" | "export" | "hardware-test" | "settings" | "learn" | "practice" | "theme-editor";
type TimelineSaveState = "saved" | "saving" | "failed";
type WorkspaceBridge = Required<Pick<Window["studio"], "getWorkspaceState" | "saveWorkspaceState" | "getDisplays" | "openWorkspacePanel" | "closeWorkspacePanel" | "moveWorkspacePanel" | "applyWorkspaceLayout" | "resetWorkspaceLayout">>;
type StudioBridge = Window["studio"] & WorkspaceBridge;

function getInitialView(): View {
  if (typeof window === "undefined") return "home";
  const requestedView = new URLSearchParams(window.location.search).get("view");
  const views: View[] = ["home", "new-episode", "device-setup", "recording", "timeline-review", "auto-edit-review", "export", "hardware-test", "settings", "learn", "practice", "theme-editor"];
  return views.includes(requestedView as View) ? (requestedView as View) : "home";
}

const fallbackSettings: StudioSettings = {
  activeThemeId: "what-about-it",
  defaultEpisodeFolderName: "episodes",
  practiceModeEnabled: false,
  deviceDefaults: defaultDeviceDefaults,
  exportSettings: defaultExportSettings,
  onboarding: { guidedTour: "show" },
  ui: { sidebarCollapsed: true },
  studioWorkspace: defaultStudioWorkspaceState.settings,
  recordingPreferences: defaultRecordingPreferences
};

function withExportSettings(settings: StudioSettings): StudioSettings {
  return {
    ...settings,
    exportSettings: { ...defaultExportSettings, ...settings.exportSettings }
  };
}

function withRecordingSettings(settings: StudioSettings): StudioSettings {
  return {
    ...settings,
    recordingPreferences: { ...defaultRecordingPreferences, ...settings.recordingPreferences, countdownSeconds: 0 }
  };
}

const emptyDetection: DeviceDetectionResult = {
  cameras: [],
  microphones: [],
  speakers: [],
  permissionNeeded: false
};

const idleRecordingSnapshot: RecordingServiceSnapshot = {
  status: "idle",
  elapsedMs: 0,
  localSaveMessage: "Everything is saving locally",
  trackStatuses: []
};

function getInitialRecordingSnapshot(): RecordingServiceSnapshot {
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("recording") === "complete") {
    return {
      status: "stopped",
      elapsedMs: 112000,
      localSaveMessage: "Everything is saving locally",
      trackStatuses: []
    };
  }
  return idleRecordingSnapshot;
}

function createWorkspaceBridgeFallback(): WorkspaceBridge {
  return {
    getWorkspaceState: async () => defaultStudioWorkspaceState,
    saveWorkspaceState: async (state) => state,
    getDisplays: async () => [
      {
        id: 1,
        label: "Primary monitor",
        primary: true,
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
        workArea: { x: 0, y: 0, width: 1440, height: 860 },
        scaleFactor: 1
      },
      {
        id: 2,
        label: "Monitor 2",
        primary: false,
        bounds: { x: 1440, y: 0, width: 1920, height: 1080 },
        workArea: { x: 1440, y: 0, width: 1920, height: 1040 },
        scaleFactor: 1
      }
    ],
    openWorkspacePanel: async (panelId, input) => ({
      panelId,
      isPoppedOut: true,
      displayId: input?.displayId,
      collapsed: false,
      fullscreen: Boolean(input?.fullscreen)
    }),
    closeWorkspacePanel: async (panelId) => ({
      panelId,
      isPoppedOut: false,
      collapsed: false,
      fullscreen: false
    }),
    moveWorkspacePanel: async (panelId, displayId) => ({
      panelId,
      isPoppedOut: true,
      displayId,
      collapsed: false,
      fullscreen: false
    }),
    applyWorkspaceLayout: async (layoutId) => ({
      ...defaultStudioWorkspaceState,
      settings: {
        ...defaultStudioWorkspaceState.settings,
        activeLayoutId: layoutId
      }
    }),
    resetWorkspaceLayout: async () => defaultStudioWorkspaceState
  };
}

function getStudioBridge(): StudioBridge {
  if (window.studio) return { ...createWorkspaceBridgeFallback(), ...window.studio };

  const now = new Date().toISOString();
  const searchParams = new URLSearchParams(window.location.search);
  const isWelcomeReview = searchParams.get("tour") === "on";
  const demoSettings: StudioSettings = {
    ...fallbackSettings,
    deviceDefaults: {
      cameras: isWelcomeReview ? {} : { camera1: "demo-camera-1" },
      microphones: isWelcomeReview ? {} : { morganMic: "demo-mic-1" },
      audioOutputId: isWelcomeReview ? undefined : "demo-speakers"
    },
    onboarding: { guidedTour: isWelcomeReview ? "show" : "never" }
  };

  return {
    ...createWorkspaceBridgeFallback(),
    listEpisodes: async () =>
      isWelcomeReview
        ? []
        : [
            {
              id: "review-episode",
              title: "First What About It? Episode",
              guestName: "Solo episode",
              description: "Review fixture",
              status: "draft",
              createdAt: now,
              updatedAt: now,
              folderPath: "review-only",
              phase: "phase-1-shell"
            }
          ],
    createEpisode: async (input) => ({
      id: "review-new-episode",
      title: input.title || "Review Episode",
      guestName: input.guestName,
      description: input.description,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      folderPath: "review-only",
      phase: "phase-1-shell"
    }),
    getSettings: async () => demoSettings,
    saveSettings: async (nextSettings) => nextSettings,
    createRecordingSession: async () => ({
      id: "review-session",
      episodeId: "review-episode",
      episodeTitle: "Review Episode",
      folderPath: "review-only",
      startedAt: now,
      status: "recording",
      practice: true
    }),
    writeRecordingState: async (_folderPath, state) => state,
    saveProgramRecording: async () => "review-only/program.webm",
    saveRecordedTracks: async () => [],
    appendRecordingError: async () => undefined,
    listUnfinishedRecordingSessions: async () => [],
    loadPodcastTools: async (episodeId) => ({
      ...createDefaultPodcastToolsState(episodeId),
      teleprompter: {
        ...createDefaultPodcastToolsState(episodeId).teleprompter,
        script: "Welcome back to What About It? Today we're keeping it real, useful, and a little spicy.",
        sponsorScript: "This episode is brought to you by a sponsor Morgan actually likes."
      },
      guestNotes: {
        questions: "What made this story worth telling?",
        talkingPoints: "Keep the intro tight. Leave room for the no-filter moment.",
        researchNotes: "Reference notes stay local.",
        links: "https://example.local",
        dontForget: "Mark the best clip."
      }
    }),
    savePodcastTools: async (_episodeId, state) => state,
    loadTimelineDraft: async (episodeId) =>
      createTimelineDraft({
        episodeId,
        recordingSessionId: "review-session",
        deviceDefaults: demoSettings.deviceDefaults,
        markers: [
          {
            id: "marker-funny",
            label: "Funny",
            timestampMs: 18000,
            createdAt: now,
            recordingSessionId: "review-session"
          },
          {
            id: "marker-highlight",
            label: "Highlight",
            timestampMs: 52000,
            createdAt: now,
            recordingSessionId: "review-session"
          }
        ],
        durationMs: 112000,
        now
      }),
    saveTimelineDraft: async (_episodeId, draft) => draft,
    loadReviewMedia: async (episodeId) => ({
      episodeId,
      episodeFolder: "review-only",
      loadedAt: now,
      hasPlayableProgram: false,
      message: "No program video found yet",
      program: {
        id: "program",
        label: "Program video",
        kind: "program",
        relativePath: "Program/program.webm",
        status: "missing",
        message: "No program video found yet"
      },
      cameras: [],
      audio: []
    }),
    runAutoEdit: async (episodeId, draft, mode, _practice, learningProfile) => runOfflineAutoEdit({ episodeId, draft, mode, learningProfile, now }),
    createExport: async (request) => ({
      id: "review-export",
      episodeId: request.episodeId,
      type: request.type,
      qualityPreset: request.qualityPreset,
      status: "complete",
      progress: 100,
      createdAt: now,
      updatedAt: now,
      outputFolder: "review-only/Exports",
      message: "Export complete",
      outputFileName: "what-about-it-full-episode-video.mp4"
    }),
    chooseExportDestinationFolder: async () => "review-only/Editor Handoff Destination",
    getMediaToolsStatus: async () => ({
      ready: true,
      message: "Media tools are ready"
    }),
    cancelExport: async (_episodeId, job) => ({
      ...job,
      status: "canceled",
      error: "canceled",
      message: "Export was canceled"
    }),
    openExportFolder: async () => "review-only/Exports",
    createDiagnosticsBundle: async () => ({
      folderPath: "review-only/diagnostics",
      files: ["app-info.json"]
    }),
    getLiveLogInfo: async () => ({ folderPath: "review-only/logs", filePath: "review-only/logs/today.log" }),
    openLiveLogs: async () => ({ folderPath: "review-only/logs", filePath: "review-only/logs/today.log" }),
    writeRuntimeLog: async () => undefined,
    getStorageStatus: async () => ({
      message: "Storage check ready",
      availableBytes: 100 * 1024 * 1024 * 1024
    })
  };
}

export default function App() {
  const reviewMode = typeof window !== "undefined" && !window.studio;
  const searchParams = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const popOutPanelId = searchParams.get("popout") as StudioPanelId | null;
  const popOutEpisodeId = searchParams.get("episodeId") ?? undefined;
  const studio = useMemo(() => getStudioBridge(), []);
  const [view, setView] = useState<View>(getInitialView);
  const [episodes, setEpisodes] = useState<EpisodeMetadata[]>([]);
  const [activeEpisode, setActiveEpisode] = useState<EpisodeMetadata | undefined>();
  const [settings, setSettings] = useState<StudioSettings>(fallbackSettings);
  const [workspaceState, setWorkspaceState] = useState<StudioWorkspaceState>(defaultStudioWorkspaceState);
  const [displays, setDisplays] = useState<StudioDisplayInfo[]>([]);
  const [workspaceMessage, setWorkspaceMessage] = useState("Window positions restore on launch.");
  const [deviceDetection, setDeviceDetection] = useState<DeviceDetectionResult>(emptyDetection);
  const [recordingSnapshot, setRecordingSnapshot] = useState<RecordingServiceSnapshot>(getInitialRecordingSnapshot);
  const [unfinishedSessions, setUnfinishedSessions] = useState<RecordingSession[]>([]);
  const [wizardStep, setWizardStep] = useState(() => Number(new URLSearchParams(window.location.search).get("wizard") ?? 0));
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [title, setTitle] = useState("");
  const [guestName, setGuestName] = useState("");
  const [description, setDescription] = useState("");
  const [showTour, setShowTour] = useState(false);
  const [podcastTools, setPodcastTools] = useState<PodcastToolsState>(() => createDefaultPodcastToolsState());
  const [timelineDraft, setTimelineDraft] = useState<TimelineDraft>(() => createTimelineDraft({ deviceDefaults: defaultDeviceDefaults }));
  const [selectedExportType, setSelectedExportType] = useState<ExportType>(defaultExportSettings.defaultExportType);
  const [selectedQualityPreset, setSelectedQualityPreset] = useState<ExportQualityPreset>(defaultExportSettings.qualityPreset);
  const [includeCameraMasters, setIncludeCameraMasters] = useState(false);
  const [includeAudioMasters, setIncludeAudioMasters] = useState(false);
  const [exportMasteringMode, setExportMasteringMode] = useState<ExportMasteringMode>("measured");
  const [exportDestinationFolder, setExportDestinationFolder] = useState<string | undefined>();
  const [exportJob, setExportJob] = useState<ExportJob | undefined>();
  const [mediaToolsStatus, setMediaToolsStatus] = useState<MediaToolsStatus | undefined>();
  const [reviewMedia, setReviewMedia] = useState<ReviewMediaInventory | undefined>();
  const [mediaImportProgress, setMediaImportProgress] = useState<ReviewMediaImportProgress | undefined>();
  const [localTranscriptionStatus, setLocalTranscriptionStatus] = useState<LocalTranscriptionStatus | undefined>();
  const [localTranscriptionProgress, setLocalTranscriptionProgress] = useState<LocalTranscriptionProgress | undefined>();
  const [autoEditMode, setAutoEditMode] = useState<AutoEditMode>("balanced");
  const [autoEditResult, setAutoEditResult] = useState<AutoEditResult | undefined>();
  const [autoEditRunning, setAutoEditRunning] = useState(false);
  const [autoEditError, setAutoEditError] = useState<string | undefined>();
  const [appUpdateStatus, setAppUpdateStatus] = useState<AppUpdateStatus>(() => createInitialAppUpdateStatus("0.2.0", false));
  const [timelineSaveState, setTimelineSaveState] = useState<TimelineSaveState>("saved");
  const timelineAutosaveTimerRef = useRef<number | undefined>(undefined);
  const pendingTimelineSaveRef = useRef<{ episodeId: string; draft: TimelineDraft } | undefined>(undefined);
  const episodeLoadSequenceRef = useRef(0);
  const activeEpisodeRef = useRef(activeEpisode);
  activeEpisodeRef.current = activeEpisode;
  const [hardwareTestStep, setHardwareTestStep] = useState<HardwareTestStep>("cameras");
  const [hardwareTestResults, setHardwareTestResults] = useState<HardwareTestResults>(() => createHardwareTestResults());
  const [hardwareTestMessage, setHardwareTestMessage] = useState("Real hardware only. Nothing passes until the studio can actually see it.");
  const [deviceChangeState, setDeviceChangeState] = useState<"ready" | "disconnected" | "reconnecting" | "needs-attention">("ready");
  const [deviceRefreshKey, setDeviceRefreshKey] = useState(0);
  const [diagnosticsBundle, setDiagnosticsBundle] = useState<DiagnosticsBundleResult | undefined>();
  const [liveLogInfo, setLiveLogInfo] = useState<LiveLogInfo | undefined>();
  const [storageStatus, setStorageStatus] = useState<StorageStatus | undefined>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [popOutPlayingSlotId, setPopOutPlayingSlotId] = useState<string | undefined>();
  const [popOutMarkerNotice, setPopOutMarkerNotice] = useState<string | undefined>();
  const [popOutNotesSavedAt, setPopOutNotesSavedAt] = useState("Saved");
  const popOutAudioRef = useRef<HTMLAudioElement | null>(null);
  const popOutMarkerTimerRef = useRef<number | undefined>(undefined);
  const popOutNotesTimerRef = useRef<number | undefined>(undefined);
  const hardwareStopTimerRef = useRef<number | undefined>(undefined);
  const deviceChangeTimerRef = useRef<number | undefined>(undefined);
  const deviceChangeSequenceRef = useRef(0);
  const activeTheme = useMemo(() => findTheme(settings.activeThemeId), [settings.activeThemeId]);
  const deviceService = useMemo(() => new DeviceService(browserDevicePlugin), []);
  const recordingService = useMemo(
    () =>
      new RecordingService(
        new BrowserMediaRecorderPlugin({
          getCameraStream: (deviceId) => deviceService.getActiveCameraStream(deviceId),
          getMicrophoneStream: (deviceId) => deviceService.getActiveMicrophoneStream(deviceId)
        })
      ),
    [deviceService]
  );
  const exportService = useMemo(() => new ExportService(studio), [studio]);
  const timelineSaveQueue = useMemo(
    () =>
      new TimelineSaveQueue(
        (episodeId, draft) => studio.saveTimelineDraft(episodeId, draft),
        (episodeId, savedDraft) => {
          if (activeEpisodeRef.current?.id !== episodeId) return;
          const pending = pendingTimelineSaveRef.current;
          if (pending?.episodeId === episodeId && pending.draft.version > savedDraft.version) return;
          setTimelineDraft((current) => (current.episodeId === episodeId ? savedDraft : current));
          setTimelineSaveState("saved");
        }
      ),
    [studio]
  );
  const openCameraPreview = useCallback((deviceId?: string) => deviceService.openCameraPreview(deviceId), [deviceService]);
  const openMicrophoneStream = useCallback((deviceId?: string) => deviceService.openMicrophoneStream(deviceId), [deviceService]);
  const releaseCameraPreview = useCallback(
    (deviceId?: string, stream?: MediaStream) => {
      deviceService.releaseStream("camera", deviceId, stream);
    },
    [deviceService]
  );
  const releaseMicrophoneStream = useCallback(
    (deviceId?: string, stream?: MediaStream) => {
      deviceService.releaseStream("microphone", deviceId, stream);
    },
    [deviceService]
  );

  useEffect(() => {
    applyTheme(activeTheme);
  }, [activeTheme]);

  useEffect(() => {
    void studio.getSettings().then((nextSettings) => {
      const hydratedSettings = withRecordingSettings(withExportSettings(withDeviceDefaults(nextSettings)));
      setSettings(hydratedSettings);
      setSelectedExportType(hydratedSettings.exportSettings?.defaultExportType ?? defaultExportSettings.defaultExportType);
      setSelectedQualityPreset(hydratedSettings.exportSettings?.qualityPreset ?? defaultExportSettings.qualityPreset);
      setSidebarCollapsed(hydratedSettings.ui?.sidebarCollapsed ?? true);
      const tourParam = new URLSearchParams(window.location.search).get("tour");
      setShowTour(tourParam === "on" || (tourParam !== "off" && hydratedSettings.onboarding?.guidedTour !== "never"));
    });
    void studio.getWorkspaceState().then((state) => {
      const hydratedWorkspace = withStudioWorkspaceDefaults(state);
      setWorkspaceState(hydratedWorkspace);
      if (hydratedWorkspace.settings.launchWithSavedLayout) {
        void studio.applyWorkspaceLayout(hydratedWorkspace.settings.activeLayoutId).then(setWorkspaceState);
      }
    });
    void studio.getDisplays().then(setDisplays);
    void studio.getLiveLogInfo?.().then(setLiveLogInfo);
    void refreshEpisodes();
    void refreshDevices();
    void refreshUnfinishedSessions();
  }, [studio]);

  useEffect(() => {
    void studio.getMediaToolsStatus().then(setMediaToolsStatus);
    void studio.getStorageStatus().then(setStorageStatus);
    void studio.getLocalTranscriptionStatus?.().then(setLocalTranscriptionStatus);
  }, [studio]);

  useEffect(() => {
    if (recordingSnapshot.status !== "recording" && recordingSnapshot.status !== "paused") return undefined;
    const timer = window.setInterval(() => {
      void studio.getStorageStatus().then(setStorageStatus);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [recordingSnapshot.status, studio]);

  useEffect(() => {
    void studio.getAppUpdateStatus?.().then(setAppUpdateStatus);
    return studio.onAppUpdateStatus?.(setAppUpdateStatus);
  }, [studio]);

  useEffect(() => exportService.subscribe(setExportJob), [exportService]);

  useEffect(() => studio.onReviewMediaImportProgress?.(setMediaImportProgress), [studio]);

  useEffect(() => studio.onLocalTranscriptionProgress?.((progress) => {
    if (activeEpisodeRef.current?.id === progress.episodeId) setLocalTranscriptionProgress(progress);
  }), [studio]);

  useEffect(() => {
    if (!popOutEpisodeId) return;
    void studio.loadPodcastTools(popOutEpisodeId).then((state) => setPodcastTools(withPodcastToolDefaults(state, popOutEpisodeId)));
  }, [popOutEpisodeId, studio]);

  useEffect(() => {
    if (reviewMode && new URLSearchParams(window.location.search).get("recording") === "complete") return undefined;
    const timer = window.setInterval(() => {
      setRecordingSnapshot(recordingService.getSnapshot());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [recordingService, reviewMode]);

  useEffect(() => {
    return () => {
      if (hardwareStopTimerRef.current) window.clearTimeout(hardwareStopTimerRef.current);
      if (deviceChangeTimerRef.current) window.clearTimeout(deviceChangeTimerRef.current);
      if (popOutMarkerTimerRef.current) window.clearTimeout(popOutMarkerTimerRef.current);
      if (popOutNotesTimerRef.current) window.clearTimeout(popOutNotesTimerRef.current);
      deviceService.releaseAll();
      void recordingService.shutdown();
    };
  }, [deviceService, popOutMarkerTimerRef, popOutNotesTimerRef, recordingService]);

  useEffect(() => {
    const cleanup = () => {
      deviceService.releaseAll();
      void recordingService.shutdown();
    };
    window.addEventListener("beforeunload", cleanup);
    return () => window.removeEventListener("beforeunload", cleanup);
  }, [deviceService, recordingService]);

  useEffect(() => {
    if (view !== "device-setup" && view !== "recording") {
      deviceService.releaseAll();
    }
  }, [deviceService, view]);

  useEffect(() => {
    if (reviewMode || view !== "device-setup") return;
    void requestStudioPermissions(true);
  }, [reviewMode, view]);

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return undefined;

    const handleDeviceChange = () => {
      setDeviceChangeState("reconnecting");
      const sequence = ++deviceChangeSequenceRef.current;
      if (deviceChangeTimerRef.current) window.clearTimeout(deviceChangeTimerRef.current);
      deviceChangeTimerRef.current = window.setTimeout(() => {
        void confirmDeviceChange(sequence);
      }, 1000);
    };

    const confirmDeviceChange = async (sequence: number) => {
      let detectedDevices = await refreshDevices();
      if (sequence !== deviceChangeSequenceRef.current) return;

      let devices = summarizeDevices(detectedDevices);
      let disconnected = didDeviceDisconnectDuringRecording({
        status: recordingService.getSnapshot().status,
        defaults: settings.deviceDefaults,
        devices
      });

      // USB cameras can briefly disappear while renegotiating their endpoint.
      // Confirm the loss before stopping a recording for what may be a transient event.
      if (disconnected) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        if (sequence !== deviceChangeSequenceRef.current) return;
        detectedDevices = await refreshDevices();
        if (sequence !== deviceChangeSequenceRef.current) return;
        devices = summarizeDevices(detectedDevices);
        disconnected = didDeviceDisconnectDuringRecording({
          status: recordingService.getSnapshot().status,
          defaults: settings.deviceDefaults,
          devices
        });
      }

      const readiness = getHardwareDeviceReadiness(settings.deviceDefaults, devices);
      setDeviceChangeState(disconnected ? "disconnected" : readiness.summary === "Everything Ready" ? "ready" : "needs-attention");
      setHardwareTestResults(
        createHardwareTestResults({
          cameraReady: readiness.cameraReady,
          morganMicReady: readiness.morganMicReady,
          exportStatus: exportJob?.status
        })
      );

      if (disconnected) {
        setHardwareTestMessage("A device disconnected, so we stopped safely. Check the cable, then try again.");
        if (view === "hardware-test") {
          void stopHardwareTestRecording("A device disconnected, so we stopped safely. Check the cable, then try again.");
        } else {
          void stopRecording();
        }
      }
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      deviceChangeSequenceRef.current += 1;
      if (deviceChangeTimerRef.current) window.clearTimeout(deviceChangeTimerRef.current);
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [exportJob?.status, recordingService, settings.deviceDefaults, view]);

  async function refreshEpisodes() {
    const nextEpisodes = await studio.listEpisodes();
    setEpisodes(nextEpisodes);
    setActiveEpisode((currentEpisode) => nextEpisodes.find((episode) => episode.id === currentEpisode?.id) ?? nextEpisodes[0]);
  }

  async function createEpisode() {
    await flushPendingTimelineSave();
    const episode = await studio.createEpisode({
      title,
      guestName,
      description
    });
    setTitle("");
    setGuestName("");
    setDescription("");
    setEpisodes([episode, ...episodes]);
    setActiveEpisode(episode);
    setView("home");
  }

  async function openEpisode(episode: EpisodeMetadata) {
    try {
      await flushPendingTimelineSave();
    } catch {
      return;
    }
    setActiveEpisode(episode);
    setView("timeline-review");
  }

  useEffect(() => {
    const sequence = ++episodeLoadSequenceRef.current;
    if (!activeEpisode) {
      setPodcastTools(createDefaultPodcastToolsState());
      setReviewMedia(undefined);
      return;
    }

    void loadReviewWorkspace(activeEpisode.id, sequence);
  }, [activeEpisode, studio]);

  async function loadReviewWorkspace(episodeId: string, sequence = ++episodeLoadSequenceRef.current) {
    try {
      const [tools, savedDraft, inventory] = await Promise.all([studio.loadPodcastTools(episodeId), studio.loadTimelineDraft(episodeId), studio.loadReviewMedia(episodeId)]);
      if (sequence !== episodeLoadSequenceRef.current || activeEpisodeRef.current?.id !== episodeId) return;
      const hydratedTools = withPodcastToolDefaults(tools, episodeId);
      const fallback = createTimelineDraft({
        episodeId,
        recordingSessionId: recordingSnapshot.session?.id,
        deviceDefaults: settings.deviceDefaults,
        markers: hydratedTools.markers,
        durationMs: recordingSnapshot.elapsedMs
      });
      setPodcastTools(hydratedTools);
      setReviewMedia(inventory);
      setTimelineDraft(syncTimelineTracksWithMedia(withTimelineDraftDefaults(savedDraft, fallback), inventory));
      setTimelineSaveState("saved");
    } catch (error) {
      if (sequence !== episodeLoadSequenceRef.current || activeEpisodeRef.current?.id !== episodeId) return;
      setTimelineSaveState("failed");
      setWorkspaceMessage(error instanceof Error ? error.message : "The episode draft could not be loaded.");
    }
  }

  async function loadReviewMediaForEpisode(episodeId: string) {
    const inventory = await studio.loadReviewMedia(episodeId);
    setReviewMedia(inventory);
    setTimelineDraft((current) => (current.episodeId === episodeId ? syncTimelineTracksWithMedia(current, inventory) : current));
  }

  async function importEpisodeMedia(slot: ReviewMediaImportSlot) {
    if (!activeEpisode || !studio.importReviewMedia) return "Open an episode in the installed app before importing media.";
    setMediaImportProgress({ episodeId: activeEpisode.id, slot, progress: 0, message: "Choose a media file" });
    try {
      const result = await studio.importReviewMedia(activeEpisode.id, slot);
      setReviewMedia(result.inventory);
      if (!result.canceled) {
        const durationMs = [result.inventory.program, ...result.inventory.cameras, ...result.inventory.audio].reduce((maximum, asset) => Math.max(maximum, asset.durationMs ?? 0), timelineDraft.durationMs);
        queueTimelineDraftChange(syncTimelineTracksWithMedia({ ...timelineDraft, durationMs }, result.inventory));
      }
      return result.message;
    } finally {
      setMediaImportProgress(undefined);
    }
  }

  async function cancelEpisodeMediaImport(slot: ReviewMediaImportSlot) {
    if (!activeEpisode || !studio.cancelReviewMediaImport) return;
    await studio.cancelReviewMediaImport(activeEpisode.id, slot);
  }

  async function transcribeActiveEpisodeLocally(): Promise<LocalTranscriptionResult> {
    if (!activeEpisode) throw new Error("Open an episode before starting local transcription.");
    if (!studio.transcribeEpisodeLocally) throw new Error("Local transcription is available in the installed Windows app.");
    setLocalTranscriptionProgress({ episodeId: activeEpisode.id, stage: "checking", progress: 0, message: "Starting free local transcription…" });
    try {
      return await studio.transcribeEpisodeLocally(activeEpisode.id);
    } finally {
      void studio.getLocalTranscriptionStatus?.().then(setLocalTranscriptionStatus);
    }
  }

  async function cancelActiveEpisodeTranscription() {
    if (!activeEpisode || !studio.cancelLocalTranscription) return;
    await studio.cancelLocalTranscription(activeEpisode.id);
  }

  async function relinkEpisodeMedia(slot: ReviewMediaImportSlot) {
    if (!activeEpisode || !studio.relinkReviewMedia) return "Relinking is available in the installed app.";
    const result = await studio.relinkReviewMedia(activeEpisode.id, slot);
    setReviewMedia(result.inventory);
    return result.message;
  }

  async function verifyEpisodeOriginals() {
    if (!activeEpisode || !studio.verifyReviewMediaOriginals) return "Original verification is available in the installed app.";
    const result = await studio.verifyReviewMediaOriginals(activeEpisode.id);
    const attention = result.items.filter((item) => item.status !== "verified").map((item) => item.slot.replace("camera-", "Camera ").replace("morgan-mic", "Main audio"));
    return attention.length > 0 ? `${result.message} Check ${attention.join(", ")}.` : result.message;
  }

  async function getActiveEpisodeStorage() {
    if (!activeEpisode || !studio.getEpisodeStorageSummary) throw new Error("Episode storage is available in the installed app.");
    return studio.getEpisodeStorageSummary(activeEpisode.id);
  }

  async function cleanupActiveEpisodeStorage(scope: "review-cache" | "exports") {
    if (!activeEpisode || !studio.cleanupEpisodeStorage) throw new Error("Episode cleanup is available in the installed app.");
    return studio.cleanupEpisodeStorage(activeEpisode.id, scope);
  }

  async function autoSyncEpisodeMedia() {
    if (!activeEpisode || !studio.autoSyncReviewMedia) return "Automatic sync is available in the installed app.";
    const result = await studio.autoSyncReviewMedia(activeEpisode.id);
    if (Object.keys(result.offsetsMs).length > 0) queueTimelineDraftChange(updateTimelineSyncOffsets(timelineDraft, result.offsetsMs));
    return result.message;
  }

  async function renderTreatmentPreview(trackId: string, timestampMs: number) {
    if (!activeEpisode || !studio.renderTrackTreatmentPreview) throw new Error("Effect preview is available in the installed app.");
    return studio.renderTrackTreatmentPreview(activeEpisode.id, timelineDraft, trackId, timestampMs);
  }

  function enqueueTimelineSave(episodeId: string, nextDraft: TimelineDraft) {
    if (activeEpisodeRef.current?.id === episodeId) setTimelineSaveState("saving");
    return timelineSaveQueue.enqueue(episodeId, nextDraft);
  }

  function queueTimelineDraftChange(nextDraft: TimelineDraft) {
    if (!activeEpisode) return;
    if (nextDraft.episodeId && nextDraft.episodeId !== activeEpisode.id) {
      setTimelineSaveState("failed");
      return;
    }
    const episodeId = activeEpisode.id;
    const episodeDraft = { ...nextDraft, episodeId, hasUnsavedChanges: true };
    setTimelineDraft(episodeDraft);
    setTimelineSaveState("saved");
    if (timelineAutosaveTimerRef.current) window.clearTimeout(timelineAutosaveTimerRef.current);
    pendingTimelineSaveRef.current = { episodeId, draft: episodeDraft };
    timelineAutosaveTimerRef.current = window.setTimeout(() => {
      timelineAutosaveTimerRef.current = undefined;
      void flushPendingTimelineSave().catch(() => undefined);
    }, 500);
  }

  async function flushPendingTimelineSave() {
    const pending = pendingTimelineSaveRef.current;
    if (!pending) return undefined;
    if (timelineAutosaveTimerRef.current) window.clearTimeout(timelineAutosaveTimerRef.current);
    timelineAutosaveTimerRef.current = undefined;
    try {
      const savedDraft = await enqueueTimelineSave(pending.episodeId, pending.draft);
      if (pendingTimelineSaveRef.current?.episodeId === pending.episodeId && pendingTimelineSaveRef.current.draft.version === pending.draft.version) {
        pendingTimelineSaveRef.current = undefined;
      }
      return savedDraft;
    } catch (error) {
      if (activeEpisodeRef.current?.id === pending.episodeId) {
        setTimelineSaveState("failed");
        setTimelineDraft((current) => (current.episodeId === pending.episodeId ? { ...current, hasUnsavedChanges: true } : current));
      }
      throw error;
    }
  }

  async function saveTimelineDraftState(nextDraft: TimelineDraft) {
    if (!activeEpisode) return nextDraft;
    if (nextDraft.episodeId && nextDraft.episodeId !== activeEpisode.id) {
      setTimelineSaveState("failed");
      throw new Error(`Refusing to save draft for ${nextDraft.episodeId} into episode ${activeEpisode.id}.`);
    }
    const episodeDraft = { ...nextDraft, episodeId: activeEpisode.id, hasUnsavedChanges: true };
    setTimelineDraft(episodeDraft);
    pendingTimelineSaveRef.current = { episodeId: activeEpisode.id, draft: episodeDraft };
    return (await flushPendingTimelineSave()) ?? episodeDraft;
  }

  async function saveApprovedTimelineDraft() {
    let savedDraft: TimelineDraft;
    try {
      savedDraft = await saveTimelineDraftState(timelineDraft);
    } catch {
      return false;
    }
    if (timelineDraft.editMode !== "manual") return savedDraft;
    const nextSettings: StudioSettings = {
      ...settings,
      autoEditLearning: learnAutoEditProfile(savedDraft, settings.autoEditLearning, autoEditMode)
    };
    setSettings(nextSettings);
    await studio.saveSettings(nextSettings);
    return savedDraft;
  }

  async function checkForAppUpdate() {
    if (studio.checkForAppUpdate) setAppUpdateStatus(await studio.checkForAppUpdate());
  }

  async function downloadAppUpdate() {
    if (studio.downloadAppUpdate) setAppUpdateStatus(await studio.downloadAppUpdate());
  }

  async function installAppUpdate() {
    await studio.installAppUpdate?.();
  }

  async function runAutoEditFlow(practice = false) {
    if (!activeEpisode) return;
    setAutoEditError(undefined);
    setAutoEditRunning(true);
    setView("auto-edit-review");
    try {
      const result = await studio.runAutoEdit(activeEpisode.id, timelineDraft, autoEditMode, practice, settings.autoEditLearning);
      setAutoEditResult(result);
      setTimelineDraft(result.draft);
    } catch (error) {
      setAutoEditError(error instanceof Error ? error.message : "Auto Edit could not finish. Your existing draft is still safe.");
    } finally {
      setAutoEditRunning(false);
    }
  }

  function toggleAutoEditSilenceCut(suggestionId: string) {
    if (!autoEditResult) return;
    const suggestion = autoEditResult.report.silenceSuggestions.find((item) => item.id === suggestionId);
    if (!suggestion) return;
    const accepted = !suggestion.accepted;
    const operation = {
      id: suggestion.id,
      type: "delete-section" as const,
      label: "Remove long pause",
      timestampMs: suggestion.startMs,
      endTimestampMs: suggestion.endMs,
      targetTrackId: "program",
      createdAt: autoEditResult.report.createdAt
    };
    const nextDraft = setTimelineEditOperationEnabled(autoEditResult.draft, operation, accepted);
    const silenceSuggestions = autoEditResult.report.silenceSuggestions.map((item) => (item.id === suggestionId ? { ...item, accepted } : item));
    const silenceRemovedMs = silenceSuggestions.filter((item) => item.accepted).reduce((total, item) => total + item.endMs - item.startMs, 0);
    const nextResult: AutoEditResult = {
      ...autoEditResult,
      draft: nextDraft,
      report: {
        ...autoEditResult.report,
        silenceSuggestions,
        silenceRemovedMs,
        runtimeReductionMs: silenceRemovedMs,
        editedLengthMs: Math.max(0, autoEditResult.report.originalLengthMs - silenceRemovedMs)
      }
    };
    setAutoEditResult(nextResult);
    queueTimelineDraftChange(nextDraft);
  }

  async function startExport(practice = false, typeOverride?: ExportType, draftOverride?: TimelineDraft) {
    let episodeId = recordingSnapshot.session?.episodeId ?? timelineDraft.episodeId ?? activeEpisode?.id;
    if (!episodeId) {
      const latestEpisodes = await studio.listEpisodes();
      const latestEpisode = latestEpisodes[0];
      if (latestEpisode) {
        setEpisodes(latestEpisodes);
        setActiveEpisode(latestEpisode);
        episodeId = latestEpisode.id;
      }
    }
    if (!episodeId) return;
    let destinationFolderPath = exportDestinationFolder;
    const exportType = typeOverride ?? selectedExportType;
    if (exportType === "editor-handoff" && !practice && !destinationFolderPath) {
      destinationFolderPath = await studio.chooseExportDestinationFolder?.();
      if (!destinationFolderPath) return;
      setExportDestinationFolder(destinationFolderPath);
    }
    setView("export");
    const job = await exportService.start({
      episodeId,
      type: exportType,
      qualityPreset: selectedQualityPreset,
      deviceDefaults: settings.deviceDefaults,
      draft:
        (draftOverride ?? timelineDraft).episodeId === episodeId
          ? (draftOverride ?? timelineDraft)
          : createTimelineDraft({
              episodeId,
              recordingSessionId: recordingSnapshot.session?.id,
              deviceDefaults: settings.deviceDefaults,
              markers: podcastTools.markers,
              durationMs: recordingSnapshot.elapsedMs
            }),
      practice,
      includeCameraMasters,
      includeAudioMasters,
      masteringMode: exportMasteringMode,
      destinationFolderPath
    });
    setExportJob(job);
  }

  async function cancelExport() {
    const episodeId = activeEpisode?.id ?? timelineDraft.episodeId;
    if (!episodeId || !exportJob) return;
    setExportJob(await exportService.cancel(episodeId, exportJob));
  }

  async function openExportFolder() {
    const episodeId = activeEpisode?.id ?? timelineDraft.episodeId;
    if (!episodeId) return;
    await exportService.openFolder(episodeId, exportJob?.outputFolder);
  }

  async function chooseExportDestinationFolder() {
    const folder = await studio.chooseExportDestinationFolder?.();
    if (folder) setExportDestinationFolder(folder);
  }

  async function changeExportType(type: ExportType) {
    setSelectedExportType(type);
    const nextSettings = {
      ...settings,
      exportSettings: { ...settings.exportSettings, defaultExportType: type }
    };
    setSettings(nextSettings);
    await studio.saveSettings(nextSettings);
  }

  async function changeQualityPreset(qualityPreset: ExportQualityPreset) {
    setSelectedQualityPreset(qualityPreset);
    const nextSettings = {
      ...settings,
      exportSettings: { ...settings.exportSettings, qualityPreset }
    };
    setSettings(nextSettings);
    await studio.saveSettings(nextSettings);
  }

  async function savePodcastToolsState(nextState: PodcastToolsState) {
    const episodeId = activeEpisode?.id ?? popOutEpisodeId;
    const stateWithEpisode = withPodcastToolDefaults(nextState, episodeId);
    setPodcastTools(stateWithEpisode);
    if (episodeId) {
      setPodcastTools(await studio.savePodcastTools(episodeId, stateWithEpisode));
    }
  }

  function patchPopOutNotes(nextState: PodcastToolsState) {
    setPopOutNotesSavedAt("Saving...");
    void savePodcastToolsState(nextState);
    if (popOutNotesTimerRef.current) window.clearTimeout(popOutNotesTimerRef.current);
    popOutNotesTimerRef.current = window.setTimeout(() => setPopOutNotesSavedAt("Saved"), 700);
  }

  async function togglePopOutSound(slot: SoundSlot) {
    popOutAudioRef.current?.pause();
    popOutAudioRef.current = null;

    if (popOutPlayingSlotId === slot.id) {
      setPopOutPlayingSlotId(undefined);
      return;
    }

    if (!slot.filePath) {
      setWorkspaceMessage("Add a sound first.");
      setPopOutPlayingSlotId(undefined);
      return;
    }

    try {
      const audio = new Audio(slot.filePath);
      audio.volume = Math.max(0, Math.min(1, podcastTools.soundboard.masterVolume / 100));
      audio.onended = () => setPopOutPlayingSlotId(undefined);
      popOutAudioRef.current = audio;
      setPopOutPlayingSlotId(slot.id);
      await audio.play();
    } catch {
      setWorkspaceMessage("That sound needs setup before it can play.");
      setPopOutPlayingSlotId(undefined);
    }
  }

  function markFromPopOut(label: string) {
    const marker = createLiveMarker({
      label,
      timestampMs: recordingSnapshot.elapsedMs,
      recordingSessionId: recordingSnapshot.session?.id
    });
    void savePodcastToolsState({
      ...podcastTools,
      markers: [marker, ...podcastTools.markers],
      practiceMode: { ...podcastTools.practiceMode, markerTried: true }
    });
    setPopOutMarkerNotice(`${label} marker added.`);
    if (popOutMarkerTimerRef.current) window.clearTimeout(popOutMarkerTimerRef.current);
    popOutMarkerTimerRef.current = window.setTimeout(() => setPopOutMarkerNotice(undefined), 2400);
  }

  async function openWorkspacePanel(panelId: StudioPanelId, displayId?: number, fullscreen = false) {
    const state = await studio.openWorkspacePanel(panelId, {
      episodeId: activeEpisode?.id ?? podcastTools.episodeId,
      displayId,
      fullscreen
    });
    setWorkspaceState((current) =>
      withStudioWorkspaceDefaults({
        ...current,
        windows: { ...current.windows, [panelId]: state }
      })
    );
    setWorkspaceMessage(`${studioPanelLabels[panelId]} is popped out${displayId ? " on another monitor" : ""}.`);
  }

  async function returnWorkspacePanel(panelId: StudioPanelId) {
    const state = await studio.closeWorkspacePanel(panelId);
    setWorkspaceState((current) =>
      withStudioWorkspaceDefaults({
        ...current,
        windows: { ...current.windows, [panelId]: state }
      })
    );
    setWorkspaceMessage(`${studioPanelLabels[panelId]} returned to Studio.`);
  }

  async function applyWorkspaceLayout(layoutId: StudioLayoutProfileId) {
    const nextState = await studio.applyWorkspaceLayout(layoutId, activeEpisode?.id ?? podcastTools.episodeId);
    setWorkspaceState(withStudioWorkspaceDefaults(nextState));
    setWorkspaceMessage("Studio layout restored.");
  }

  async function saveWorkspaceSettings(patch: Partial<NonNullable<StudioSettings["studioWorkspace"]>>) {
    const nextSettings = {
      ...settings,
      studioWorkspace: {
        ...defaultStudioWorkspaceState.settings,
        ...settings.studioWorkspace,
        ...patch
      }
    };
    setSettings(nextSettings);
    await studio.saveSettings(nextSettings);
  }

  async function resetWorkspaceLayout() {
    const nextState = await studio.resetWorkspaceLayout();
    setWorkspaceState(withStudioWorkspaceDefaults(nextState));
    setWorkspaceMessage("Studio layout reset.");
  }

  async function changeTheme(themeId: string) {
    const nextSettings = { ...settings, activeThemeId: themeId };
    setSettings(nextSettings);
    await studio.saveSettings(nextSettings);
  }

  async function toggleSidebarCollapsed() {
    const nextCollapsed = !sidebarCollapsed;
    setSidebarCollapsed(nextCollapsed);
    const nextSettings = {
      ...settings,
      ui: { ...settings.ui, sidebarCollapsed: nextCollapsed }
    };
    setSettings(nextSettings);
    await studio.saveSettings(nextSettings);
  }

  async function closeTour(preference: "skip" | "remind-later" | "never") {
    setShowTour(false);
    const nextSettings = {
      ...settings,
      onboarding: {
        guidedTour: preference === "remind-later" ? "remind-later" : "never"
      }
    } satisfies StudioSettings;
    setSettings(nextSettings);
    await studio.saveSettings(nextSettings);
  }

  async function refreshDevices() {
    if (reviewMode) {
      const demoDetection = {
        cameras: [
          {
            id: "demo-camera-1",
            label: "Main Studio Camera",
            kind: "camera",
            camera: {
              connectionType: "usb",
              signal: "good",
              autoReconnect: true,
              maxResolution: "Auto",
              maxFps: 30
            }
          },
          {
            id: "demo-camera-2",
            label: "Side Angle Camera",
            kind: "camera",
            camera: {
              connectionType: "wireless",
              signal: "good",
              batteryPercent: 86,
              autoReconnect: true,
              maxResolution: "Auto",
              maxFps: 30
            }
          }
        ],
        microphones: [{ id: "demo-mic-1", label: "Morgan Mic", kind: "microphone" }],
        speakers: [{ id: "demo-speakers", label: "Studio Headphones", kind: "speaker" }],
        permissionNeeded: false
      } satisfies DeviceDetectionResult;
      setDeviceDetection(demoDetection);
      return demoDetection;
    }
    const detectedDevices = await deviceService.detectDevices();
    const resolvedDevices = await withCameraAccessStatus(detectedDevices);
    setDeviceDetection(resolvedDevices);
    return resolvedDevices;
  }

  async function requestStudioPermissions(resetConnections = true) {
    if (resetConnections && recordingService.getSnapshot().status !== "recording" && recordingService.getSnapshot().status !== "paused") {
      deviceService.releaseAll();
      setDeviceRefreshKey((current) => current + 1);
    }
    const detectedDevices = await deviceService.requestStudioPermissions();
    setDeviceDetection(await withCameraAccessStatus(detectedDevices));
  }

  async function withCameraAccessStatus(detectedDevices: DeviceDetectionResult) {
    const cameraAccessStatus: MediaAccessStatus = await studio.getCameraAccessStatus?.().catch(() => "unknown") ?? "unknown";
    const systemMessage = cameraAccessMessage(cameraAccessStatus, detectedDevices.cameras.length);
    return {
      ...detectedDevices,
      cameraAccessStatus,
      permissionNeeded: detectedDevices.permissionNeeded || cameraAccessStatus === "denied" || cameraAccessStatus === "restricted",
      errorMessage: systemMessage ?? detectedDevices.errorMessage
    } satisfies DeviceDetectionResult;
  }

  async function saveDeviceDefaults(deviceDefaults: DeviceDefaults) {
    const nextSettings = withRecordingSettings(withExportSettings(withDeviceDefaults({ ...settings, deviceDefaults })));
    setSettings(nextSettings);
    await studio.saveSettings(nextSettings);
  }

  async function testMicrophone() {
    const level = await deviceService.sampleMicrophoneLevel(settings.deviceDefaults.microphones.morganMic);
    setMicrophoneLevel(level);
  }

  async function playTestSound() {
    await deviceService.playTestSound(settings.deviceDefaults.audioOutputId);
  }

  function summarizeDevices(detection = deviceDetection): HardwareDeviceSummary[] {
    return [...detection.cameras, ...detection.microphones, ...detection.speakers].map((device) => ({
      id: device.id,
      label: device.label,
      kind: device.kind
    }));
  }

  function updateHardwareResults(exportStatus = exportJob?.status) {
    const readiness = getHardwareDeviceReadiness(settings.deviceDefaults, summarizeDevices());

    const nextResults = createHardwareTestResults({
      cameraReady: readiness.cameraReady,
      morganMicReady: readiness.morganMicReady,
      exportStatus
    });
    setHardwareTestResults(nextResults);
    return nextResults;
  }

  async function runHardwareCameraCheck() {
    const detectedDevices = await refreshDevices();
    const readiness = getHardwareDeviceReadiness(settings.deviceDefaults, summarizeDevices(detectedDevices));
    setDeviceChangeState(readiness.summary === "Everything Ready" ? "ready" : "needs-attention");
    setHardwareTestResults(
      createHardwareTestResults({
        cameraReady: readiness.cameraReady,
        morganMicReady: undefined,
        exportStatus: exportJob?.status
      })
    );
    setHardwareTestMessage(readiness.message);
    setHardwareTestStep("microphones");
  }

  async function runHardwareMicrophoneCheck() {
    await testMicrophone();
    updateHardwareResults();
    setHardwareTestMessage("Morgan Mic check finished. Say something again if the room was quiet.");
    setHardwareTestStep("recording");
  }

  async function createHardwareTestEpisode() {
    await flushPendingTimelineSave();
    const episode = await studio.createEpisode({
      title: `Hardware Test ${new Date().toLocaleString()}`,
      description: "Real camera and microphone validation recording."
    });
    setEpisodes([episode, ...episodes]);
    setActiveEpisode(episode);
    return episode;
  }

  async function startHardwareTestRecording() {
    const episode = await createHardwareTestEpisode();
    setHardwareTestMessage("Recording a 30-second hardware test. Everything is saving locally.");
    const snapshot = await recordingService.start(settings.deviceDefaults, {
      episodeId: episode.id,
      episodeTitle: episode.title,
      practice: false,
      backupFolderPath: settings.recordingPreferences?.backupFolderPath
    });
    setRecordingSnapshot(snapshot);

    if (snapshot.status === "recording") {
      if (hardwareStopTimerRef.current) window.clearTimeout(hardwareStopTimerRef.current);
      hardwareStopTimerRef.current = window.setTimeout(() => {
        void stopHardwareTestRecording();
      }, 30000);
    } else {
      setHardwareTestMessage(getFriendlyHardwareFailureMessage("recording"));
    }
  }

  async function startQuickTestRecording() {
    const episode = await createHardwareTestEpisode();
    setHardwareTestMessage("Recording a 15-second camera and microphone check directly to disk.");
    const snapshot = await recordingService.start(settings.deviceDefaults, {
      episodeId: episode.id,
      episodeTitle: episode.title,
      practice: false,
      backupFolderPath: settings.recordingPreferences?.backupFolderPath
    });
    setRecordingSnapshot(snapshot);
    if (snapshot.status === "recording") {
      if (hardwareStopTimerRef.current) window.clearTimeout(hardwareStopTimerRef.current);
      hardwareStopTimerRef.current = window.setTimeout(() => {
        void stopHardwareTestRecording("Quick test saved and verified. Review it before the full episode.");
      }, 15000);
    }
  }

  async function stopHardwareTestRecording(message = "Test recording saved safely. Next, export the test.") {
    if (hardwareStopTimerRef.current) window.clearTimeout(hardwareStopTimerRef.current);
    const nextSnapshot = await recordingService.stop();
    setRecordingSnapshot(nextSnapshot);
    const episodeId = nextSnapshot.session?.episodeId ?? activeEpisode?.id;
    const draft = createTimelineDraft({
      episodeId,
      recordingSessionId: nextSnapshot.session?.id,
      deviceDefaults: settings.deviceDefaults,
      markers: podcastTools.markers,
      durationMs: nextSnapshot.elapsedMs
    });
    setTimelineDraft(draft);
    if (episodeId) {
      setTimelineDraft(await studio.saveTimelineDraft(episodeId, draft));
    }
    await refreshUnfinishedSessions();
    await refreshEpisodes();
    updateHardwareResults();
    setHardwareTestMessage(nextSnapshot.status === "stopped" ? message : getFriendlyHardwareFailureMessage("recording"));
    setHardwareTestStep("export");
  }

  async function createHardwareDiagnostics() {
    const bundle = await studio.createDiagnosticsBundle({
      devices: summarizeDevices(),
      results: hardwareTestResults,
      appVersion: "0.1.0",
      activeEpisodeId: recordingSnapshot.session?.episodeId ?? activeEpisode?.id,
      recordingSessionFolder: recordingSnapshot.session?.folderPath,
      message: hardwareTestMessage
    });
    setDiagnosticsBundle(bundle);
    setHardwareTestMessage("Diagnostics are saved locally and ready to share with support.");
  }

  async function exportHardwareTestRecording() {
    const episodeId = recordingSnapshot.session?.episodeId ?? activeEpisode?.id;
    if (!episodeId) {
      setHardwareTestMessage(getFriendlyHardwareFailureMessage("export"));
      return;
    }

    const job = await exportService.start({
      episodeId,
      type: "full-episode-video",
      qualityPreset: "standard",
      draft: timelineDraft,
      practice: false
    });
    setExportJob(job);
    updateHardwareResults(job.status);
    setHardwareTestMessage(job.status === "complete" ? "Export test complete. The finished copy is saved locally." : getFriendlyHardwareFailureMessage("export"));
    setHardwareTestStep("results");
  }

  async function refreshUnfinishedSessions() {
    setUnfinishedSessions(await studio.listUnfinishedRecordingSessions());
  }

  async function startRecording(practice = false) {
    const nextSnapshot = await recordingService.start(settings.deviceDefaults, {
      episodeId: activeEpisode?.id,
      episodeTitle: activeEpisode?.title,
      practice,
      backupFolderPath: settings.recordingPreferences?.backupFolderPath
    });
    setRecordingSnapshot(nextSnapshot);

    if (nextSnapshot.session?.episodeId && nextSnapshot.session.episodeId !== activeEpisode?.id) {
      await flushPendingTimelineSave();
      const latestEpisodes = await studio.listEpisodes();
      setEpisodes(latestEpisodes);
      setActiveEpisode(latestEpisodes.find((episode) => episode.id === nextSnapshot.session?.episodeId) ?? activeEpisode);
    }
    return nextSnapshot;
  }

  async function pauseRecording() {
    setRecordingSnapshot(await recordingService.pause());
  }

  async function resumeRecording() {
    setRecordingSnapshot(await recordingService.resume());
  }

  async function stopRecording() {
    const nextSnapshot = await recordingService.stop();
    setRecordingSnapshot(nextSnapshot);
    if (nextSnapshot.status === "error") {
      throw new Error(nextSnapshot.friendlyError ?? "Recording stopped, but file verification needs attention.");
    }
    const episodeId = nextSnapshot.session?.episodeId ?? activeEpisode?.id;
    const draft = createTimelineDraft({
      episodeId,
      recordingSessionId: nextSnapshot.session?.id,
      deviceDefaults: settings.deviceDefaults,
      markers: podcastTools.markers,
      durationMs: nextSnapshot.elapsedMs
    });
    setTimelineDraft(draft);
    if (episodeId) {
      setTimelineDraft(await studio.saveTimelineDraft(episodeId, draft));
      // Stop is complete once capture, disk finalization, and the timeline are
      // safe. Waveforms, proxies, and library refreshes are derived work and
      // must not leave the Stop button spinning after the files are protected.
      void (async () => {
        await loadReviewMediaForEpisode(episodeId);
        if (episodeId !== activeEpisodeRef.current?.id) {
          const latestEpisodes = await studio.listEpisodes();
          setEpisodes(latestEpisodes);
          setActiveEpisode(latestEpisodes.find((episode) => episode.id === episodeId) ?? activeEpisodeRef.current);
        }
        await refreshUnfinishedSessions();
      })().catch((error) => {
        setWorkspaceMessage(error instanceof Error ? error.message : "The recording is safe, but review media is still preparing.");
      });
      return;
    }
    await refreshUnfinishedSessions();
  }

  const selectedCameraReady = deviceDetection.cameras.some((camera) => camera.id === settings.deviceDefaults.cameras.camera1);
  const selectedMicrophoneReady = deviceDetection.microphones.some((microphone) => microphone.id === settings.deviceDefaults.microphones.morganMic);
  const studioReady = selectedCameraReady;
  const reviewReady = Boolean(reviewMedia?.hasPlayableProgram || recordingSnapshot.status === "stopped");
  const recordingPreferences = { ...defaultRecordingPreferences, ...settings.recordingPreferences, countdownSeconds: 0 as const };
  const recordingStorage = assessRecordingStorage({
    status: storageStatus,
    cameraCount: Object.values(settings.deviceDefaults.cameras).filter(Boolean).length,
    microphoneCount: Object.values(settings.deviceDefaults.microphones).filter(Boolean).length,
    estimatedMinutes: recordingPreferences.plannedDurationMinutes
  });

  if (popOutPanelId) {
    return (
      <StudioPopOutPanel
        panelId={popOutPanelId}
        podcastTools={podcastTools}
        displays={displays}
        poppedOutPanels={{ [popOutPanelId]: true }}
        playingSlotId={popOutPlayingSlotId}
        markerNotice={popOutMarkerNotice}
        notesSavedAt={popOutNotesSavedAt}
        elapsedMs={recordingSnapshot.elapsedMs}
        recordingStatus={recordingSnapshot.status}
        diagnosticsMessage={workspaceMessage}
        onPatchTools={(nextState) => void savePodcastToolsState(nextState)}
        onPatchNotes={patchPopOutNotes}
        onPlaySound={(slot) => void togglePopOutSound(slot)}
        onMark={markFromPopOut}
        onPopOut={(panelId, displayId, fullscreen) => void openWorkspacePanel(panelId, displayId, fullscreen)}
        onReturnToStudio={(panelId) => void returnWorkspacePanel(panelId)}
      />
    );
  }

  const effectiveSidebarCollapsed = sidebarCollapsed;

  return (
    <main className={`studio-shell ${effectiveSidebarCollapsed ? "sidebar-collapsed" : ""} ${view === "recording" ? "studio-shell--recording" : ""}`.trim()}>
      <aside className="sidebar" aria-label="What About It Studio navigation">
        <div className="brand-lockup">
          <div className="brand-badge">WAI</div>
          <div>
            <p className="eyebrow">Studio</p>
            <h1>
              <span>What</span>
              <span>About</span>
              <span>It?</span>
            </h1>
          </div>
        </div>
        <button className="sidebar-toggle" type="button" onClick={() => void toggleSidebarCollapsed()} aria-label={effectiveSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {effectiveSidebarCollapsed ? <ArrowRight size={18} /> : <ArrowLeft size={18} />}
          <span>{effectiveSidebarCollapsed ? "Expand" : "Collapse"}</span>
        </button>

        <nav className="nav-stack" aria-label="Studio workflow">
          <button data-label="Studio Setup" title={effectiveSidebarCollapsed ? "Studio Setup" : undefined} aria-current={view === "device-setup" ? "page" : undefined} className={view === "device-setup" ? "active" : ""} onClick={() => setView("device-setup")}>
            <Camera size={20} /> <span>Studio Setup</span>
          </button>
          <button data-label="Record" title={effectiveSidebarCollapsed ? "Record" : undefined} aria-current={view === "recording" ? "page" : undefined} className={view === "recording" ? "active" : ""} onClick={() => setView("recording")}>
            <Circle size={20} /> <span>Record</span>
          </button>
          <button
            data-label="Review"
            title={reviewReady ? (effectiveSidebarCollapsed ? "Review" : undefined) : "Record an episode first"}
            disabled={!reviewReady}
            aria-current={view === "timeline-review" ? "page" : undefined}
            className={view === "timeline-review" ? "active" : ""}
            onClick={() => setView("timeline-review")}
          >
            <ListVideo size={20} /> <span>Review</span>
          </button>
          <button data-label="Export" title={reviewReady ? (effectiveSidebarCollapsed ? "Export" : undefined) : "Record an episode first"} disabled={!reviewReady} aria-current={view === "export" ? "page" : undefined} className={view === "export" ? "active" : ""} onClick={() => setView("export")}>
            <Download size={20} /> <span>Export</span>
          </button>
        </nav>

        <nav className="nav-stack secondary" aria-label="More studio tools">
          <button data-label="Learn" title={effectiveSidebarCollapsed ? "Learn" : undefined} aria-current={view === "learn" ? "page" : undefined} className={view === "learn" ? "active" : ""} onClick={() => setView("learn")}>
            <BookOpen size={20} /> <span>Learn</span>
          </button>
          <button data-label="Settings" title={effectiveSidebarCollapsed ? "Settings" : undefined} aria-current={view === "settings" ? "page" : undefined} className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
            <Settings size={20} /> <span>Settings</span>
          </button>
          <button
            data-label="More"
            title={effectiveSidebarCollapsed ? "More" : undefined}
            aria-current={view === "practice" || view === "new-episode" || view === "auto-edit-review" || view === "hardware-test" || view === "theme-editor" ? "page" : undefined}
            className={view === "practice" || view === "new-episode" || view === "auto-edit-review" || view === "hardware-test" || view === "theme-editor" ? "active" : ""}
            onClick={() => setView("practice")}
          >
            <Sparkles size={20} /> <span>More</span>
          </button>
        </nav>

        <div className="phase-note sidebar-persona">
          <span className="sidebar-persona-avatar" aria-hidden="true">
            M
          </span>
          <strong>Morgan McGaughey</strong>
          <small>What About It? Studio</small>
        </div>
      </aside>

      <section className="workspace">
        <JourneyProgress
          view={view}
          studioReady={studioReady}
          recordingComplete={recordingSnapshot.status === "stopped"}
          reviewReady={reviewReady}
          exportComplete={exportJob?.status === "complete"}
          onNavigate={(nextView) => {
            setView(nextView);
          }}
        />
        {showTour && (
          <FirstRunSetup
            onClose={(preference) => void closeTour(preference)}
            onStartSetup={() => {
              void closeTour("never");
              setView("device-setup");
            }}
            onHardwareTest={() => {
              void closeTour("never");
              setView("hardware-test");
            }}
          />
        )}
        {view === "home" && <HomeView episodes={episodes} cameraReady={selectedCameraReady} microphoneReady={selectedMicrophoneReady} onNewEpisode={() => setView("new-episode")} onStudioSetup={() => setView("device-setup")} onOpenEpisode={(episode) => void openEpisode(episode)} />}
        {view === "new-episode" && <NewEpisodeView title={title} guestName={guestName} description={description} setTitle={setTitle} setGuestName={setGuestName} setDescription={setDescription} createEpisode={createEpisode} onBack={() => setView("home")} onNext={() => setView("device-setup")} />}
        {view === "device-setup" && (
          <div className="view-stack">
            <DeviceSetupWizard
              key={deviceRefreshKey}
              detection={deviceDetection}
              defaults={settings.deviceDefaults}
              microphoneLevel={microphoneLevel}
              currentStep={wizardStep}
              onStepChange={setWizardStep}
              onRefresh={() => void requestStudioPermissions()}
              onRequestPermission={() => void requestStudioPermissions()}
              onOpenCameraPrivacySettings={() => void studio.openCameraPrivacySettings?.()}
              onDefaultsChange={(defaults) => void saveDeviceDefaults(defaults)}
              onTestMicrophone={() => void testMicrophone()}
              onPlayTestSound={() => void playTestSound()}
              onOpenCameraPreview={openCameraPreview}
              onOpenMicrophoneStream={openMicrophoneStream}
              onReleaseCameraPreview={releaseCameraPreview}
              onReleaseMicrophoneStream={releaseMicrophoneStream}
              onGoRecord={() => setView("recording")}
            />
          </div>
        )}
        {view === "recording" && (
          <RecordingStudio
            defaults={settings.deviceDefaults}
            detection={deviceDetection}
            snapshot={recordingSnapshot}
            unfinishedSessions={unfinishedSessions}
            podcastTools={podcastTools}
            storageWarning={recordingStorage.ready ? undefined : recordingStorage.message}
            recordingPreferences={recordingPreferences}
            onStart={() => startRecording(false)}
            onQuickTest={() => startQuickTestRecording()}
            onPause={() => void pauseRecording()}
            onResume={() => void resumeRecording()}
            onStop={async () => {
              await stopRecording();
            }}
            onAutoEdit={() => void runAutoEditFlow(reviewMode)}
            onExport={() => {
              setView("export");
              void startExport(reviewMode);
            }}
            onDismissRecovery={() => setUnfinishedSessions([])}
            onRecoverSession={async (session) => {
              const recovered = await studio.recoverRecordingSession?.(session.folderPath);
              if (recovered) {
                setRecordingSnapshot((current) => ({
                  ...current,
                  status: recovered.integrity.programPlayable ? "stopped" : "interrupted",
                  session,
                  trackStatuses: recovered.tracks,
                  integrity: recovered.integrity,
                  friendlyError: recovered.integrity.programPlayable ? undefined : "Recovered files still need attention."
                }));
              }
              await refreshUnfinishedSessions();
              await refreshEpisodes();
            }}
            onOpenSessionFolder={(session) => void studio.openRecordingFolder?.(session.folderPath)}
            onNext={() => {
              setView("timeline-review");
            }}
            onDefaultsChange={(defaults) => void saveDeviceDefaults(defaults)}
            onPodcastToolsChange={(nextState) => void savePodcastToolsState(nextState)}
            onPlayTestSound={() => void playTestSound()}
            onOpenCameraPreview={openCameraPreview}
            onOpenMicrophoneStream={openMicrophoneStream}
            onReleaseCameraPreview={releaseCameraPreview}
            onReleaseMicrophoneStream={releaseMicrophoneStream}
            displays={displays}
            poppedOutPanels={Object.fromEntries(Object.entries(workspaceState.windows).map(([panelId, state]) => [panelId, Boolean(state?.isPoppedOut)])) as Partial<Record<StudioPanelId, boolean>>}
            onPopOutPanel={(panelId, displayId, fullscreen) => void openWorkspacePanel(panelId, displayId, fullscreen)}
            onReturnPanel={(panelId) => void returnWorkspacePanel(panelId)}
          />
        )}
        {view === "timeline-review" && (
          <TimelineReview
            draft={timelineDraft}
            media={reviewMedia}
            saveState={timelineSaveState}
            onDraftChange={queueTimelineDraftChange}
            onSaveDraft={() => void saveApprovedTimelineDraft()}
            onExport={async () => {
              if (!(await saveApprovedTimelineDraft())) return;
              setView("export");
            }}
            onCreateCombinedVideo={async () => {
              const savedDraft = await saveApprovedTimelineDraft();
              if (!savedDraft) return;
              setSelectedExportType("full-episode-video");
              setView("export");
              await startExport(reviewMode, "full-episode-video", savedDraft);
            }}
            onAutoEdit={() => void runAutoEditFlow(reviewMode)}
            onImportMedia={importEpisodeMedia}
            importProgress={mediaImportProgress}
            onCancelImport={cancelEpisodeMediaImport}
            onRelinkMedia={relinkEpisodeMedia}
            onVerifyOriginals={verifyEpisodeOriginals}
            onGetEpisodeStorage={getActiveEpisodeStorage}
            onCleanupEpisodeStorage={cleanupActiveEpisodeStorage}
            onAutoSync={autoSyncEpisodeMedia}
            onRenderTreatmentPreview={renderTreatmentPreview}
            transcriptionStatus={localTranscriptionStatus}
            transcriptionProgress={localTranscriptionProgress?.episodeId === activeEpisode?.id ? localTranscriptionProgress : undefined}
            onTranscribeLocally={transcribeActiveEpisodeLocally}
            onCancelTranscription={cancelActiveEpisodeTranscription}
          />
        )}
        {view === "auto-edit-review" && (
          <AutoEditReview
            mode={autoEditMode}
            result={autoEditResult}
            running={autoEditRunning}
            error={autoEditError}
            onModeChange={setAutoEditMode}
            onRun={() => void runAutoEditFlow(reviewMode)}
            onReview={() => setView("timeline-review")}
            onExport={() => setView("export")}
            onToggleSilenceCut={toggleAutoEditSilenceCut}
          />
        )}
        {view === "export" && (
          <ExportEpisode
            selectedType={selectedExportType}
            qualityPreset={selectedQualityPreset}
            job={exportJob}
            mediaToolsStatus={mediaToolsStatus}
            selectedRangeMs={timelineDraft.selection?.endTimestampMs === undefined ? undefined : timelineDraft.selection.endTimestampMs - timelineDraft.selection.timestampMs}
            includeCameraMasters={includeCameraMasters}
            includeAudioMasters={includeAudioMasters}
            masteringMode={exportMasteringMode}
            destinationFolderPath={exportDestinationFolder}
            onTypeChange={(type) => void changeExportType(type)}
            onQualityChange={(preset) => void changeQualityPreset(preset)}
            onCameraMastersChange={setIncludeCameraMasters}
            onAudioMastersChange={setIncludeAudioMasters}
            onMasteringModeChange={setExportMasteringMode}
            onChooseDestination={() => void chooseExportDestinationFolder()}
            onStartExport={() => void startExport(reviewMode)}
            onCancelExport={() => void cancelExport()}
            onOpenFolder={() => void openExportFolder()}
            onBackToReview={() => setView("timeline-review")}
            onFinish={() => setView("home")}
          />
        )}
        {view === "hardware-test" && (
          <HardwareTestModeView
            step={hardwareTestStep}
            results={hardwareTestResults}
            message={hardwareTestMessage}
            deviceChangeState={deviceChangeState}
            microphoneLevel={microphoneLevel}
            recordingSnapshot={recordingSnapshot}
            exportJob={exportJob}
            mediaToolsStatus={mediaToolsStatus}
            storageStatus={storageStatus}
            diagnosticsBundle={diagnosticsBundle}
            onStepChange={setHardwareTestStep}
            onCheckCameras={() => void runHardwareCameraCheck()}
            onCheckMicrophones={() => void runHardwareMicrophoneCheck()}
            onStartRecording={() => void startHardwareTestRecording()}
            onStopRecording={() => void stopHardwareTestRecording()}
            onExport={() => void exportHardwareTestRecording()}
            onCreateDiagnostics={() => void createHardwareDiagnostics()}
          />
        )}
        {view === "theme-editor" && <ThemeEditorView activeThemeId={settings.activeThemeId} changeTheme={changeTheme} />}
        {view === "learn" && <LearnStudioView />}
        {view === "practice" && <PracticeModeView />}
        {view === "settings" && (
          <SettingsView
            settings={settings}
            activeThemeName={activeTheme.name}
            displays={displays}
            workspaceState={workspaceState}
            workspaceMessage={workspaceMessage}
            appUpdateStatus={appUpdateStatus}
            liveLogInfo={liveLogInfo}
            onWorkspaceSettingsChange={(patch) => void saveWorkspaceSettings(patch)}
            onApplyLayout={(layoutId) => void applyWorkspaceLayout(layoutId)}
            onResetLayout={() => void resetWorkspaceLayout()}
            onCheckForUpdate={() => void checkForAppUpdate()}
            onDownloadUpdate={() => void downloadAppUpdate()}
            onInstallUpdate={() => void installAppUpdate()}
            onOpenLiveLogs={() => void studio.openLiveLogs?.().then(setLiveLogInfo)}
          />
        )}
      </section>
    </main>
  );
}

function JourneyProgress({
  view,
  studioReady,
  recordingComplete,
  reviewReady,
  exportComplete,
  onNavigate
}: {
  view: View;
  studioReady: boolean;
  recordingComplete: boolean;
  reviewReady: boolean;
  exportComplete: boolean;
  onNavigate: (view: Extract<View, "device-setup" | "recording" | "timeline-review" | "export">) => void;
}) {
  const steps: Array<{
    label: string;
    target: Extract<View, "device-setup" | "recording" | "timeline-review" | "export">;
    complete: boolean;
    active: boolean;
    locked?: boolean;
  }> = [
    {
      label: "Studio Setup",
      target: "device-setup",
      complete: studioReady,
      active: view === "new-episode" || view === "device-setup"
    },
    {
      label: "Record",
      target: "recording",
      complete: recordingComplete,
      active: view === "recording"
    },
    {
      label: "Review",
      target: "timeline-review",
      complete: reviewReady,
      active: view === "timeline-review" || view === "auto-edit-review",
      locked: !reviewReady
    },
    {
      label: "Export",
      target: "export",
      complete: exportComplete,
      active: view === "export",
      locked: !reviewReady
    }
  ];

  return (
    <nav className="journey-progress" aria-label="Episode progress">
      {steps.map((step) => (
        <button
          type="button"
          className={`${step.complete ? "complete" : ""} ${step.active ? "active" : ""} ${step.locked ? "locked" : ""}`}
          disabled={step.locked}
          aria-current={step.active ? "step" : undefined}
          title={step.locked ? "Record an episode first" : `Go to ${step.label}`}
          onClick={() => onNavigate(step.target)}
          key={step.label}
        >
          <i aria-hidden="true">{step.complete ? <CheckCircle2 size={18} /> : step.active ? <Circle size={14} /> : null}</i>
          {step.label}
        </button>
      ))}
    </nav>
  );
}

function FirstRunSetup({ onClose, onStartSetup, onHardwareTest }: { onClose: (preference: "skip" | "remind-later" | "never") => void; onStartSetup: () => void; onHardwareTest: () => void }) {
  const topics = ["Pick Camera 1.", "Pick Morgan Mic.", "Press Record when the previews look right."];

  return (
    <section className="tour-card" role="dialog" aria-label="First run setup">
      <button className="tour-close" type="button" aria-label="Skip first run setup" onClick={() => onClose("skip")}>
        <X size={18} />
      </button>
      <div>
        <p className="signature">Welcome to beta</p>
        <h2>Let's check the studio first.</h2>
        <p className="soft-copy">Start with Studio Setup. The app keeps the required choices short and leaves extra gear optional.</p>
      </div>
      <div className="tour-topic-grid">
        {topics.map((topic) => (
          <span key={topic}>
            <Compass size={18} /> {topic}
          </span>
        ))}
      </div>
      <div className="tour-actions">
        <Button variant="primary" icon={<Camera size={20} />} onClick={onStartSetup}>
          Start Studio Setup
        </Button>
        <Button variant="secondary" icon={<ShieldCheck size={20} />} onClick={onHardwareTest}>
          Run Full Hardware Test
        </Button>
        <Button variant="secondary" icon={<ArrowRight size={20} />} onClick={() => onClose("skip")}>
          Not Now
        </Button>
      </div>
    </section>
  );
}

function HomeView({ episodes, cameraReady, microphoneReady, onNewEpisode, onStudioSetup, onOpenEpisode }: { episodes: EpisodeMetadata[]; cameraReady: boolean; microphoneReady: boolean; onNewEpisode: () => void; onStudioSetup: () => void; onOpenEpisode: (episode: EpisodeMetadata) => void }) {
  return (
    <div className="view-stack">
      <section className="hero-panel">
        <div>
          <p className="signature">Morgan's offline podcast room</p>
          <h2>Ready when you are.</h2>
          <p className="hero-copy">Start with a new episode. Then I will walk you through setup, recording, and what comes next.</p>
          <Button variant="primary" icon={<Plus size={24} />} onClick={onNewEpisode}>
            New Episode
          </Button>
        </div>
        <CameraPreviewWall />
      </section>

      <section className="split-row">
        <div className="panel">
          <div className="panel-heading">
            <h3>Recent Episodes</h3>
            <FolderOpen size={22} />
          </div>
          {episodes.length === 0 ? (
            <div className="empty-state-card">
              <p className="signature">Looks like this is your first episode.</p>
              <h4>Let's create something awesome.</h4>
              <p>Start a local episode and this list will fill itself in.</p>
              <Button variant="primary" icon={<Plus size={20} />} onClick={onNewEpisode}>
                New Episode
              </Button>
            </div>
          ) : (
            <div className="episode-list">
              {episodes.map((episode) => (
                <button type="button" className="episode-card" onClick={() => onOpenEpisode(episode)} title={`Open ${episode.title}`} key={episode.id}>
                  <div>
                    <h4>{episode.title}</h4>
                    <p>
                      {episode.guestName || "Solo episode"} - {new Date(episode.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span>{episode.status}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="panel locked-panel">
          <div className="panel-heading">
            <h3>Studio Checklist</h3>
            <Wand2 size={22} />
          </div>
          <div className="locked-tools">
            <span className={cameraReady ? "ready" : "needs-attention"}>
              <Camera size={18} /> {cameraReady ? "Camera 1 is ready" : "Camera 1 needs a quick check"}
            </span>
            <span className={microphoneReady ? "ready" : "needs-attention"}>
              <Mic2 size={18} /> {microphoneReady ? "Morgan Mic is ready" : "Morgan Mic needs a quick check"}
            </span>
            <span>
              <Circle size={18} /> One-click recording is ready
            </span>
          </div>
          <p>Next best move: check the studio, record, review, Auto Edit, then export a local finished copy.</p>
          <Button variant="secondary" icon={<ArrowRight size={20} />} onClick={onStudioSetup}>
            {cameraReady && microphoneReady ? "Review Studio Setup" : "Check Studio Setup"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function NewEpisodeView(props: { title: string; guestName: string; description: string; setTitle: (value: string) => void; setGuestName: (value: string) => void; setDescription: (value: string) => void; createEpisode: () => Promise<void>; onBack: () => void; onNext: () => void }) {
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>();

  async function submitEpisode() {
    if (creating || !props.title.trim()) return;
    setCreating(true);
    setCreateError(undefined);
    try {
      await props.createEpisode();
      props.onNext();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "The episode could not be created. Try again.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="form-panel">
      <p className="signature">Let's get this one on the books</p>
      <h2>New Episode</h2>
      <label>
        Episode title
        <input value={props.title} onChange={(event) => props.setTitle(event.target.value)} placeholder="What are we calling this one?" />
      </label>
      <label>
        Guest name
        <input value={props.guestName} onChange={(event) => props.setGuestName(event.target.value)} placeholder="Optional" />
      </label>
      <label>
        Notes
        <textarea value={props.description} onChange={(event) => props.setDescription(event.target.value)} placeholder="Big idea, segment notes, or anything Morgan wants handy." />
      </label>
      <div className="form-actions">
        <Button variant="secondary" icon={<ArrowLeft size={20} />} onClick={props.onBack}>
          Back Home
        </Button>
        <Button variant="primary" icon={<Plus size={22} />} disabled={!props.title.trim() || creating} onClick={() => void submitEpisode()}>
          {creating ? "Creating Episode…" : "Create Episode and Check Studio"}
        </Button>
      </div>
      {createError ? <p className="form-error" role="alert">{createError}</p> : null}
    </section>
  );
}

const themeEditorActions = [
  {
    label: "Create custom theme",
    message: "Start from a built-in theme first. Custom theme controls will unlock after the token editor is ready."
  },
  {
    label: "Export theme",
    message: "Pick a built-in theme to preview. Export will be available when custom themes can be saved."
  },
  {
    label: "Import theme",
    message: "Imports are paused until custom theme files have validation."
  },
  {
    label: "Share theme",
    message: "Sharing comes after custom themes can be checked, saved, and exported safely."
  }
];

function ThemeEditorView({ activeThemeId, changeTheme }: { activeThemeId: string; changeTheme: (themeId: string) => Promise<void> }) {
  const [editorMessage, setEditorMessage] = useState("Choose a built-in theme and the whole studio updates immediately.");

  return (
    <section className="view-stack">
      <div className="panel">
        <p className="signature">Make the whole room yours</p>
        <h2>Theme Editor</h2>
        <p className="soft-copy">Pick a finished look now. Custom controls will arrive only when they can protect the studio's theme files.</p>
        <div className="theme-editor-status" aria-live="polite">
          <Brush size={20} />
          <span>{editorMessage}</span>
        </div>
        <div className="theme-grid">
          {builtInThemes.map((theme) => (
            <button
              className={`theme-tile ${activeThemeId === theme.id ? "selected" : ""}`}
              key={theme.id}
              onClick={() => {
                setEditorMessage(`${theme.name} is active. The studio look is saved locally.`);
                void changeTheme(theme.id);
              }}
              style={{
                background: `linear-gradient(135deg, ${theme.colors.cards}, ${theme.colors.surface})`,
                color: theme.colors.text,
                borderColor: theme.colors.accent
              }}
            >
              <span style={{ background: theme.colors.primary }} />
              <strong>{theme.name}</strong>
              <small>{theme.description}</small>
            </button>
          ))}
        </div>
        <div className="editor-actions" aria-label="Custom theme actions">
          {themeEditorActions.map((action) => (
            <button type="button" key={action.label} onClick={() => setEditorMessage(action.message)}>
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function HardwareTestModeView({
  step,
  results,
  message,
  deviceChangeState,
  microphoneLevel,
  recordingSnapshot,
  exportJob,
  mediaToolsStatus,
  storageStatus,
  diagnosticsBundle,
  onStepChange,
  onCheckCameras,
  onCheckMicrophones,
  onStartRecording,
  onStopRecording,
  onExport,
  onCreateDiagnostics
}: {
  step: HardwareTestStep;
  results: HardwareTestResults;
  message: string;
  deviceChangeState: "ready" | "disconnected" | "reconnecting" | "needs-attention";
  microphoneLevel: number;
  recordingSnapshot: RecordingServiceSnapshot;
  exportJob?: ExportJob;
  mediaToolsStatus?: MediaToolsStatus;
  storageStatus?: StorageStatus;
  diagnosticsBundle?: DiagnosticsBundleResult;
  onStepChange: (step: HardwareTestStep) => void;
  onCheckCameras: () => void;
  onCheckMicrophones: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onExport: () => void;
  onCreateDiagnostics: () => void;
}) {
  const recordingStatus = getRecordingTestStatus(recordingSnapshot.status);
  const exportStatus = getExportTestStatus(exportJob?.status);
  const isRecording = recordingSnapshot.status === "recording" || recordingSnapshot.status === "paused";
  const visibleCameraResults = [results.camera1, ...[results.camera2, results.camera3].filter((result) => result.status !== "not-run")];
  const evaluatedStatuses = [...visibleCameraResults.map((result) => result.status), results.morganMic.status, recordingStatus, exportStatus];
  const needsAttention = evaluatedStatuses.some((status) => status === "needs-attention" || status === "disconnected");
  const allRequiredReady = results.camera1.status === "ready"
    && results.morganMic.status === "ready"
    && recordingSnapshot.status === "stopped"
    && exportJob?.status === "complete";
  const summary = needsAttention ? "Needs Attention" : allRequiredReady ? "Everything Ready" : "Checks in progress";
  const storageCopy = storageStatus?.availableBytes ? `${Math.floor(storageStatus.availableBytes / 1024 / 1024 / 1024)} GB available` : (storageStatus?.message ?? "Storage check waiting");

  return (
    <section className="hardware-test-screen">
      <div className="hardware-test-hero">
        <div>
          <p className="signature">Real gear check</p>
          <h2>Let's test the studio for real</h2>
          <p className="soft-copy">This mode only passes when your actual camera, microphone, recording, and export path work on this computer.</p>
        </div>
        <ShieldCheck size={54} aria-hidden="true" />
      </div>

      <div className={`studio-dashboard-summary ${needsAttention ? "needs-attention" : "ready"}`}>
        <div>
          <p className="signature">Live studio dashboard</p>
          <h3>{summary}</h3>
          <p>{deviceChangeState === "reconnecting" ? "Reconnecting..." : deviceChangeState === "disconnected" ? "A device disconnected. We stopped safely." : message}</p>
        </div>
        <Button variant="secondary" icon={<FolderOpen size={22} />} onClick={onCreateDiagnostics}>
          Save Diagnostics
        </Button>
      </div>

      <div className="hardware-test-steps" aria-label="Real hardware test steps">
        {[
          ["cameras", "Step 1", "Check cameras"],
          ["microphones", "Step 2", "Check microphones"],
          ["recording", "Step 3", "Record a test"],
          ["export", "Step 4", "Export the test"],
          ["results", "Step 5", "Results"]
        ].map(([stepId, eyebrow, label]) => (
          <button className={step === stepId ? "active" : ""} key={stepId} onClick={() => onStepChange(stepId as HardwareTestStep)}>
            <span>{eyebrow}</span>
            {label}
          </button>
        ))}
      </div>

      <div className="studio-dashboard-grid" aria-label="Live studio readiness">
        {visibleCameraResults.map((result) => (
          <article className={`hardware-result-card ${result.status}`} key={result.label}>
            <Camera size={24} />
            <h3>{result.label}</h3>
            <p>{result.message}</p>
          </article>
        ))}
        <article className={`hardware-result-card ${results.morganMic.status}`}>
          <Mic2 size={24} />
          <h3>Morgan Mic</h3>
          <p>{results.morganMic.message}</p>
          <AudioMeter label="Input level" level={microphoneLevel} />
        </article>
        <article className={`hardware-result-card ${recordingStatus}`}>
          <Circle size={24} />
          <h3>Recording</h3>
          <p>{formatRecordingTime(recordingSnapshot.elapsedMs)}</p>
        </article>
        <article className={`hardware-result-card ${exportStatus}`}>
          <Download size={24} />
          <h3>Export</h3>
          <p>{exportJob?.message ?? mediaToolsStatus?.message ?? "Waiting for test export"}</p>
        </article>
        <article className="hardware-result-card ready">
          <HardDrive size={24} />
          <h3>Storage</h3>
          <p>{storageCopy}</p>
        </article>
      </div>

      <div className="hardware-test-panel">
        {step === "cameras" && (
          <>
            <h3>Step 1: Check cameras</h3>
            <p>We'll confirm Camera 1 and any extra camera you deliberately assigned. Unused camera slots stay out of the way.</p>
            <Button variant="primary" icon={<Camera size={22} />} onClick={onCheckCameras}>
              Check cameras
            </Button>
          </>
        )}

        {step === "microphones" && (
          <>
            <h3>Step 2: Check microphones</h3>
            <p>Say something out loud so Morgan Mic can prove it is ready.</p>
            <Button variant="primary" icon={<Mic2 size={22} />} onClick={onCheckMicrophones}>
              Check microphones
            </Button>
          </>
        )}

        {step === "recording" && (
          <>
            <h3>Step 3: Record a 30-second test</h3>
            <p>Use the actual camera and microphone. No practice mode, no simulated success.</p>
            <div className="hardware-action-row">
              <Button variant="primary" icon={<Circle size={22} />} disabled={isRecording} onClick={onStartRecording}>
                Record test
              </Button>
              <Button variant="secondary" icon={<X size={22} />} disabled={!isRecording} onClick={onStopRecording}>
                Stop test
              </Button>
            </div>
            <p className={`hardware-inline-status ${recordingStatus}`}>{recordingSnapshot.localSaveMessage}</p>
          </>
        )}

        {step === "export" && (
          <>
            <h3>Step 4: Export the test</h3>
            <p>Save a finished test copy locally and keep the original recording untouched.</p>
            <Button variant="primary" icon={<Download size={22} />} disabled={recordingSnapshot.status !== "stopped" || exportJob?.status === "running" || exportJob?.status === "queued"} onClick={onExport}>
              Export test
            </Button>
            <p className={`hardware-inline-status ${exportStatus}`}>{exportJob?.message ?? mediaToolsStatus?.message ?? "Export is waiting for the test recording."}</p>
          </>
        )}

        {step === "results" && (
          <>
            <h3>Step 5: Results</h3>
            <p>Only real checks count here. Anything that needs attention gets fixed before a full episode.</p>
            <Button variant="secondary" icon={<ArrowRight size={22} />} onClick={() => onStepChange("cameras")}>
              Run again
            </Button>
          </>
        )}

        <p className="hardware-test-message">{message}</p>
        {diagnosticsBundle && <p className="hardware-test-message">Diagnostics saved: {diagnosticsBundle.folderPath}</p>}
        {step !== "results" && (
          <Button variant="secondary" icon={<ArrowRight size={22} />} onClick={() => onStepChange(getNextHardwareTestStep(step))}>
            Next step
          </Button>
        )}
      </div>

    </section>
  );
}

function SettingsView({
  settings,
  activeThemeName,
  displays,
  workspaceState,
  workspaceMessage,
  appUpdateStatus,
  liveLogInfo,
  onWorkspaceSettingsChange,
  onApplyLayout,
  onResetLayout,
  onCheckForUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  onOpenLiveLogs
}: {
  settings: StudioSettings;
  activeThemeName: string;
  displays: StudioDisplayInfo[];
  workspaceState: StudioWorkspaceState;
  workspaceMessage: string;
  appUpdateStatus: AppUpdateStatus;
  liveLogInfo?: LiveLogInfo;
  onWorkspaceSettingsChange: (patch: Partial<NonNullable<StudioSettings["studioWorkspace"]>>) => void;
  onApplyLayout: (layoutId: StudioLayoutProfileId) => void;
  onResetLayout: () => void;
  onCheckForUpdate: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  onOpenLiveLogs: () => void;
}) {
  const workspaceSettings = {
    ...defaultStudioWorkspaceState.settings,
    ...settings.studioWorkspace
  };
  const secondaryDisplays = displays.filter((display) => !display.primary);
  return (
    <section className="panel settings-panel">
      <p className="signature">Local by default</p>
      <h2>Settings</h2>
      <dl>
        <div>
          <dt>Active theme</dt>
          <dd>{activeThemeName}</dd>
        </div>
        <div>
          <dt>Episode folder</dt>
          <dd>{settings.defaultEpisodeFolderName}</dd>
        </div>
        <div>
          <dt>Practice Mode</dt>
          <dd>{settings.practiceModeEnabled ? "On" : "Off"}</dd>
        </div>
        <div>
          <dt>Camera 1</dt>
          <dd>{settings.deviceDefaults.cameras.camera1 ? "Saved" : "Not picked yet"}</dd>
        </div>
        <div>
          <dt>Morgan Mic</dt>
          <dd>{settings.deviceDefaults.microphones.morganMic ? "Saved" : "Not picked yet"}</dd>
        </div>
        <div>
          <dt>Storage</dt>
          <dd>Local Documents folder</dd>
        </div>
        <div>
          <dt>Default export folder</dt>
          <dd>{settings.exportSettings.defaultExportFolder}</dd>
        </div>
        <div>
          <dt>Default export type</dt>
          <dd>{formatExportTypeSetting(settings.exportSettings.defaultExportType)}</dd>
        </div>
        <div>
          <dt>Export quality</dt>
          <dd>{formatExportQualitySetting(settings.exportSettings.qualityPreset)}</dd>
        </div>
        <div>
          <dt>Monitors</dt>
          <dd>{displays.length || 1} detected</dd>
        </div>
      </dl>
      <section className={`app-update-panel ${appUpdateStatus.state}`} aria-live="polite">
        <div className="app-update-copy">
          <p className="signature">App updates</p>
          <h3>Keep Morgan's studio current</h3>
          <p>{appUpdateStatus.message}</p>
          <small>
            Installed version {appUpdateStatus.currentVersion}
            {appUpdateStatus.availableVersion ? ` · Available ${appUpdateStatus.availableVersion}` : ""}
          </small>
        </div>
        {appUpdateStatus.state === "downloading" ? <progress aria-label="Update download progress" max="100" value={appUpdateStatus.downloadPercent ?? 0} /> : null}
        <div className="app-update-actions">
          {appUpdateStatus.state === "available" ? (
            <Button variant="primary" icon={<Download size={18} />} onClick={onDownloadUpdate}>
              Download update
            </Button>
          ) : appUpdateStatus.state === "ready" ? (
            <Button variant="primary" icon={<RefreshCw size={18} />} onClick={onInstallUpdate}>
              Restart and install
            </Button>
          ) : (
            <Button variant="secondary" icon={<RefreshCw size={18} />} disabled={appUpdateStatus.state === "checking" || appUpdateStatus.state === "downloading" || appUpdateStatus.state === "disabled"} onClick={onCheckForUpdate}>
              {appUpdateStatus.state === "checking" ? "Checking…" : "Check for updates"}
            </Button>
          )}
        </div>
      </section>
      <div className="workspace-settings-panel">
        <p className="signature">Studio Workspace</p>
        <h3>Multi-monitor workspace</h3>
        <p className="soft-copy">{workspaceMessage}</p>
        <div className="workspace-toggle-grid">
          <label>
            <input
              type="checkbox"
              checked={workspaceSettings.rememberWindowPositions}
              onChange={(event) =>
                onWorkspaceSettingsChange({
                  rememberWindowPositions: event.target.checked
                })
              }
            />
            Remember window positions
          </label>
          <label>
            <input
              type="checkbox"
              checked={workspaceSettings.launchWithSavedLayout}
              onChange={(event) =>
                onWorkspaceSettingsChange({
                  launchWithSavedLayout: event.target.checked
                })
              }
            />
            Launch with saved layout
          </label>
          <label>
            Default monitor
            <select
              value={workspaceSettings.defaultMonitorId ?? ""}
              onChange={(event) =>
                onWorkspaceSettingsChange({
                  defaultMonitorId: event.target.value ? Number(event.target.value) : undefined
                })
              }
            >
              <option value="">Primary monitor</option>
              {secondaryDisplays.map((display, index) => (
                <option value={display.id} key={display.id}>
                  Monitor {index + 2}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="monitor-list">
          {displays.map((display, index) => (
            <span key={display.id}>
              <strong>{display.primary ? "Primary display" : `Monitor ${index + 1}`}</strong>
              {display.bounds.width} x {display.bounds.height}, {display.scaleFactor}x scaling
            </span>
          ))}
        </div>
        <div className="layout-profile-grid">
          {workspaceState.layouts.map((layout) => (
            <button className={workspaceSettings.activeLayoutId === layout.id ? "active" : ""} type="button" key={layout.id} onClick={() => onApplyLayout(layout.id)}>
              {layout.name}
            </button>
          ))}
          <button type="button" onClick={onResetLayout}>
            Reset layout
          </button>
        </div>
      </div>
      <details className="advanced-diagnostics-settings">
        <summary>Advanced diagnostics</summary>
        <div>
          <p className="soft-copy">Live logs run automatically and record device discovery, input routing, recording state changes, disk writes, Stop, and final verification.</p>
          <dl>
            <div>
              <dt>Current log</dt>
              <dd>{liveLogInfo?.filePath ?? "Preparing live log path…"}</dd>
            </div>
          </dl>
          <Button variant="secondary" icon={<FolderOpen size={18} />} onClick={onOpenLiveLogs}>
            Open Live Logs
          </Button>
        </div>
      </details>
    </section>
  );
}

function formatExportTypeSetting(type: ExportType) {
  const labels: Record<ExportType, string> = {
    "full-episode-video": "Full Episode Video",
    "audio-only": "Audio Only",
    "archive-master": "Archive Master",
    "social-clip-placeholder": "Social Clip",
    "editor-handoff": "Editor Handoff"
  };
  return labels[type];
}

function formatExportQualitySetting(quality: ExportQualityPreset) {
  return quality === "standard" ? "Standard" : quality === "high" ? "High" : "Archive";
}

function LearnStudioView() {
  const lessons = [
    "How to connect a camera",
    "How to choose cameras",
    "How to test cameras",
    "How camera readiness works",
    "Understanding camera health",
    "Why a camera says Needs Attention",
    "How automatic reconnect works",
    "What the gear icon means",
    "What to do if a camera disconnects",
    "How wireless cameras work",
    "How to connect a microphone",
    "How to use headphones",
    "What to do if your camera does not show up",
    "What to do if your mic is too quiet",
    "How to record your first episode",
    "What happens when you press Record",
    "Why files are saved locally",
    "What to do if recording stops",
    "How recovery works",
    "How to use the teleprompter",
    "Using multiple monitors",
    "Moving the teleprompter",
    "Moving the soundboard",
    "Saving studio layouts",
    "How to add guest notes",
    "How to use sponsor notes",
    "How to use the soundboard",
    "How to mark funny and highlight moments",
    "How to switch camera layouts",
    "How to review your episode",
    "What markers mean",
    "How to trim",
    "How to split",
    "How to cut a section",
    "How undo and redo work",
    "Why original recordings stay safe",
    "What editing will do later",
    "How to export",
    "Which export should I choose?",
    "Where exported files go",
    "Why originals stay safe during export",
    "What Auto Edit does",
    "Which Auto Edit mode should I choose?",
    "How to review Auto Edit",
    "Why originals stay safe with Auto Edit",
    "Understanding chapters",
    "Understanding clip suggestions"
  ];

  return (
    <section className="panel learning-panel">
      <p className="signature">Little lessons, right in the studio</p>
      <h2>Learn Studio</h2>
      <p className="soft-copy">Offline help is ready for device setup. No internet, no tech lecture, just the next helpful step.</p>
      <div className="lesson-grid">
        {lessons.map((lesson) => (
          <article className="lesson-card" key={lesson}>
            <BookOpen size={22} />
            <h3>{lesson}</h3>
            <p>{getLessonCopy(lesson)}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function PracticeModeView() {
  return (
    <section className="panel practice-panel">
      <p className="signature">Try it without touching real gear</p>
      <h2>Practice Mode</h2>
      <p className="soft-copy">Walk through the recording room tools with branded practice screens. No fake people photos and no real media files.</p>
      <div className="practice-steps">
        <span>
          <Plus size={20} /> Practice starting a new episode
        </span>
        <span>
          <Camera size={20} /> Practice Studio Setup with safe sample screens
        </span>
        <span>
          <Circle size={20} /> Press Practice on the Record screen
        </span>
        <span>
          <Mic2 size={20} /> Practice pause and resume
        </span>
        <span>
          <BookOpen size={20} /> Try the teleprompter and sponsor script
        </span>
        <span>
          <Clapperboard size={20} /> Tap soundboard buttons without playing real files
        </span>
        <span>
          <Camera size={20} /> Switch camera layouts safely
        </span>
        <span>
          <Sparkles size={20} /> Mark funny, highlight, and fix-later moments
        </span>
        <span>
          <ListVideo size={20} /> Practice timeline review with fake markers
        </span>
        <span>
          <Sparkles size={20} /> Practice Auto Edit with sample timeline data
        </span>
        <span>
          <Scissors size={20} /> Practice safe trim, split, undo, redo, and restore original
        </span>
        <span>
          <Download size={20} /> Practice exporting a finished copy without real media
        </span>
        <span>
          <Headphones size={20} /> Learn that everything saves locally
        </span>
        <span>
          <Clapperboard size={20} /> Try the recovery message without risking real media
        </span>
      </div>
    </section>
  );
}

function getLessonCopy(lesson: string) {
  if (lesson.includes("multiple monitors")) return "Open Studio Workspace, check detected monitors, then pop out tools to the display that fits the show.";
  if (lesson.includes("Moving the teleprompter")) return "Use Pop Out, then choose Move Teleprompter to Monitor 2 or fullscreen for a clean reading screen.";
  if (lesson.includes("Moving the soundboard")) return "Pop out Soundboard and move it to a touchscreen or second monitor for large, easy buttons.";
  if (lesson.includes("Saving studio layouts")) return "Pick Podcast, Interview, Solo Creator, Dual Monitor, Triple Monitor, or Custom to restore windows with one click.";
  if (lesson.includes("teleprompter")) return "Paste a script, pick a comfortable size, then start or pause scrolling whenever you need.";
  if (lesson.includes("guest notes")) return "Keep questions, talking points, research, links, and don't-forget notes beside the recording controls.";
  if (lesson.includes("sponsor notes")) return "Store the read script, talking points, and required disclaimer, then mark the sponsor moment live.";
  if (lesson.includes("soundboard")) return "Use local intro, outro, and custom sounds only. Nothing comes from the cloud.";
  if (lesson.includes("funny and highlight")) return "Tap a marker during recording so the moment is saved with a timestamp.";
  if (lesson.includes("camera layouts")) return "Pick Host, Guest, Split, Triple, Picture-in-Picture, Sponsor Card, Intro, or Outro without seeing technical scene names.";
  if (lesson.includes("review your episode")) return "Open Review Episode after recording to see tracks, markers, and what comes next.";
  if (lesson.includes("markers mean")) return "Markers are timestamps that help you find funny, highlight, sponsor, and fix-later moments.";
  if (lesson.includes("trim")) return "Pick a spot, choose Trim before here, and the draft starts at the good part while the original stays safe.";
  if (lesson.includes("split")) return "Pick a spot, choose Split here, and the draft remembers that clean break for later.";
  if (lesson.includes("cut a section")) return "Pick the part that needs to go and choose Cut this section. You can undo it anytime.";
  if (lesson.includes("undo and redo")) return "Undo steps backward through draft edits. Redo brings a change back if you changed your mind.";
  if (lesson.includes("original recordings stay safe")) return "Review and future edits use a draft timeline. Your original recording stays untouched.";
  if (lesson.includes("editing will do later")) return "Advanced editing can grow later. Safe draft edits, Auto Edit, and local export are ready now.";
  if (lesson.includes("How to export")) return "Open Export, choose the finished copy you need, then save it locally.";
  if (lesson.includes("Which export")) return "Full Episode Video is ready for YouTube, Audio Only is for podcast platforms, and Archive Master is the keep-forever copy.";
  if (lesson.includes("Where exported")) return "Finished copies go into the episode's Exports folder, separate from the original recording.";
  if (lesson.includes("originals stay safe during export")) return "Export creates a new finished copy. It never overwrites the original recording.";
  if (lesson.includes("Auto Edit does")) return "Auto Edit builds a reviewable first draft, suggests chapters and clips, and keeps every change reversible.";
  if (lesson.includes("Auto Edit mode")) return "Gentle keeps things natural, Balanced is the default, Fast Paced tightens for YouTube, and Clip Hunter looks for highlights.";
  if (lesson.includes("review Auto Edit")) return "Read the summary, check changes, review flags, chapters, and clips, then export only when it feels right.";
  if (lesson.includes("safe with Auto Edit")) return "Auto Edit writes a new draft and report. Your original recording is never overwritten.";
  if (lesson.includes("chapters")) return "Chapters are suggested section markers like Intro, Main Discussion, Sponsor, and Closing.";
  if (lesson.includes("clip suggestions")) return "Clip suggestions include a start, end, title, reason, and confidence so you can decide what is worth sharing.";
  if (lesson.includes("choose cameras")) return "Open Studio Setup, pick Camera 1 first, then add Camera 2 and Camera 3 if you want more angles.";
  if (lesson.includes("test cameras")) return "Use Test Camera after choosing one. If it needs attention, the card will tell you the next simple step.";
  if (lesson.includes("camera readiness")) return "Ready means the studio can see the camera, keep it in its slot, and use it for recording.";
  if (lesson.includes("camera health")) return "The studio quietly watches connection, signal, and battery when a camera can share that info.";
  if (lesson.includes("Needs Attention")) return "Needs Attention means the camera wants one quick check before you record.";
  if (lesson.includes("automatic reconnect")) return "If a camera drops out, the studio tries to bring it back calmly and keeps saved files safe.";
  if (lesson.includes("gear icon")) return "The gear keeps extra camera choices tucked away so the main setup stays calm.";
  if (lesson.includes("camera disconnects")) return "The studio will say it lost the camera and try to reconnect without deleting anything.";
  if (lesson.includes("wireless cameras")) return "Use Find Cameras, then Connect. Signal can be Good, Weak, or Lost when the camera shares that info.";
  if (lesson.includes("camera does not")) return "Try a different port, close other video apps, then run Studio Setup again.";
  if (lesson.includes("first episode")) return "Pick devices first, press Record, pause if you need a breath, then Stop when you are done.";
  if (lesson.includes("press Record")) return "The app creates a local session folder and starts saving the program recording.";
  if (lesson.includes("saved locally")) return "Recordings stay on this computer inside the episode folder.";
  if (lesson.includes("recording stops")) return "Open the app again and look for the unfinished recording recovery message.";
  if (lesson.includes("recovery")) return "Recovery points you back to the local session folder and never deletes raw recordings.";
  if (lesson.includes("mic is too quiet")) return "Move the mic closer, check the gain knob, and use Say something! to watch the meter.";
  if (lesson.includes("camera")) return "Plug the camera in first, then choose it for Camera 1, Camera 2, or Camera 3.";
  if (lesson.includes("microphone")) return "Pick Morgan Mic first so the app knows which voice matters most.";
  return "Use headphones during recording so the microphones do not hear the show audio.";
}

function CameraPreviewWall() {
  return (
    <div className="preview-wall" aria-label="Branded empty camera preview placeholders">
      {["Camera 1", "Camera 2", "Camera 3"].map((label) => (
        <CameraPreview label={label} key={label} />
      ))}
    </div>
  );
}
