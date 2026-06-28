import type { ExportSettings } from "./export";

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
}

export interface DeviceDefaults {
  cameras: {
    camera1?: string;
    camera2?: string;
    camera3?: string;
  };
  cameraSettings?: Record<string, import("./camera-config").CameraAdvancedSettings>;
  microphones: {
    morganMic?: string;
    guestMic?: string;
    extraMic?: string;
  };
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
