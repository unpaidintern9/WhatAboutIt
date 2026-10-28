import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDiagnosticLogger } from "./logger";
let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "wai-log-test-")); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const entry = (message = "Recording event") => ({ level: "info" as const, source: "Test", message });
const make = (overrides: Partial<Parameters<typeof createDiagnosticLogger>[0]> = {}) => createDiagnosticLogger({ root: () => path.join(root, "primary"), fallbackRoot: path.join(root, "fallback"), flushDelayMs: 10000, ...overrides });
describe("recording-safe diagnostic logger", () => {
  it("buffers without disk waits, then flushes ordered structured events with run and session IDs", async () => {
    const log = make({ context: () => ({ episodeId: "episode-a", sessionId: "session-a" }) });
    await log.write(entry("one")); await log.write(entry("two"));
    await expect(fs.stat(path.join(root, "primary"))).rejects.toThrow();
    await log.flush();
    const rows = (await fs.readFile(log.snapshot().activeFile!, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(rows.map((row) => row.message)).toEqual(["one", "two"]);
    expect(rows.map((row) => row.sequence)).toEqual([1, 2]);
    expect(rows[0]).toMatchObject({ episodeId: "episode-a", sessionId: "session-a", runId: log.snapshot().runId });
  });
  it("falls back when the primary folder is blocked and never rejects the app operation", async () => {
    await fs.writeFile(path.join(root, "blocked"), "not a folder");
    const log = make({ root: () => path.join(root, "blocked") });
    await expect(log.write(entry())).resolves.toBeUndefined(); await log.flush();
    expect(log.snapshot()).toMatchObject({ primaryFailures: 1, fallbackFailures: 0 });
    expect(log.snapshot().activeFile).toContain(path.join(root, "fallback"));
    expect(await fs.readFile(log.snapshot().activeFile!, "utf8")).toContain("Recording event");
  });
  it("retains bounded memory evidence when both disk locations fail", async () => {
    await fs.writeFile(path.join(root, "blocked"), "blocked");
    const log = make({ root: () => path.join(root, "blocked"), fallbackRoot: path.join(root, "blocked") });
    for (let index = 0; index < 2000; index++) await log.write(entry(`event ${index}`));
    expect(log.snapshot().pendingEntries).toBeLessThanOrEqual(500);
    expect(log.snapshot().memoryLines.length).toBeLessThanOrEqual(1000);
    expect(log.snapshot().droppedEntries).toBeGreaterThan(0);
    await expect(log.flush()).resolves.toBeUndefined();
    expect(log.snapshot()).toMatchObject({ primaryFailures: 1, fallbackFailures: 1 });
    expect(log.snapshot().memoryLines.at(-1)).toContain("event 1999");
  });
  it("preserves OS error codes and stacks, redacts credentials and excludes binary data", async () => {
    const log = make();
    const circular: Record<string, unknown> = { token: "hidden-token" }; circular.self = circular;
    await log.write({ ...entry(), details: { error: Object.assign(new Error("EPERM: rename C:/recording.json"), { code: "EPERM", dest: "C:/recording.json" }),
      accessKey: "hidden-key", nested: circular, url: "https://example.test/file?sig=hidden-signature", auth: "Bearer hidden-bearer", bytes: new Uint8Array([10, 20]) } });
    await log.flush(); const text = await fs.readFile(log.snapshot().activeFile!, "utf8");
    for (const secret of ["hidden-token", "hidden-key", "hidden-signature", "hidden-bearer"]) expect(text).not.toContain(secret);
    const error = JSON.parse(text).details.error; expect(error.code).toBe("EPERM"); expect(error.stack).toContain("EPERM");
    expect(text).toContain("[binary omitted]"); expect(text).toContain("[circular]");
  });
  it("rotates and limits old log files", async () => {
    const log = make({ maxFileBytes: 400, maxFiles: 2 });
    for (let index = 0; index < 5; index++) { await log.write(entry(`event ${index}: ${"x".repeat(100)}`)); await log.flush(); await new Promise((resolve) => setTimeout(resolve, 5)); }
    expect((await fs.readdir(path.join(root, "primary"))).length).toBeLessThanOrEqual(2);
    expect(await fs.readFile(log.snapshot().activeFile!, "utf8")).toContain("event 4");
  });
  it("persists buffered exit/crash evidence separately and falls back without throwing", async () => {
    await fs.writeFile(path.join(root, "blocked"), "blocked");
    const log = make({ root: () => path.join(root, "blocked") });
    await log.write(entry("buffered at quit"));
    expect(() => log.flushOnExit()).not.toThrow();
    log.emergency({ level: "error", source: "MainProcess", message: "fatal test", details: { error: Object.assign(new Error("crash"), { code: "TEST" }) } });
    const [name] = await fs.readdir(path.join(root, "fallback"));
    expect(name).toMatch(/-exit\.log$/);
    const rows = (await fs.readFile(path.join(root, "fallback", name), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(rows.map((row) => row.message)).toEqual(["buffered at quit", "fatal test"]);
    expect(rows[1].details.error.code).toBe("TEST");
    await log.flush();
  });

});
