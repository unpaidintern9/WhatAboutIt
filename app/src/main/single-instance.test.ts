import { describe, expect, it, vi } from "vitest";
import { claimStudioInstance } from "./single-instance";
import type { App } from "electron";

describe("studio single instance", () => {
  it("quits a duplicate before it can initialize capture", () => {
    const app = { requestSingleInstanceLock: () => false, quit: vi.fn(), on: vi.fn() };
    expect(claimStudioInstance(app as unknown as App, () => undefined)).toBe(false);
    expect(app.quit).toHaveBeenCalledOnce();
    expect(app.on).not.toHaveBeenCalled();
  });
  it("restores the existing window when another copy is launched", () => {
    let second: (() => void) | undefined;
    const app = { requestSingleInstanceLock: () => true, quit: vi.fn(), on: (_event: string, callback: () => void) => { second = callback; } };
    const window = { isDestroyed: () => false, isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn() };
    expect(claimStudioInstance(app as unknown as App, () => window)).toBe(true);
    second?.();
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    expect(app.quit).not.toHaveBeenCalled();
  });
  it("handles a duplicate launch before the first window is ready", () => {
    let second: (() => void) | undefined;
    const app = { requestSingleInstanceLock: () => true, quit: vi.fn(), on: (_event: string, callback: () => void) => { second = callback; } };
    claimStudioInstance(app as unknown as App, () => undefined);
    expect(() => second?.()).not.toThrow();
  });
});
