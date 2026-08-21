import type { ExportSettings } from "./export";
import type { StudioWorkspaceSettings } from "./studio-workspace";
import type { AutoEditLearningProfile } from "./auto-edit";

export type EpisodeStatus = "draft" | "ready" | "recorded" | "exported";

export interface EpisodeMetadata {
  id: string;
  title: string;
  guestName?: string;
  description?: string;
  status: EpisodeStatus;
  createdAt: string;
  updatedAt: string;
  folderPath: string;
  phase: "phase-1-shell";
}

export interface StudioSettings {
  activeThemeId: string;
  defaultEpisodeFolderName: string;
  practiceModeEnabled: boolean;
  deviceDefaults: DeviceDefaults;
  exportSettings: ExportSettings;
  onboarding?: {
    guidedTour: "show" | "remind-later" | "never";
  };
  ui?: {
    sidebarCollapsed?: boolean;
  };
  studioWorkspace?: StudioWorkspaceSettings;
  autoEditLearning?: AutoEditLearningProfile;
  recordingPreferences?: RecordingPreferences;
  recordingTemplate?: RecordingTemplate;
}

export interface RecordingPreferences {
  countdownSeconds: 0 | 3 | 5;
  syncCueEnabled: boolean;
  confirmStopAfterSeconds: number;
  plannedDurationMinutes: number;
  liveModeEnabled: boolean;
  primaryFolderPath?: string;
  backupFolderPath?: string;
}

export interface RecordingTemplate {
  name: string;
  savedAt: string;
  deviceDefaults: DeviceDefaults;
  preferences: RecordingPreferences;
}

export const defaultRecordingPreferences: RecordingPreferences = {
  countdownSeconds: 0,
  syncCueEnabled: true,
  confirmStopAfterSeconds: 30,
  plannedDurationMinutes: 120,
  liveModeEnabled: true
};

export type CameraSlotKey = "camera1" | "camera2" | "camera3";
export type MicrophoneSlotKey = "morganMic" | "guestMic" | "extraMic";
export type MicrophoneInputChannel =
  | "mix"
  | "input-1"
  | "input-2"
  | "input-3"
  | "input-4"
  | "input-5"
  | "input-6"
  | "input-7"
  | "input-8"
  | "input-9"
  | "input-10"
  | "input-11"
  | "input-12"
  | "input-13"
  | "input-14"
  | "input-15"
  | "input-16";

export interface DeviceDefaults {
  cameras: Partial<Record<CameraSlotKey, string>>;
  cameraMicrophones?: Partial<Record<CameraSlotKey, MicrophoneSlotKey>>;
  cameraSettings?: Record<string, import("./camera-config").CameraAdvancedSettings>;
  microphones: Partial<Record<MicrophoneSlotKey, string>>;
  microphoneChannels?: Partial<Record<MicrophoneSlotKey, MicrophoneInputChannel>>;
  microphoneNames?: Partial<Record<MicrophoneSlotKey, string>>;
  microphoneDeviceLabels?: Partial<Record<MicrophoneSlotKey, string>>;
  audioOutputId?: string;
}

export interface ThemeTokens {
  id: string;
  name: string;
  description: string;
  colors: Record<string, string>;
  typography: {
    displayFont: string;
    headingFont: string;
    bodyFont: string;
    accentFont: string;
    baseSize: string;
    displaySize: string;
    headingSize: string;
    smallSize: string;
    displayWeight: number;
    headingWeight: number;
    bodyWeight: number;
    letterSpacing: string;
    lineHeight: string;
  };
  spacing: Record<string, string>;
  branding: {
    applicationName: string;
    logoText: string;
    sidebarLogoText: string;
    splashTitle: string;
    loadingText: string;
    exportBranding: string;
    iconStyle: string;
  };
  icons: {
    style: string;
    strokeWidth: number;
    buttonSize: string;
    heroSize: string;
    badgeText: string;
  };
  textures: {
    paper: string;
    leather: string;
    wood: string;
    fabric: string;
    metal: string;
    flat?: string;
    active: "paper" | "leather" | "wood" | "fabric" | "metal" | "flat" | "none";
    intensity: number;
  };
  animations: {
    transitionFast: string;
    transitionBase: string;
    transitionSlow: string;
    hoverLift: string;
    pressDepth: string;
    disabledOpacity: number;
  };
  components: {
    buttonShape: string;
    borderRadius: string;
    cardRadius: string;
    shadow: string;
    borderStyle: string;
    navStyle: string;
    hoverAnimation: string;
    transitionSpeed: string;
    iconStyle: string;
    buttonShadow?: string;
    borderWidth?: string;
    focusRing?: string;
  };
}
