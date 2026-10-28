import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { durableJson } from "./durable-file";

let folder: string;
beforeEach(async () => { folder = await fs.mkdtemp(path.join(os.tmpdir(), "wai-atomic-save-")); });
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(folder, { recursive: true, force: true }); });
const file = () => path.join(folder, "capture-manifest.json");

describe("durable metadata replacement", () => {
  it.each(["EPERM", "EACCES", "EBUSY"])("retries transient %s without deleting the previous good manifest", async (code) => {
    await durableJson(file(), { sequence: 1 });
    const rename = fs.rename.bind(fs);
    let denied = 0;
    vi.spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      if (denied++ < 3) {
        expect(JSON.parse(await fs.readFile(file(), "utf8"))).toEqual({ sequence: 1 });
        throw Object.assign(new Error("Temporary Windows lock"), { code });
      }
      return rename(source, destination);
    });
    await durableJson(file(), { sequence: 2 });
    expect(JSON.parse(await fs.readFile(file(), "utf8"))).toEqual({ sequence: 2 });
    expect(await fs.readdir(folder)).toEqual(["capture-manifest.json"]);
    expect(denied).toBe(4);
  });

  it("stops after bounded retries and retains the previous good JSON on a persistent lock", async () => {
    await durableJson(file(), { sequence: 1 });
    const error = Object.assign(new Error("Persistent permission denial"), { code: "EPERM" });
    const rename = vi.spyOn(fs, "rename").mockRejectedValue(error);
    await expect(durableJson(file(), { sequence: 2 })).rejects.toBe(error);
    expect(rename).toHaveBeenCalledTimes(9);
    expect(JSON.parse(await fs.readFile(file(), "utf8"))).toEqual({ sequence: 1 });
    expect(await fs.readdir(folder)).toEqual(["capture-manifest.json"]);
  }, 10000);

  it("does not retry a full disk or replace the original with partial JSON", async () => {
    await durableJson(file(), { sequence: 1 });
    const error = Object.assign(new Error("Disk full"), { code: "ENOSPC" });
    const rename = vi.spyOn(fs, "rename").mockRejectedValue(error);
    await expect(durableJson(file(), { sequence: 2 })).rejects.toBe(error);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await fs.readFile(file(), "utf8"))).toEqual({ sequence: 1 });
  });

  it.skipIf(process.platform !== "win32")("survives a real Windows file-sharing lock until its reader releases the manifest", async () => {
    await durableJson(file(), { sequence: 1 });
    const script = "$h=[System.IO.File]::Open($env:WAI_ATOMIC_LOCK_FILE,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read); [Console]::WriteLine('LOCKED'); [Console]::Out.Flush(); try { [Console]::ReadLine() | Out-Null } finally { $h.Dispose() }";
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, WAI_ATOMIC_LOCK_FILE: file() }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let release: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        let output = "";
        let errors = "";
        // A loaded Windows runner can take time to start PowerShell/.NET.
        // Pipe chunks are not line boundaries, so retain a split readiness token.
        child.stderr.on("data", (data) => { errors += String(data); });
        const timeout = setTimeout(() => reject(new Error(`Windows lock helper did not start. ${errors}`)), 30000);
        child.once("error", (error) => { clearTimeout(timeout); reject(error); });
        child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Windows lock helper exited: ${code}`)); });
        child.stdout.on("data", (data) => {
          output += String(data);
          if (output.includes("LOCKED")) { clearTimeout(timeout); resolve(); }
        });
      });
      const rename = fs.rename.bind(fs);
      const lockCodes: string[] = [];
      vi.spyOn(fs, "rename").mockImplementation(async (source, destination) => {
        try { return await rename(source, destination); }
        catch (error) {
          lockCodes.push((error as NodeJS.ErrnoException).code ?? "unknown");
          release ??= setTimeout(() => child.stdin.end("\n"), 200);
          throw error;
        }
      });
      await durableJson(file(), { sequence: 2 });
      expect(lockCodes.length).toBeGreaterThan(0);
      expect(lockCodes.every((code) => ["EPERM", "EACCES", "EBUSY"].includes(code))).toBe(true);
      expect(JSON.parse(await fs.readFile(file(), "utf8"))).toEqual({ sequence: 2 });
    } finally {
      if (release) clearTimeout(release);
      if (!child.stdin.writableEnded && !child.stdin.destroyed) child.stdin.end("\n");
      if (child.exitCode === null) await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => { child.kill(); resolve(); }, 2000);
        child.once("exit", () => { clearTimeout(timeout); resolve(); });
      });
    }
  }, 45000);
});
