import type { App, BrowserWindow } from "electron";

type StudioWindow = Pick<BrowserWindow, "isDestroyed" | "isMinimized" | "restore" | "show" | "focus">;

/** Never let a second process open the same capture devices and episode store. */
export function claimStudioInstance(
  app: Pick<App, "requestSingleInstanceLock" | "quit" | "on">,
  getWindow: () => StudioWindow | undefined
) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on("second-instance", () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  return true;
}
