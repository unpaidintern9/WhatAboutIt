import { app, BrowserWindow } from "electron";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import type { AppUpdateStatus } from "../shared/app-update";
import { createInitialAppUpdateStatus, friendlyUpdateError } from "../shared/app-update";
import { logger } from "./logger";

export class AppUpdateService {
  private status = createInitialAppUpdateStatus(app.getVersion(), app.isPackaged);
  private checkPromise?: Promise<AppUpdateStatus>;

  constructor() {
    if (!app.isPackaged) return;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = true;
    autoUpdater.on("checking-for-update", () =>
      this.publish({
        state: "checking",
        message: "Checking GitHub for updates…"
      })
    );
    autoUpdater.on("update-available", (info) => this.handleAvailable(info));
    autoUpdater.on("update-not-available", () =>
      this.publish({
        state: "up-to-date",
        message: "You already have the latest version."
      })
    );
    autoUpdater.on("download-progress", (progress) => this.handleProgress(progress));
    autoUpdater.on("update-downloaded", (info) =>
      this.publish({
        state: "ready",
        availableVersion: info.version,
        downloadPercent: 100,
        message: `Version ${info.version} is ready. Restart to install it.`
      })
    );
    autoUpdater.on("error", (error) => {
      void logger.warning("AppUpdate", "Update check or download failed.", {
        error: String(error)
      });
      this.publish({ state: "error", message: friendlyUpdateError(error) });
    });
  }

  getStatus() {
    return this.status;
  }

  checkForUpdates() {
    if (!app.isPackaged) return Promise.resolve(this.status);
    if (this.checkPromise) return this.checkPromise;
    this.publish({
      state: "checking",
      message: "Checking GitHub for updates…"
    });
    this.checkPromise = autoUpdater
      .checkForUpdates()
      .then(() => this.status)
      .catch((error) => {
        this.publish({ state: "error", message: friendlyUpdateError(error) });
        return this.status;
      })
      .finally(() => {
        this.checkPromise = undefined;
      });
    return this.checkPromise;
  }

  async downloadUpdate() {
    if (!app.isPackaged || this.status.state !== "available") return this.status;
    this.publish({
      state: "downloading",
      downloadPercent: 0,
      message: "Downloading the update…"
    });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      this.publish({ state: "error", message: friendlyUpdateError(error) });
    }
    return this.status;
  }

  installUpdate() {
    if (!app.isPackaged || this.status.state !== "ready") return false;
    autoUpdater.quitAndInstall(false, true);
    return true;
  }

  private handleAvailable(info: UpdateInfo) {
    this.publish({
      state: "available",
      availableVersion: info.version,
      message: `Version ${info.version} is available from GitHub.`
    });
  }

  private handleProgress(progress: ProgressInfo) {
    const downloadPercent = Math.max(0, Math.min(100, Math.round(progress.percent)));
    this.publish({
      state: "downloading",
      downloadPercent,
      message: `Downloading update… ${downloadPercent}%`
    });
  }

  private publish(patch: Partial<AppUpdateStatus>) {
    this.status = { ...this.status, ...patch };
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("app:update-status", this.status);
  }
}
