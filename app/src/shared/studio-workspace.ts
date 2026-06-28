export type StudioPanelId =
  | "teleprompter"
  | "soundboard"
  | "guest-notes"
  | "episode-notes"
  | "marker-list"
  | "studio-diagnostics"
  | "timeline"
  | "review"
  | "export-queue"
  | "auto-edit-progress";

export type StudioLayoutProfileId =
  | "podcast"
  | "interview"
  | "solo-creator"
  | "dual-monitor"
  | "triple-monitor"
  | "custom";

export interface StudioDisplayInfo {
  id: number;
  label: string;
  primary: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

export interface StudioWindowState {
  panelId: StudioPanelId;
  isPoppedOut: boolean;
  displayId?: number;
  bounds?: { x: number; y: number; width: number; height: number };
  collapsed: boolean;
  fullscreen: boolean;
}

export interface StudioLayoutProfile {
  id: StudioLayoutProfileId;
  name: string;
  windows: Partial<Record<StudioPanelId, Partial<StudioWindowState>>>;
}

export interface StudioWorkspaceSettings {
  rememberWindowPositions: boolean;
  launchWithSavedLayout: boolean;
  defaultMonitorId?: number;
  activeLayoutId: StudioLayoutProfileId;
}

export interface StudioWorkspaceState {
  settings: StudioWorkspaceSettings;
  windows: Partial<Record<StudioPanelId, StudioWindowState>>;
  layouts: StudioLayoutProfile[];
}

export const popOutPanelIds = [
  "teleprompter",
  "soundboard",
  "guest-notes",
  "episode-notes",
  "marker-list",
  "studio-diagnostics"
] as const satisfies StudioPanelId[];

export const futurePopOutPanelIds = ["timeline", "review", "export-queue", "auto-edit-progress"] as const satisfies StudioPanelId[];

export const studioPanelLabels: Record<StudioPanelId, string> = {
  teleprompter: "Teleprompter",
  soundboard: "Soundboard",
  "guest-notes": "Guest Notes",
  "episode-notes": "Episode Notes",
  "marker-list": "Marker List",
  "studio-diagnostics": "Studio Diagnostics",
  timeline: "Timeline",
  review: "Review",
  "export-queue": "Export Queue",
  "auto-edit-progress": "Auto Edit Progress"
};

export const defaultStudioWorkspaceState: StudioWorkspaceState = {
  settings: {
    rememberWindowPositions: true,
    launchWithSavedLayout: false,
    activeLayoutId: "dual-monitor"
  },
  windows: {},
  layouts: [
    {
      id: "podcast",
      name: "Podcast Layout",
      windows: {
        teleprompter: { isPoppedOut: true },
        soundboard: { isPoppedOut: true },
        "marker-list": { collapsed: false }
      }
    },
    {
      id: "interview",
      name: "Interview Layout",
      windows: {
        teleprompter: { isPoppedOut: true, fullscreen: true },
        "guest-notes": { isPoppedOut: true },
        "episode-notes": { collapsed: false }
      }
    },
    {
      id: "solo-creator",
      name: "Solo Creator",
      windows: {
        teleprompter: { isPoppedOut: true },
        soundboard: { collapsed: false },
        "marker-list": { collapsed: false }
      }
    },
    {
      id: "dual-monitor",
      name: "Dual Monitor",
      windows: {
        teleprompter: { isPoppedOut: true, fullscreen: true },
        soundboard: { isPoppedOut: true }
      }
    },
    {
      id: "triple-monitor",
      name: "Triple Monitor",
      windows: {
        teleprompter: { isPoppedOut: true, fullscreen: true },
        soundboard: { isPoppedOut: true },
        "guest-notes": { isPoppedOut: true }
      }
    },
    {
      id: "custom",
      name: "Custom",
      windows: {}
    }
  ]
};

export function withStudioWorkspaceDefaults(state?: Partial<StudioWorkspaceState> | null): StudioWorkspaceState {
  return {
    ...defaultStudioWorkspaceState,
    ...state,
    settings: { ...defaultStudioWorkspaceState.settings, ...state?.settings },
    windows: { ...defaultStudioWorkspaceState.windows, ...state?.windows },
    layouts: state?.layouts?.length ? state.layouts : defaultStudioWorkspaceState.layouts
  };
}

export function createWindowState(panelId: StudioPanelId, patch: Partial<StudioWindowState> = {}): StudioWindowState {
  return {
    panelId,
    isPoppedOut: false,
    collapsed: false,
    fullscreen: false,
    ...patch
  };
}

export function applyLayoutProfile(state: StudioWorkspaceState, layoutId: StudioLayoutProfileId): StudioWorkspaceState {
  const layout = state.layouts.find((candidate) => candidate.id === layoutId);
  if (!layout) return state;
  const windows = { ...state.windows };
  for (const [panelId, patch] of Object.entries(layout.windows) as Array<[StudioPanelId, Partial<StudioWindowState>]>) {
    windows[panelId] = createWindowState(panelId, { ...windows[panelId], ...patch });
  }
  return {
    ...state,
    settings: { ...state.settings, activeLayoutId: layoutId },
    windows
  };
}
