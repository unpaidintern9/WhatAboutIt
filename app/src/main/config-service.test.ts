import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const mockElectron = vi.hoisted(() => ({
  isPackaged: false,
  paths: {
    documents: "C:\\Users\\Morgan\\Documents",
    userData: "C:\\Users\\Morgan\\AppData\\Roaming\\What About It Studio"
  }
}));

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return mockElectron.isPackaged;
    },
    getPath: (name: "documents" | "userData") => mockElectron.paths[name]
  }
}));

describe("config-service path resolution", () => {
  it("keeps development data in Documents for the existing desktop workflow", async () => {
    vi.resetModules();
    mockElectron.isPackaged = false;
    const { getAppPathSummary } = await import("./config-service");

    expect(getAppPathSummary()).toMatchObject({
      mode: "development",
      appDataRoot: path.join(mockElectron.paths.documents, "WhatAboutItStudioData")
    });
  });

  it("uses Electron userData in packaged mode without source repo paths", async () => {
    vi.resetModules();
    mockElectron.isPackaged = true;
    const { getAppPathSummary } = await import("./config-service");
    const summary = getAppPathSummary();

    expect(summary.mode).toBe("packaged");
    expect(summary.appDataRoot).toBe(mockElectron.paths.userData);
    expect(summary.episodesRoot).toBe(path.join(mockElectron.paths.userData, "episodes"));
    expect(Object.values(summary).join("\n")).not.toContain("OneDrive\\Documents\\WhatAboutItStudio");
  });

  it("uses a user-selected recording library without moving settings and logs", async () => {
    vi.resetModules();
    mockElectron.isPackaged = true;
    const { configureEpisodesRoot, getAppPathSummary } = await import("./config-service");
    const selectedRoot = path.join("D:\\Podcast Recordings", "What About It");

    configureEpisodesRoot(selectedRoot);
    const summary = getAppPathSummary();

    expect(summary.episodesRoot).toBe(path.resolve(selectedRoot));
    expect(summary.settingsPath).toBe(path.join(mockElectron.paths.userData, "settings.json"));
    expect(summary.logsRoot).toBe(path.join(mockElectron.paths.userData, "logs"));
  });
});
