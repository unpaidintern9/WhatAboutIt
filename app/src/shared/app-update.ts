export type AppUpdateState = "idle" | "checking" | "available" | "downloading" | "ready" | "up-to-date" | "error" | "disabled";

export interface AppUpdateStatus {
  state: AppUpdateState;
  currentVersion: string;
  availableVersion?: string;
  downloadPercent?: number;
  message: string;
}

export function createInitialAppUpdateStatus(currentVersion: string, packaged: boolean): AppUpdateStatus {
  return packaged
    ? {
        state: "idle",
        currentVersion,
        message: "Check GitHub for the latest What About It Studio update."
      }
    : {
        state: "disabled",
        currentVersion,
        message: "Updates are available in the installed Windows app."
      };
}

export function friendlyUpdateError(error: unknown) {
  const message = String(error);
  if (/net::|ENOTFOUND|ECONN|internet|network/i.test(message)) return "Could not reach GitHub. Check the internet connection and try again.";
  if (/404|latest\.yml|release/i.test(message)) return "No installable update has been published yet.";
  return "The update could not be completed. Your current version is still safe to use.";
}
