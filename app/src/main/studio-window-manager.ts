import { BrowserWindow, screen } from "electron";
import type { Rectangle } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import {
  applyLayoutProfile,
  createWindowState,
  studioPanelLabels,
  withStudioWorkspaceDefaults,
  type StudioDisplayInfo,
  type StudioLayoutProfileId,
  type StudioPanelId,
  type StudioWindowState,
  type StudioWorkspaceState
} from "../shared/studio-workspace";

export class StudioWindowManager {
  private readonly windows = new Map<StudioPanelId, BrowserWindow>();
  private state: StudioWorkspaceState = withStudioWorkspaceDefaults();

  constructor(
    private readonly options: {
      preloadPath: string;
      rendererPath: string;
      devServerUrl?: string;
      statePath: string;
    }
  ) {}

  async load() {
    this.state = withStudioWorkspaceDefaults(await readJsonFile(this.options.statePath, this.state));
    return this.state;
  }

  getState() {
    return this.state;
  }

  async saveState(nextState = this.state) {
    this.state = withStudioWorkspaceDefaults(nextState);
    await fs.mkdir(path.dirname(this.options.statePath), { recursive: true });
    await fs.writeFile(this.options.statePath, JSON.stringify(this.state, null, 2), "utf8");
    return this.state;
  }

  getDisplays(): StudioDisplayInfo[] {
    const primaryId = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((display, index) => ({
      id: display.id,
      label: display.id === primaryId ? "Primary monitor" : `Monitor ${index + 1}`,
      primary: display.id === primaryId,
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor
    }));
  }

  async openPanel(panelId: StudioPanelId, input: { episodeId?: string; displayId?: number; fullscreen?: boolean } = {}) {
    const existing = this.windows.get(panelId);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      if (input.displayId !== undefined) await this.movePanel(panelId, input.displayId);
      return this.snapshot(panelId);
    }

    const saved = this.state.windows[panelId] ?? createWindowState(panelId);
    const display = this.findDisplay(input.displayId ?? saved.displayId ?? this.state.settings.defaultMonitorId);
    const bounds = saved.bounds ?? centerBounds(display.workArea, panelId === "teleprompter" ? 980 : 760, panelId === "teleprompter" ? 720 : 620);
    const win = new BrowserWindow({
      ...bounds,
      minWidth: 520,
      minHeight: 420,
      title: `What About It? ${studioPanelLabels[panelId]}`,
      backgroundColor: "#1a1110",
      show: false,
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    this.windows.set(panelId, win);
    await this.loadPopOutRoute(win, panelId, input.episodeId);
    const fullscreen = input.fullscreen ?? saved.fullscreen;
    if (fullscreen) win.setFullScreen(true);
    win.once("ready-to-show", () => win.show());
    win.on("close", () => {
      this.rememberWindow(panelId, win, false);
    });
    win.on("closed", () => {
      this.windows.delete(panelId);
    });

    this.state.windows[panelId] = createWindowState(panelId, {
      ...saved,
      isPoppedOut: true,
      displayId: display.id,
      fullscreen
    });
    await this.saveState();
    return this.snapshot(panelId);
  }

  async closePanel(panelId: StudioPanelId) {
    const win = this.windows.get(panelId);
    if (win && !win.isDestroyed()) {
      this.rememberWindow(panelId, win, false);
      win.close();
    } else {
      this.state.windows[panelId] = createWindowState(panelId, { ...this.state.windows[panelId], isPoppedOut: false });
      await this.saveState();
    }
    return this.snapshot(panelId);
  }

  async movePanel(panelId: StudioPanelId, displayId: number) {
    const display = this.findDisplay(displayId);
    const win = this.windows.get(panelId);
    const saved = this.state.windows[panelId] ?? createWindowState(panelId);
    const bounds = centerBounds(display.workArea, saved.bounds?.width ?? 860, saved.bounds?.height ?? 640);
    if (win && !win.isDestroyed()) win.setBounds(bounds);
    this.state.windows[panelId] = createWindowState(panelId, { ...saved, isPoppedOut: Boolean(win), displayId, bounds });
    await this.saveState();
    return this.snapshot(panelId);
  }

  async applyLayout(layoutId: StudioLayoutProfileId, episodeId?: string) {
    this.state = applyLayoutProfile(this.state, layoutId);
    await this.saveState();
    await Promise.all(
      Object.entries(this.state.windows).map(async ([panelId, state]) => {
        if (state?.isPoppedOut) await this.openPanel(panelId as StudioPanelId, { episodeId, displayId: state.displayId, fullscreen: state.fullscreen });
      })
    );
    return this.state;
  }

  async resetLayout() {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.close();
    }
    this.windows.clear();
    this.state = withStudioWorkspaceDefaults({ settings: this.state.settings, windows: {} });
    await this.saveState();
    return this.state;
  }

  private snapshot(panelId: StudioPanelId): StudioWindowState {
    return this.state.windows[panelId] ?? createWindowState(panelId);
  }

  private rememberWindow(panelId: StudioPanelId, win: BrowserWindow, isPoppedOut: boolean) {
    const saved = this.state.windows[panelId] ?? createWindowState(panelId);
    const display = screen.getDisplayMatching(win.getBounds());
    this.state.windows[panelId] = createWindowState(panelId, {
      ...saved,
      isPoppedOut,
      displayId: display.id,
      bounds: win.getBounds(),
      fullscreen: win.isFullScreen()
    });
    if (this.state.settings.rememberWindowPositions) void this.saveState();
  }

  private findDisplay(displayId?: number) {
    return screen.getAllDisplays().find((display) => display.id === displayId) ?? screen.getAllDisplays()[1] ?? screen.getPrimaryDisplay();
  }

  private async loadPopOutRoute(win: BrowserWindow, panelId: StudioPanelId, episodeId?: string) {
    const query = new URLSearchParams({ popout: panelId });
    if (episodeId) query.set("episodeId", episodeId);
    if (this.options.devServerUrl) {
      await win.loadURL(`${this.options.devServerUrl}?${query.toString()}`);
      return;
    }
    await win.loadFile(this.options.rendererPath, { query: Object.fromEntries(query) });
  }
}

function centerBounds(workArea: Rectangle, width: number, height: number) {
  return {
    width: Math.min(width, workArea.width),
    height: Math.min(height, workArea.height),
    x: Math.round(workArea.x + (workArea.width - Math.min(width, workArea.width)) / 2),
    y: Math.round(workArea.y + (workArea.height - Math.min(height, workArea.height)) / 2)
  };
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
