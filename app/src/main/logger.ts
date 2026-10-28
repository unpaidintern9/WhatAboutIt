import fs from "node:fs/promises";
import { openSync, writeSync, fsyncSync, closeSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { getLogsRoot } from "./config-service";
import { sanitizeDiagnosticValue } from "../shared/diagnostic-data";

const logContext = new AsyncLocalStorage<Record<string, unknown>>();
export function withLogContext<T>(context: Record<string, unknown>, operation: () => T): T { return logContext.run(context, operation); }

export type LogLevel = "info" | "warning" | "error" | "debug";
export interface LogEntry { level: LogLevel; source: string; message: string; details?: Record<string, unknown> }

export function createDiagnosticLogger(options: {
  root: () => string; fallbackRoot: string; maxFileBytes?: number; maxFiles?: number;
  retentionDays?: number; flushDelayMs?: number; context?: () => Record<string, unknown> | undefined;
}) {
  const runId = randomUUID(), started = performance.now();
  const maxBytes = options.maxFileBytes ?? 2 * 1024 * 1024;
  let sequence = 0, segment = 0, pendingBytes = 0, ringBytes = 0, dropped = 0, memoryEvicted = 0;
  let primaryFailures = 0, fallbackFailures = 0, lastFailure: unknown;
  let activeFile: string | undefined, lastPruned = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let draining: Promise<void> | undefined;
  const pending: string[] = [], ring: string[] = [];
  const filename = () => `${new Date().toISOString().slice(0, 10)}-${runId.slice(0, 8)}-${String(segment).padStart(3, "0")}.log`;
  const primaryFile = () => path.join(options.root(), filename());
  function lineFor(entry: LogEntry) {
    const safe = sanitizeDiagnosticValue(entry) as LogEntry;
    const context = sanitizeDiagnosticValue(options.context?.() ?? {}) as Record<string, unknown>;
    const identifiers = Object.fromEntries(["episodeId", "sessionId", "capturePart", "webContentsId"].flatMap((key) => {
      const value = safe.details?.[key] ?? context[key]; return value === undefined ? [] : [[key, value]];
    }));
    const line = JSON.stringify({ schemaVersion: 1, ...identifiers, timestamp: new Date().toISOString(),
      runId, sequence: ++sequence, elapsedMs: Math.round(performance.now() - started), ...safe });
    return line.length <= 24000 ? `${line}\n` : `${JSON.stringify({ schemaVersion: 1, timestamp: new Date().toISOString(), runId, sequence,
      level: entry.level, source: entry.source.slice(0, 80), message: "Oversized diagnostic entry truncated", details: { preview: line.slice(0, 12000) } })}\n`;
  }
  function remember(line: string) {
    ring.push(line); ringBytes += Buffer.byteLength(line);
    while (ring.length > 1000 || ringBytes > 1024 * 1024) { ringBytes -= Buffer.byteLength(ring.shift()!); memoryEvicted++; }
  }
  async function prune(root: string) {
    const names = (await fs.readdir(root)).filter((name) => /^\d{4}-\d{2}-\d{2}.*\.log$/.test(name));
    const files = await Promise.all(names.map(async (name) => ({ name, stat: await fs.stat(path.join(root, name)) })));
    files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    await Promise.all(files.filter((entry, index) => path.join(root, entry.name) !== activeFile &&
      (index >= (options.maxFiles ?? 30) || entry.stat.mtimeMs < Date.now() - (options.retentionDays ?? 14) * 86400000))
      .map((entry) => fs.rm(path.join(root, entry.name), { force: true })));
  }
  async function append(root: string, batch: string) {
    await fs.mkdir(root, { recursive: true });
    let file = path.join(root, filename());
    const size = await fs.stat(file).then((stat) => stat.size, () => 0);
    if (size && size + Buffer.byteLength(batch) > maxBytes) { segment++; file = path.join(root, filename()); }
    const handle = await fs.open(file, "a", 0o600);
    try { await handle.writeFile(batch, "utf8"); await handle.datasync(); }
    finally { await handle.close(); }
    activeFile = file;
    if (lastPruned !== file) { lastPruned = file; await prune(root).catch(() => undefined); }
  }
  async function drain() {
    while (pending.length) {
      const batch = pending.splice(0).join(""); pendingBytes = 0;
      try { await append(options.root(), batch); }
      catch (error) {
        primaryFailures++; lastFailure = sanitizeDiagnosticValue(error);
        try { await append(options.fallbackRoot, batch); }
        catch (fallbackError) { fallbackFailures++; lastFailure = sanitizeDiagnosticValue(fallbackError); }
      }
    }
  }
  async function flush() {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (draining) await draining;
    if (pending.length) {
      draining = drain().catch((error) => { lastFailure = sanitizeDiagnosticValue(error); }).finally(() => { draining = undefined; });
      await draining;
    }
  }
  function enqueue(entry: LogEntry): Promise<void> {
    try {
      const line = lineFor(entry); remember(line); pending.push(line); pendingBytes += Buffer.byteLength(line);
      while (pendingBytes > 512 * 1024 || pending.length > 500) { pendingBytes -= Buffer.byteLength(pending.shift()!); dropped++; }
      timer ??= setTimeout(() => { timer = undefined; void flush(); }, options.flushDelayMs ?? 250);
    } catch (error) { lastFailure = sanitizeDiagnosticValue(error); dropped++; }
    // Awaited logging calls must never delay or fail media operations.
    return Promise.resolve();
  }
  function emergency(entry: LogEntry) {
    try {
      const line = lineFor(entry); remember(line);
      for (const root of [() => options.root(), () => options.fallbackRoot]) {
        try { const directory = root(); mkdirSync(directory, { recursive: true }); const handle = openSync(path.join(directory, filename()), "a", 0o600);
          try { writeSync(handle, line); fsyncSync(handle); } finally { closeSync(handle); } return; }
        catch { /* Preserve the memory event and the original crash behavior. */ }
      }
    } catch { /* Do not recurse into logging. */ }
  }
  return { write: enqueue, flush, emergency, primaryFile,
    snapshot: () => ({ runId, activeFile, fallbackRoot: options.fallbackRoot, pendingEntries: pending.length,
      droppedEntries: dropped, memoryEvictedEntries: memoryEvicted, primaryFailures, fallbackFailures, lastFailure, memoryLines: [...ring] }) };
}

const diagnosticLogger = createDiagnosticLogger({ root: () => getLogsRoot(),
  fallbackRoot: path.join(os.tmpdir(), "WhatAboutItStudio", "logs"), context: () => logContext.getStore() });
export const writeLog = diagnosticLogger.write;
export const flushLogs = diagnosticLogger.flush;
export const writeEmergencyLog = diagnosticLogger.emergency;
export const getLogSnapshot = diagnosticLogger.snapshot;
export const getCurrentLogFilePath = diagnosticLogger.primaryFile;
export const logger = {
  info: (source: string, message: string, details?: Record<string, unknown>) => writeLog({ level: "info", source, message, details }),
  warning: (source: string, message: string, details?: Record<string, unknown>) => writeLog({ level: "warning", source, message, details }),
  error: (source: string, message: string, details?: Record<string, unknown>) => writeLog({ level: "error", source, message, details }),
  debug: (source: string, message: string, details?: Record<string, unknown>) => writeLog({ level: "debug", source, message, details })
};
