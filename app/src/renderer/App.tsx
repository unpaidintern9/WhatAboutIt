import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Brush,
  Camera,
  CheckCircle2,
  Clapperboard,
  Circle,
  Compass,
  Download,
  FolderOpen,
  Headphones,
  HardDrive,
  Mic2,
  MonitorPlay,
  Plus,
  Scissors,
  Settings,
  ShieldCheck,
  Sparkles,
  ListVideo,
  Wand2,
  X
} from "lucide-react";
import type { DeviceDefaults, EpisodeMetadata, StudioSettings } from "../shared/types";
import type { RecordingSession } from "../shared/recording";
import type { PodcastToolsState } from "../shared/podcast-tools";
import { createDefaultPodcastToolsState, withPodcastToolDefaults } from "../shared/podcast-tools";
import type { TimelineDraft } from "../shared/timeline";
import { createTimelineDraft, markTimelineSaved, withTimelineDraftDefaults } from "../shared/timeline";
import type { ExportJob, ExportQualityPreset, ExportType, MediaToolsStatus } from "../shared/export";
import { defaultExportSettings } from "../shared/export";
import type { AutoEditMode, AutoEditResult } from "../shared/auto-edit";
import { runOfflineAutoEdit } from "../shared/auto-edit";
import { defaultDeviceDefaults, withDeviceDefaults } from "../shared/device-config";
import type { HardwareTestResults, HardwareTestStep } from "../shared/hardware-test";
import {
  createHardwareTestResults,
  didDeviceDisconnectDuringRecording,
  getHardwareDeviceReadiness,
  getExportTestStatus,
  getFriendlyHardwareFailureMessage,
  getNextHardwareTestStep,
  getRecordingTestStatus,
  type DiagnosticsBundleResult,
  type HardwareDeviceSummary
} from "../shared/hardware-test";
import type { StorageStatus } from "../shared/diagnostics";
import { AutoEditReview, Button, CameraPreview, DeviceSetupWizard, ExportEpisode, RecordingStudio, TimelineReview } from "./components";
import { AudioMeter } from "./components";
import { browserDevicePlugin } from "./plugins/devices/browser-device-plugin";
import { BrowserMediaRecorderPlugin } from "./plugins/recording/browser-media-recorder-plugin";
import type { DeviceDetectionResult } from "./plugins/devices/types";
import { DeviceService, ExportService, RecordingService, formatRecordingTime, type RecordingServiceSnapshot } from "./services";
import { applyTheme, builtInThemes, findTheme } from "./theme/themes";
import "./styles.css";

type View = "home" | "new-episode" | "device-setup" | "recording" | "timeline-review" | "auto-edit-review" | "export" | "hardware-test" | "settings" | "learn" | "practice" | "theme-editor";

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
  onboarding: { guidedTour: "show" }
};

function withExportSettings(settings: StudioSettings): StudioSettings {
  return {
    ...settings,
    exportSettings: { ...defaultExportSettings, ...settings.exportSettings }
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
  localSaveMessage: "Everything is saving locally"
};

function getInitialRecordingSnapshot(): RecordingServiceSnapshot {
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("recording") === "complete") {
    return {
      status: "stopped",
      elapsedMs: 112000,
      localSaveMessage: "Everything is saving locally"
    };
  }
  return idleRecordingSnapshot;
}

function getStudioBridge(): Window["studio"] {
  if (window.studio) return window.studio;

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
          { id: "marker-funny", label: "Funny", timestampMs: 18000, createdAt: now, recordingSessionId: "review-session" },
          { id: "marker-highlight", label: "Highlight", timestampMs: 52000, createdAt: now, recordingSessionId: "review-session" }
        ],
        durationMs: 112000,
        now
      }),
    saveTimelineDraft: async (_episodeId, draft) => draft,
    runAutoEdit: async (episodeId, draft, mode) => runOfflineAutoEdit({ episodeId, draft, mode, now }),
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
    getMediaToolsStatus: async () => ({ ready: true, message: "Media tools are ready" }),
    cancelExport: async (_episodeId, job) => ({ ...job, status: "canceled", error: "canceled", message: "Export was canceled" }),
    openExportFolder: async () => "review-only/Exports",
    createDiagnosticsBundle: async () => ({ folderPath: "review-only/diagnostics", files: ["app-info.json"] }),
    getStorageStatus: async () => ({ message: "Storage check ready", availableBytes: 1024 * 1024 * 1024 })
  };
}

export default function App() {
  const reviewMode = typeof window !== "undefined" && !window.studio;
  const studio = useMemo(() => getStudioBridge(), []);
  const [view, setView] = useState<View>(getInitialView);
  const [episodes, setEpisodes] = useState<EpisodeMetadata[]>([]);
  const [activeEpisode, setActiveEpisode] = useState<EpisodeMetadata | undefined>();
  const [settings, setSettings] = useState<StudioSettings>(fallbackSettings);
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
  const [timelineDraft, setTimelineDraft] = useState<TimelineDraft>(() =>
    createTimelineDraft({ deviceDefaults: defaultDeviceDefaults })
  );
  const [selectedExportType, setSelectedExportType] = useState<ExportType>(defaultExportSettings.defaultExportType);
  const [selectedQualityPreset, setSelectedQualityPreset] = useState<ExportQualityPreset>(defaultExportSettings.qualityPreset);
  const [exportJob, setExportJob] = useState<ExportJob | undefined>();
  const [mediaToolsStatus, setMediaToolsStatus] = useState<MediaToolsStatus | undefined>();
  const [autoEditMode, setAutoEditMode] = useState<AutoEditMode>("balanced");
  const [autoEditResult, setAutoEditResult] = useState<AutoEditResult | undefined>();
  const [autoEditRunning, setAutoEditRunning] = useState(false);
  const [hardwareTestStep, setHardwareTestStep] = useState<HardwareTestStep>("cameras");
  const [hardwareTestResults, setHardwareTestResults] = useState<HardwareTestResults>(() => createHardwareTestResults());
  const [hardwareTestMessage, setHardwareTestMessage] = useState("Real hardware only. Nothing passes until the studio can actually see it.");
  const [deviceChangeState, setDeviceChangeState] = useState<"ready" | "disconnected" | "reconnecting" | "needs-attention">("ready");
  const [diagnosticsBundle, setDiagnosticsBundle] = useState<DiagnosticsBundleResult | undefined>();
  const [storageStatus, setStorageStatus] = useState<StorageStatus | undefined>();
  const hardwareStopTimerRef = useRef<number | undefined>(undefined);
  const activeTheme = useMemo(() => findTheme(settings.activeThemeId), [settings.activeThemeId]);
  const deviceService = useMemo(() => new DeviceService(browserDevicePlugin), []);
  const recordingService = useMemo(() => new RecordingService(new BrowserMediaRecorderPlugin()), []);
  const exportService = useMemo(() => new ExportService(studio), [studio]);

  useEffect(() => {
    applyTheme(activeTheme);
  }, [activeTheme]);

  useEffect(() => {
    void studio.getSettings().then((nextSettings) => {
      const hydratedSettings = withExportSettings(withDeviceDefaults(nextSettings));
      setSettings(hydratedSettings);
      setSelectedExportType(hydratedSettings.exportSettings?.defaultExportType ?? defaultExportSettings.defaultExportType);
      setSelectedQualityPreset(hydratedSettings.exportSettings?.qualityPreset ?? defaultExportSettings.qualityPreset);
      const tourParam = new URLSearchParams(window.location.search).get("tour");
      setShowTour(tourParam === "on" || (tourParam !== "off" && hydratedSettings.onboarding?.guidedTour !== "never"));
    });
    void refreshEpisodes();
    void refreshDevices();
    void refreshUnfinishedSessions();
  }, [studio]);

  useEffect(() => {
    void studio.getMediaToolsStatus().then(setMediaToolsStatus);
    void studio.getStorageStatus().then(setStorageStatus);
  }, [studio]);

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
    };
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return undefined;

    const handleDeviceChange = () => {
      setDeviceChangeState("reconnecting");
      void refreshDevices().then((detectedDevices) => {
        const devices = summarizeDevices(detectedDevices);
        const disconnected = didDeviceDisconnectDuringRecording({
          status: recordingService.getSnapshot().status,
          defaults: settings.deviceDefaults,
          devices
        });
        const readiness = getHardwareDeviceReadiness(settings.deviceDefaults, devices);
        setDeviceChangeState(disconnected ? "disconnected" : readiness.summary === "Everything Ready" ? "ready" : "needs-attention");
        setHardwareTestResults(createHardwareTestResults({
          cameraReady: readiness.cameraReady,
          morganMicReady: readiness.morganMicReady,
          exportStatus: exportJob?.status
        }));

        if (disconnected) {
          setHardwareTestMessage("A device disconnected, so we stopped safely. Check the cable, then try again.");
          void stopHardwareTestRecording("A device disconnected, so we stopped safely. Check the cable, then try again.");
        }
      });
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, [exportJob?.status, recordingService, settings.deviceDefaults]);

  async function refreshEpisodes() {
    const nextEpisodes = await studio.listEpisodes();
    setEpisodes(nextEpisodes);
    setActiveEpisode((currentEpisode) => currentEpisode ?? nextEpisodes[0]);
  }

  async function createEpisode() {
    const episode = await studio.createEpisode({ title, guestName, description });
    setTitle("");
    setGuestName("");
    setDescription("");
    setEpisodes([episode, ...episodes]);
    setActiveEpisode(episode);
    setView("home");
  }

  useEffect(() => {
    if (!activeEpisode) {
      setPodcastTools(createDefaultPodcastToolsState());
      return;
    }

    void studio.loadPodcastTools(activeEpisode.id).then((state) => setPodcastTools(withPodcastToolDefaults(state, activeEpisode.id)));
    void loadTimelineForEpisode(activeEpisode.id);
  }, [activeEpisode, studio]);

  async function loadTimelineForEpisode(episodeId: string) {
    const fallback = createTimelineDraft({
      episodeId,
      recordingSessionId: recordingSnapshot.session?.id,
      deviceDefaults: settings.deviceDefaults,
      markers: podcastTools.markers,
      durationMs: recordingSnapshot.elapsedMs
    });
    const savedDraft = await studio.loadTimelineDraft(episodeId);
    setTimelineDraft(withTimelineDraftDefaults(savedDraft, fallback));
  }

  async function saveTimelineDraftState(nextDraft: TimelineDraft) {
    setTimelineDraft(nextDraft);
    if (activeEpisode) {
      setTimelineDraft(await studio.saveTimelineDraft(activeEpisode.id, nextDraft));
    }
  }

  async function runAutoEditFlow(practice = false) {
    if (!activeEpisode) return;
    setAutoEditRunning(true);
    const result = await studio.runAutoEdit(activeEpisode.id, timelineDraft, autoEditMode, practice);
    setAutoEditResult(result);
    setTimelineDraft(result.draft);
    setAutoEditRunning(false);
    setView("auto-edit-review");
  }

  async function startExport(practice = false) {
    if (!activeEpisode) return;
    const job = await exportService.start({
      episodeId: activeEpisode.id,
      type: selectedExportType,
      qualityPreset: selectedQualityPreset,
      draft: timelineDraft,
      practice
    });
    setExportJob(job);
  }

  async function cancelExport() {
    if (!activeEpisode || !exportJob) return;
    setExportJob(await exportService.cancel(activeEpisode.id, exportJob));
  }

  async function openExportFolder() {
    if (!activeEpisode) return;
    await exportService.openFolder(activeEpisode.id);
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
    const stateWithEpisode = withPodcastToolDefaults(nextState, activeEpisode?.id);
    setPodcastTools(stateWithEpisode);
    if (activeEpisode) {
      setPodcastTools(await studio.savePodcastTools(activeEpisode.id, stateWithEpisode));
    }
  }

  async function changeTheme(themeId: string) {
    const nextSettings = { ...settings, activeThemeId: themeId };
    setSettings(nextSettings);
    await studio.saveSettings(nextSettings);
  }

  async function closeTour(preference: "skip" | "remind-later" | "never") {
    setShowTour(false);
    if (preference === "skip") return;
    const nextSettings = {
      ...settings,
      onboarding: { guidedTour: preference === "never" ? "never" : "remind-later" }
    } satisfies StudioSettings;
    setSettings(nextSettings);
    await studio.saveSettings(nextSettings);
  }

  async function refreshDevices() {
    if (reviewMode) {
      const demoDetection = {
        cameras: [
          { id: "demo-camera-1", label: "Main Studio Camera", kind: "camera", camera: { connectionType: "usb", signal: "good", autoReconnect: true, maxResolution: "Auto", maxFps: 30 } },
          { id: "demo-camera-2", label: "Side Angle Camera", kind: "camera", camera: { connectionType: "wireless", signal: "good", batteryPercent: 86, autoReconnect: true, maxResolution: "Auto", maxFps: 30 } }
        ],
        microphones: [{ id: "demo-mic-1", label: "Morgan Mic", kind: "microphone" }],
        speakers: [{ id: "demo-speakers", label: "Studio Headphones", kind: "speaker" }],
        permissionNeeded: false
      } satisfies DeviceDetectionResult;
      setDeviceDetection(demoDetection);
      return demoDetection;
    }
    const detectedDevices = await deviceService.detectDevices();
    setDeviceDetection(detectedDevices);
    return detectedDevices;
  }

  async function requestStudioPermissions() {
    setDeviceDetection(await deviceService.requestStudioPermissions());
  }

  async function saveDeviceDefaults(deviceDefaults: DeviceDefaults) {
    const nextSettings = withExportSettings(withDeviceDefaults({ ...settings, deviceDefaults }));
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
      practice: false
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
    setHardwareTestMessage(
      nextSnapshot.status === "stopped"
        ? message
        : getFriendlyHardwareFailureMessage("recording")
    );
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
    setHardwareTestMessage(
      job.status === "complete" ? "Export test complete. The finished copy is saved locally." : getFriendlyHardwareFailureMessage("export")
    );
    setHardwareTestStep("results");
  }

  async function refreshUnfinishedSessions() {
    setUnfinishedSessions(await studio.listUnfinishedRecordingSessions());
  }

  async function startRecording(practice = false) {
    setRecordingSnapshot(
      await recordingService.start(settings.deviceDefaults, {
        episodeId: activeEpisode?.id,
        episodeTitle: activeEpisode?.title,
        practice
      })
    );
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
    const draft = createTimelineDraft({
      episodeId: activeEpisode?.id,
      recordingSessionId: nextSnapshot.session?.id,
      deviceDefaults: settings.deviceDefaults,
      markers: podcastTools.markers,
      durationMs: nextSnapshot.elapsedMs
    });
    await saveTimelineDraftState(draft);
    await refreshUnfinishedSessions();
  }

  function popOutTeleprompter() {
    const promptWindow = window.open("", "what-about-it-teleprompter", "width=900,height=700");
    if (!promptWindow) return;
    const mode = podcastTools.teleprompter.mode;
    const text = `${podcastTools.teleprompter.script}\n\n${podcastTools.teleprompter.sponsorScript}`.trim() || "Teleprompter is ready when you are.";
    promptWindow.document.write(`
      <html>
        <head>
          <title>Teleprompter</title>
          <style>
            body { margin: 0; padding: 48px; font-family: Georgia, serif; font-size: ${podcastTools.teleprompter.fontSize}px; line-height: 1.5; color: ${mode === "dark" ? "#fff4dc" : "#211513"}; background: ${mode === "dark" ? "#211513" : "#fff4dc"}; }
          </style>
        </head>
        <body>${text.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character] ?? character).replace(/\n/g, "<br />")}</body>
      </html>
    `);
    promptWindow.document.close();
  }

  const studioReady = Boolean(settings.deviceDefaults.cameras.camera1 && settings.deviceDefaults.microphones.morganMic);

  return (
    <main className="studio-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-badge">WAI</div>
          <div>
            <p className="eyebrow">Offline studio</p>
            <h1>{activeTheme.branding.logoText}</h1>
          </div>
        </div>

        <nav className="nav-stack" aria-label="Studio sections">
          <button className={view === "home" ? "active" : ""} onClick={() => setView("home")}>
            <MonitorPlay size={20} /> Home
          </button>
          <button className={view === "new-episode" ? "active" : ""} onClick={() => setView("new-episode")}>
            <Plus size={20} /> New Episode
          </button>
          <button className={view === "device-setup" ? "active" : ""} onClick={() => setView("device-setup")}>
            <Camera size={20} /> Studio Setup
          </button>
          <button className={view === "recording" ? "active" : ""} onClick={() => setView("recording")}>
            <Circle size={20} /> Record
          </button>
          <button className={view === "timeline-review" ? "active" : ""} onClick={() => setView("timeline-review")}>
            <ListVideo size={20} /> Review Episode
          </button>
          <button className={view === "auto-edit-review" ? "active" : ""} onClick={() => setView("auto-edit-review")}>
            <Sparkles size={20} /> Auto Edit
          </button>
          <button className={view === "export" ? "active" : ""} onClick={() => setView("export")}>
            <Download size={20} /> Export
          </button>
          <button className={view === "hardware-test" ? "active" : ""} onClick={() => setView("hardware-test")}>
            <ShieldCheck size={20} /> Hardware Test
          </button>
          <button className={view === "theme-editor" ? "active" : ""} onClick={() => setView("theme-editor")}>
            <Brush size={20} /> Theme Editor
          </button>
          <button className={view === "learn" ? "active" : ""} onClick={() => setView("learn")}>
            <BookOpen size={20} /> Learn Studio
          </button>
          <button className={view === "practice" ? "active" : ""} onClick={() => setView("practice")}>
            <Clapperboard size={20} /> Practice Mode
          </button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
            <Settings size={20} /> Settings
          </button>
        </nav>

        <div className="phase-note">
          <Sparkles size={18} />
          Phase 6 Smart Auto Edit Platform. Originals stay safe.
        </div>
      </aside>

      <section className="workspace">
        <JourneyProgress view={view} hasEpisode={episodes.length > 0} studioReady={studioReady} recordingComplete={recordingSnapshot.status === "stopped"} reviewReady={timelineDraft.tracks.length > 0} exportComplete={exportJob?.status === "complete"} />
        {showTour && <GuidedTour onClose={(preference) => void closeTour(preference)} />}
        {view === "home" && <HomeView episodes={episodes} onNewEpisode={() => setView("new-episode")} onStudioSetup={() => setView("device-setup")} />}
        {view === "new-episode" && (
          <NewEpisodeView
            title={title}
            guestName={guestName}
            description={description}
            setTitle={setTitle}
            setGuestName={setGuestName}
            setDescription={setDescription}
            createEpisode={createEpisode}
            onBack={() => setView("home")}
            onNext={() => setView("device-setup")}
          />
        )}
        {view === "device-setup" && (
          <div className="view-stack">
            {studioReady && (
              <SuccessPanel
                title="Studio Ready!"
                message="Your cameras and microphones are ready to go."
                actionLabel="Start Recording"
                onAction={() => setView("recording")}
              />
            )}
            <DeviceSetupWizard
              detection={deviceDetection}
              defaults={settings.deviceDefaults}
              microphoneLevel={microphoneLevel}
              currentStep={wizardStep}
              onStepChange={setWizardStep}
              onRefresh={() => void refreshDevices()}
              onRequestPermission={() => void requestStudioPermissions()}
              onDefaultsChange={(defaults) => void saveDeviceDefaults(defaults)}
              onTestMicrophone={() => void testMicrophone()}
              onPlayTestSound={() => void playTestSound()}
            />
          </div>
        )}
        {view === "recording" && (
          <RecordingStudio
            defaults={settings.deviceDefaults}
            snapshot={recordingSnapshot}
            unfinishedSessions={unfinishedSessions}
            podcastTools={podcastTools}
            storageWarning={undefined}
            onStart={() => void startRecording(false)}
            onPause={() => void pauseRecording()}
            onResume={() => void resumeRecording()}
            onStop={() => void stopRecording()}
            onPractice={() => void startRecording(true)}
            onDismissRecovery={() => setUnfinishedSessions([])}
            onNext={() => {
              if (activeEpisode) void loadTimelineForEpisode(activeEpisode.id);
              setView("timeline-review");
            }}
            onPodcastToolsChange={(nextState) => void savePodcastToolsState(nextState)}
            onPopOutTeleprompter={popOutTeleprompter}
          />
        )}
        {view === "timeline-review" && (
          <TimelineReview
            draft={timelineDraft}
            onDraftChange={(nextDraft) => void saveTimelineDraftState(nextDraft)}
            onSaveDraft={() => void saveTimelineDraftState(markTimelineSaved(timelineDraft))}
            onExport={() => setView("export")}
            onAutoEdit={() => void runAutoEditFlow(reviewMode)}
          />
        )}
        {view === "auto-edit-review" && (
          <AutoEditReview
            mode={autoEditMode}
            result={autoEditResult}
            running={autoEditRunning}
            onModeChange={setAutoEditMode}
            onRun={() => void runAutoEditFlow(reviewMode)}
            onExport={() => setView("export")}
          />
        )}
        {view === "export" && (
          <ExportEpisode
            selectedType={selectedExportType}
            qualityPreset={selectedQualityPreset}
            job={exportJob}
            mediaToolsStatus={mediaToolsStatus}
            onTypeChange={(type) => void changeExportType(type)}
            onQualityChange={(preset) => void changeQualityPreset(preset)}
            onStartExport={() => void startExport(reviewMode)}
            onCancelExport={() => void cancelExport()}
            onOpenFolder={() => void openExportFolder()}
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
        {view === "theme-editor" && (
          <ThemeEditorView activeThemeId={settings.activeThemeId} changeTheme={changeTheme} />
        )}
        {view === "learn" && <LearnStudioView />}
        {view === "practice" && <PracticeModeView />}
        {view === "settings" && <SettingsView settings={settings} activeThemeName={activeTheme.name} />}
      </section>
    </main>
  );
}

function JourneyProgress({
  view,
  hasEpisode,
  studioReady,
  recordingComplete,
  reviewReady,
  exportComplete
}: {
  view: View;
  hasEpisode: boolean;
  studioReady: boolean;
  recordingComplete: boolean;
  reviewReady: boolean;
  exportComplete: boolean;
}) {
  const steps: Array<{ label: string; complete: boolean; active: boolean; locked?: boolean }> = [
    { label: "New Episode", complete: hasEpisode, active: view === "home" || view === "new-episode" },
    { label: "Studio Setup", complete: studioReady, active: view === "device-setup" },
    { label: "Record", complete: recordingComplete, active: view === "recording" },
    { label: "Review", complete: reviewReady && view !== "recording", active: view === "timeline-review" },
    { label: "Auto Edit", complete: Boolean(view === "export" || exportComplete), active: view === "auto-edit-review" },
    { label: "Edit", complete: reviewReady, active: view === "timeline-review" },
    { label: "Export", complete: exportComplete, active: view === "export" }
  ];

  return (
    <nav className="journey-progress" aria-label="Episode progress">
      {steps.map((step) => (
        <span className={`${step.complete ? "complete" : ""} ${step.active ? "active" : ""} ${step.locked ? "locked" : ""}`} key={step.label}>
          <i aria-hidden="true">{step.complete ? <CheckCircle2 size={18} /> : step.active ? <Circle size={14} /> : null}</i>
          {step.label}
        </span>
      ))}
    </nav>
  );
}

function GuidedTour({ onClose }: { onClose: (preference: "skip" | "remind-later" | "never") => void }) {
  const topics = [
    "Navigation keeps the whole studio one click away.",
    "Studio Setup walks through cameras, mics, and headphones.",
    "Recording saves everything safely on this computer.",
    "Practice Mode lets you rehearse without touching real gear.",
    "Learn Studio is always there when you want a hand."
  ];

  return (
    <section className="tour-card" role="dialog" aria-label="Guided tour">
      <button className="tour-close" type="button" aria-label="Skip guided tour" onClick={() => onClose("skip")}>
        <X size={18} />
      </button>
      <div>
        <p className="signature">Need help? I'll walk you through it.</p>
        <h2>Let's make something great.</h2>
        <p className="soft-copy">Five quick stops, no tech lecture. You can come back to Learn Studio anytime.</p>
      </div>
      <div className="tour-topic-grid">
        {topics.map((topic) => (
          <span key={topic}><Compass size={18} /> {topic}</span>
        ))}
      </div>
      <div className="tour-actions">
        <Button variant="primary" icon={<ArrowRight size={20} />} onClick={() => onClose("skip")}>Start with Home</Button>
        <Button variant="secondary" onClick={() => onClose("remind-later")}>Remind Me Later</Button>
        <Button variant="secondary" onClick={() => onClose("never")}>Never Show Again</Button>
      </div>
    </section>
  );
}

function SuccessPanel({
  title,
  message,
  actionLabel,
  onAction
}: {
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <section className="success-panel">
      <CheckCircle2 size={34} />
      <div>
        <h3>{title}</h3>
        <p>{message}</p>
      </div>
      <Button variant="primary" icon={<ArrowRight size={20} />} onClick={onAction}>{actionLabel}</Button>
    </section>
  );
}

function HomeView({
  episodes,
  onNewEpisode,
  onStudioSetup
}: {
  episodes: EpisodeMetadata[];
  onNewEpisode: () => void;
  onStudioSetup: () => void;
}) {
  return (
    <div className="view-stack">
      <section className="hero-panel">
        <div>
          <p className="signature">Morgan's offline podcast room</p>
          <h2>Ready when you are.</h2>
          <p className="hero-copy">
            Start with a new episode. Then I will walk you through setup, recording, and what comes next.
          </p>
          <Button variant="primary" icon={<Plus size={24} />} onClick={onNewEpisode}>New Episode</Button>
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
              <Button variant="primary" icon={<Plus size={20} />} onClick={onNewEpisode}>New Episode</Button>
            </div>
          ) : (
            <div className="episode-list">
              {episodes.map((episode) => (
                <article className="episode-card" key={episode.id}>
                  <div>
                    <h4>{episode.title}</h4>
                    <p>{episode.guestName || "Solo episode"} - {new Date(episode.createdAt).toLocaleDateString()}</p>
                  </div>
                  <span>{episode.status}</span>
                </article>
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
            <span><Camera size={18} /> Studio Setup is ready</span>
            <span><Mic2 size={18} /> Mic check is ready</span>
            <span><Circle size={18} /> Recording foundation is ready</span>
          </div>
          <p>Next best move: check the studio, record, review, Auto Edit, then export a local finished copy.</p>
          <Button variant="secondary" icon={<ArrowRight size={20} />} onClick={onStudioSetup}>Go to Studio Setup</Button>
        </div>
      </section>
    </div>
  );
}

function NewEpisodeView(props: {
  title: string;
  guestName: string;
  description: string;
  setTitle: (value: string) => void;
  setGuestName: (value: string) => void;
  setDescription: (value: string) => void;
  createEpisode: () => Promise<void>;
  onBack: () => void;
  onNext: () => void;
}) {
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
        <Button variant="secondary" icon={<ArrowLeft size={20} />} onClick={props.onBack}>Back Home</Button>
        <Button variant="primary" icon={<Plus size={22} />} disabled={!props.title.trim()} onClick={() => void props.createEpisode().then(props.onNext)}>
          Create Episode and Check Studio
        </Button>
      </div>
    </section>
  );
}

function ThemeEditorView({ activeThemeId, changeTheme }: { activeThemeId: string; changeTheme: (themeId: string) => Promise<void> }) {
  return (
    <section className="view-stack">
      <div className="panel">
        <p className="signature">Make the whole room yours</p>
        <h2>Theme Editor</h2>
        <p className="soft-copy">
          Phase 1 ships the theme engine and built-in themes. Custom create, export, import, and share controls are staged here for the full editor.
        </p>
        <div className="theme-grid">
          {builtInThemes.map((theme) => (
            <button
              className={`theme-tile ${activeThemeId === theme.id ? "selected" : ""}`}
              key={theme.id}
              onClick={() => void changeTheme(theme.id)}
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
        <div className="editor-actions" aria-label="Future custom theme actions">
          <button disabled>Create custom theme</button>
          <button disabled>Export theme</button>
          <button disabled>Import theme</button>
          <button disabled>Share theme</button>
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
  const needsAttention = Object.values(results).some((result) => result.status === "needs-attention" || result.status === "disconnected");
  const summary = needsAttention ? "Needs Attention" : "Everything Ready";
  const storageCopy = storageStatus?.availableBytes
    ? `${Math.floor(storageStatus.availableBytes / 1024 / 1024 / 1024)} GB available`
    : storageStatus?.message ?? "Storage check waiting";

  return (
    <section className="hardware-test-screen">
      <div className="hardware-test-hero">
        <div>
          <p className="signature">Real gear check</p>
          <h2>Let's test the studio for real</h2>
          <p className="soft-copy">
            This mode only passes when your actual camera, microphone, recording, and export path work on this computer.
          </p>
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
          <button
            className={step === stepId ? "active" : ""}
            key={stepId}
            onClick={() => onStepChange(stepId as HardwareTestStep)}
          >
            <span>{eyebrow}</span>
            {label}
          </button>
        ))}
      </div>

      <div className="studio-dashboard-grid" aria-label="Live studio readiness">
        {[results.camera1, results.camera2, results.camera3].map((result) => (
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
            <p>We'll look for real cameras and keep the main screen simple: Camera 1, Camera 2, Camera 3.</p>
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
            <Button variant="primary" icon={<Download size={22} />} onClick={onExport}>
              Export test
            </Button>
            <p className={`hardware-inline-status ${exportStatus}`}>
              {exportJob?.message ?? mediaToolsStatus?.message ?? "Export is waiting for the test recording."}
            </p>
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
        {diagnosticsBundle && (
          <p className="hardware-test-message">Diagnostics saved: {diagnosticsBundle.folderPath}</p>
        )}
        {step !== "results" && (
          <Button variant="secondary" icon={<ArrowRight size={22} />} onClick={() => onStepChange(getNextHardwareTestStep(step))}>
            Next step
          </Button>
        )}
      </div>

      <div className="hardware-results-grid" aria-label="Hardware test results">
        {Object.values(results).map((result) => (
          <article className={`hardware-result-card ${result.status}`} key={result.label}>
            {result.status === "ready" ? <CheckCircle2 size={24} /> : result.status === "needs-attention" ? <X size={24} /> : <Circle size={18} />}
            <h3>{result.label}</h3>
            <p>{result.message}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function SettingsView({ settings, activeThemeName }: { settings: StudioSettings; activeThemeName: string }) {
  return (
    <section className="panel settings-panel">
      <p className="signature">Local by default</p>
      <h2>Settings</h2>
      <dl>
        <div><dt>Active theme</dt><dd>{activeThemeName}</dd></div>
        <div><dt>Episode folder</dt><dd>{settings.defaultEpisodeFolderName}</dd></div>
        <div><dt>Practice Mode</dt><dd>{settings.practiceModeEnabled ? "On" : "Off"}</dd></div>
        <div><dt>Camera 1</dt><dd>{settings.deviceDefaults.cameras.camera1 ? "Saved" : "Not picked yet"}</dd></div>
        <div><dt>Morgan Mic</dt><dd>{settings.deviceDefaults.microphones.morganMic ? "Saved" : "Not picked yet"}</dd></div>
        <div><dt>Storage</dt><dd>Local Documents folder</dd></div>
        <div><dt>Default export folder</dt><dd>{settings.exportSettings.defaultExportFolder}</dd></div>
        <div><dt>Default export type</dt><dd>{settings.exportSettings.defaultExportType}</dd></div>
        <div><dt>Export quality</dt><dd>{settings.exportSettings.qualityPreset}</dd></div>
      </dl>
    </section>
  );
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
      <p className="soft-copy">
        Walk through the recording room tools with branded practice screens. No fake people photos and no real media files.
      </p>
      <div className="practice-steps">
        <span><Plus size={20} /> Practice starting a new episode</span>
        <span><Camera size={20} /> Practice Studio Setup with safe sample screens</span>
        <span><Circle size={20} /> Press Practice on the Record screen</span>
        <span><Mic2 size={20} /> Practice pause and resume</span>
        <span><BookOpen size={20} /> Try the teleprompter and sponsor script</span>
        <span><Clapperboard size={20} /> Tap soundboard buttons without playing real files</span>
        <span><Camera size={20} /> Switch camera layouts safely</span>
        <span><Sparkles size={20} /> Mark funny, highlight, and fix-later moments</span>
        <span><ListVideo size={20} /> Practice timeline review with fake markers</span>
        <span><Sparkles size={20} /> Practice Auto Edit with sample timeline data</span>
        <span><Scissors size={20} /> Practice safe trim, split, undo, redo, and restore original</span>
        <span><Download size={20} /> Practice exporting a finished copy without real media</span>
        <span><Headphones size={20} /> Learn that everything saves locally</span>
        <span><Clapperboard size={20} /> Try the recovery message without risking real media</span>
      </div>
    </section>
  );
}

function getLessonCopy(lesson: string) {
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
