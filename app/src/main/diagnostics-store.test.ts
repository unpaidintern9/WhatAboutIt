import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPaths = vi.hoisted(() => ({
  appDataRoot: "",
  logsRoot: "",
  diagnosticsRoot: "",
  pathSummary: {}
}));
const openPath = vi.hoisted(() => vi.fn(async () => ""));

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.1.0"
  },
  shell: { openPath }
}));

vi.mock("./config-service", () => ({
  getEpisodesRoot: () => String((mockPaths.pathSummary as { episodesRoot?: string }).episodesRoot),
  getLogsRoot: () => mockPaths.logsRoot,
  getDiagnosticsRoot: () => mockPaths.diagnosticsRoot,
  getAppPathSummary: () => mockPaths.pathSummary
}));

vi.mock("./logger", () => ({
  flushLogs: vi.fn(async () => undefined),
  getLogSnapshot: () => ({ runId: "test-run", activeFile: undefined, fallbackRoot: path.join(mockPaths.appDataRoot, "fallback-logs"), pendingEntries: 0, droppedEntries: 0, primaryFailures: 0, fallbackFailures: 0, memoryLines: [] }),
  getCurrentLogFilePath: () => path.join(mockPaths.logsRoot, "today.log"),
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

describe("diagnostics bundle", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockPaths.appDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wai-diagnostics-"));
    mockPaths.logsRoot = path.join(mockPaths.appDataRoot, "logs");
    mockPaths.diagnosticsRoot = path.join(mockPaths.appDataRoot, "diagnostics");
    mockPaths.pathSummary = {
      mode: "packaged",
      appDataRoot: mockPaths.appDataRoot,
      episodesRoot: path.join(mockPaths.appDataRoot, "episodes"),
      logsRoot: mockPaths.logsRoot,
      diagnosticsRoot: mockPaths.diagnosticsRoot,
      settingsPath: path.join(mockPaths.appDataRoot, "settings.json")
    };
    await fs.mkdir(mockPaths.logsRoot, { recursive: true });
    await fs.writeFile(path.join(mockPaths.logsRoot, "today.log"), "friendly log", "utf8");
  });

  afterEach(async () => {
    await fs.rm(mockPaths.appDataRoot, { recursive: true, force: true });
  });

  it("exports expected diagnostics files without media payloads", async () => {
    const sessionFolder = path.join(mockPaths.appDataRoot, "episodes", "episode-a");
    await fs.mkdir(path.join(sessionFolder, "Session"), { recursive: true });
    await fs.mkdir(path.join(sessionFolder, "Logs"), { recursive: true });
    await fs.writeFile(path.join(sessionFolder, "Session", "recording-session.json"), JSON.stringify({ id: "session-a" }), "utf8");
    await fs.writeFile(path.join(sessionFolder, "Logs", "errors.log"), "", "utf8");

    const { createDiagnosticsBundle } = await import("./diagnostics-store");
    const bundle = await createDiagnosticsBundle({
      devices: [{ id: "camera-a", label: "Camera", kind: "camera" }],
      results: {
        camera1: { label: "Camera 1", status: "ready", message: "Camera 1 Ready" },
        camera2: { label: "Camera 2", status: "not-run", message: "Not checked yet" },
        camera3: { label: "Camera 3", status: "not-run", message: "Not checked yet" },
        morganMic: { label: "Morgan Mic", status: "ready", message: "Morgan Mic Ready" },
        exportReady: { label: "Export", status: "ready", message: "Export Ready" }
      },
      appVersion: "0.1.0",
      activeEpisodeId: "episode-a",
      recordingSessionFolder: sessionFolder,
      message: "Everything Ready"
    });

    await expect(fs.stat(path.join(bundle.folderPath, "app-info.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(bundle.folderPath, "device-list.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(bundle.folderPath, "hardware-test-results.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(bundle.folderPath, "session", "recording-session.json"))).resolves.toBeTruthy();
    expect(bundle.files.some((file) => file.endsWith(".webm"))).toBe(false);
    const appInfo = await fs.readFile(path.join(bundle.folderPath, "app-info.json"), "utf8");
    expect(appInfo).not.toContain("OneDrive\\\\Documents\\\\WhatAboutItStudio");
  });

  it("exposes and opens the persistent live log folder", async () => {
    const { getLiveLogInfo, openLiveLogs } = await import("./diagnostics-store");

    await expect(getLiveLogInfo()).resolves.toMatchObject({
      folderPath: mockPaths.logsRoot,
      filePath: path.join(mockPaths.logsRoot, "today.log")
    });
    await expect(openLiveLogs()).resolves.toMatchObject({ folderPath: mockPaths.logsRoot });
    expect(openPath).toHaveBeenCalledWith(mockPaths.logsRoot);
  });
  it("includes every recording part's manifests and errors in one text-only ZIP", async () => {
    const episode = path.join(mockPaths.appDataRoot, "episodes", "episode-parts");
    for (const part of ["part-0001", "part-0002"]) {
      const folder = path.join(episode, "Recordings", part);
      await fs.mkdir(path.join(folder, "Session"), { recursive: true }); await fs.mkdir(path.join(folder, "Logs"));
      await fs.writeFile(path.join(folder, "Session/capture-manifest.json"), JSON.stringify({ sessionId: "session", sources: { morganMic: { lastSequence: 20 } } }));
      await fs.writeFile(path.join(folder, "Logs/errors.log"), "EPERM capture-manifest.json");
      await fs.writeFile(path.join(folder, "private-audio.pcm"), "never include audio");
    }
    await fs.mkdir(path.join(episode, "Session"));
    await fs.writeFile(path.join(episode, "Session/recording-parts.json"), JSON.stringify({ parts: [1, 2] }));
    const { createDiagnosticsBundle } = await import("./diagnostics-store");
    const result = await createDiagnosticsBundle({ activeEpisodeId: "episode-parts", devices: [], results: {} as never, appVersion: "wrong-renderer-version", message: "support" });
    expect(result.files.filter((file) => file.endsWith("capture-manifest.json"))).toHaveLength(2);
    expect(result.files.filter((file) => file.endsWith("errors.log"))).toHaveLength(2);
    const zip = await fs.readFile(result.archivePath!);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50); expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.toString()).not.toContain("never include audio"); expect(zip.toString()).not.toContain("private-audio.pcm");
    expect(JSON.parse(await fs.readFile(path.join(result.folderPath, "app-info.json"), "utf8")).appVersion).toBe("0.1.0");
    expect(result.files.some((file) => file.endsWith("recording-parts.json"))).toBe(true);
    expect(JSON.parse(await fs.readFile(path.join(result.folderPath, "bundle-manifest.json"), "utf8")).includedMedia).toBe(false);
  });

  it("makes incomplete file collection visible rather than silently reporting success", async () => {
    const episode = path.join(mockPaths.appDataRoot, "episodes", "episode-unreadable"); await fs.mkdir(episode, { recursive: true });
    const stat = vi.spyOn(fs, "lstat").mockRejectedValueOnce(Object.assign(new Error("Access denied"), { code: "EACCES" }));
    try {
      const { createDiagnosticsBundle } = await import("./diagnostics-store");
      const result = await createDiagnosticsBundle({ activeEpisodeId: "episode-unreadable", devices: [], results: {} as never, appVersion: "test", message: "support" });
      expect(result.warnings?.some((warning) => warning.includes("Access denied"))).toBe(true);
      expect(JSON.parse(await fs.readFile(path.join(result.folderPath, "bundle-manifest.json"), "utf8")).warnings.length).toBeGreaterThan(0);
    } finally { stat.mockRestore(); }
  });

  it("redacts legacy structured logs and retains complete recording-part arrays", async () => {
    const episode = path.join(mockPaths.appDataRoot, "episodes", "episode-many-parts");
    await fs.mkdir(path.join(episode, "Session"), { recursive: true });
    await fs.writeFile(path.join(episode, "Session/recording-parts.json"), JSON.stringify({ parts: Array.from({ length: 80 }, (_, index) => ({ index })) }));
    await fs.writeFile(path.join(mockPaths.logsRoot, "legacy.log"), JSON.stringify({ message: 'Server replied {"accessKey":"old-secret"}', details: { token: "old-token" } }));
    const { createDiagnosticsBundle } = await import("./diagnostics-store");
    const result = await createDiagnosticsBundle({ activeEpisodeId: "episode-many-parts", devices: [], results: {} as never, appVersion: "test", message: "support" });
    const log = await fs.readFile(path.join(result.folderPath, "logs/primary/legacy.log"), "utf8");
    expect(log).not.toContain("old-secret"); expect(log).not.toContain("old-token");
    expect(JSON.parse(await fs.readFile(path.join(result.folderPath, "session/recording-parts.json"), "utf8")).parts).toHaveLength(80);
  });

});
