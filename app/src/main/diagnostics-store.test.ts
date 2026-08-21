import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPaths = vi.hoisted(() => ({
  appDataRoot: "",
  logsRoot: "",
  diagnosticsRoot: "",
  pathSummary: {},
}));

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.1.0",
  },
}));

vi.mock("./config-service", () => ({
  getEpisodesRoot: () =>
    String((mockPaths.pathSummary as { episodesRoot?: string }).episodesRoot),
  getLogsRoot: () => mockPaths.logsRoot,
  getDiagnosticsRoot: () => mockPaths.diagnosticsRoot,
  getAppPathSummary: () => mockPaths.pathSummary,
}));

vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("diagnostics bundle", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockPaths.appDataRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "wai-diagnostics-"),
    );
    mockPaths.logsRoot = path.join(mockPaths.appDataRoot, "logs");
    mockPaths.diagnosticsRoot = path.join(mockPaths.appDataRoot, "diagnostics");
    mockPaths.pathSummary = {
      mode: "packaged",
      appDataRoot: mockPaths.appDataRoot,
      episodesRoot: path.join(mockPaths.appDataRoot, "episodes"),
      logsRoot: mockPaths.logsRoot,
      diagnosticsRoot: mockPaths.diagnosticsRoot,
      settingsPath: path.join(mockPaths.appDataRoot, "settings.json"),
    };
    await fs.mkdir(mockPaths.logsRoot, { recursive: true });
    await fs.writeFile(
      path.join(mockPaths.logsRoot, "today.log"),
      "friendly log",
      "utf8",
    );
  });

  afterEach(async () => {
    await fs.rm(mockPaths.appDataRoot, { recursive: true, force: true });
  });

  it("exports expected diagnostics files without media payloads", async () => {
    const sessionFolder = path.join(
      mockPaths.appDataRoot,
      "episodes",
      "episode-a",
    );
    await fs.mkdir(path.join(sessionFolder, "Session"), { recursive: true });
    await fs.mkdir(path.join(sessionFolder, "Logs"), { recursive: true });
    await fs.writeFile(
      path.join(sessionFolder, "Session", "recording-session.json"),
      JSON.stringify({ id: "session-a" }),
      "utf8",
    );
    await fs.writeFile(
      path.join(sessionFolder, "Logs", "errors.log"),
      "",
      "utf8",
    );

    const { createDiagnosticsBundle } = await import("./diagnostics-store");
    const bundle = await createDiagnosticsBundle({
      devices: [{ id: "camera-a", label: "Camera", kind: "camera" }],
      results: {
        camera1: {
          label: "Camera 1",
          status: "ready",
          message: "Camera 1 Ready",
        },
        camera2: {
          label: "Camera 2",
          status: "not-run",
          message: "Not checked yet",
        },
        camera3: {
          label: "Camera 3",
          status: "not-run",
          message: "Not checked yet",
        },
        morganMic: {
          label: "Morgan Mic",
          status: "ready",
          message: "Morgan Mic Ready",
        },
        guestMic: {
          label: "Guest Mic",
          status: "not-run",
          message: "Not checked yet",
        },
        extraMic: {
          label: "Extra Mic",
          status: "not-run",
          message: "Not checked yet",
        },
        exportReady: {
          label: "Export",
          status: "ready",
          message: "Export Ready",
        },
      },
      appVersion: "0.1.0",
      activeEpisodeId: "episode-a",
      recordingSessionFolder: sessionFolder,
      message: "Everything Ready",
    });

    await expect(
      fs.stat(path.join(bundle.folderPath, "app-info.json")),
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(bundle.folderPath, "device-list.json")),
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(bundle.folderPath, "hardware-test-results.json")),
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(bundle.folderPath, "hardware-certification.json")),
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(
        path.join(bundle.folderPath, "session", "recording-session.json"),
      ),
    ).resolves.toBeTruthy();
    expect(bundle.files.some((file) => file.endsWith(".webm"))).toBe(false);
    const appInfo = await fs.readFile(
      path.join(bundle.folderPath, "app-info.json"),
      "utf8",
    );
    expect(appInfo).not.toContain("OneDrive\\\\Documents\\\\WhatAboutItStudio");
  });
});
