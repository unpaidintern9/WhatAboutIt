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
    displayWeight: number;
    headingWeight: number;
    bodyWeight: number;
    letterSpacing: string;
    lineHeight: string;
  };
  branding: {
    applicationName: string;
    logoText: string;
    sidebarLogoText: string;
    splashTitle: string;
    loadingText: string;
    exportBranding: string;
    iconStyle: string;
  };
  textures: {
    paper: string;
    leather: string;
    wood: string;
    fabric: string;
    metal: string;
    active: "paper" | "leather" | "wood" | "fabric" | "metal" | "flat" | "none";
    intensity: number;
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
  };
}

