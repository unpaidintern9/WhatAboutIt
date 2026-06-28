import path from "node:path";
import { app } from "electron";
import { defaultStudioConfiguration, type StudioConfiguration } from "../shared/config";

export function getStudioConfiguration(): StudioConfiguration {
  return defaultStudioConfiguration;
}

export function getAppDataRoot(configuration = getStudioConfiguration()) {
  return app.isPackaged ? app.getPath("userData") : path.join(app.getPath("documents"), configuration.storage.appDataFolderName);
}

export function getEpisodesRoot(configuration = getStudioConfiguration()) {
  return path.join(getAppDataRoot(configuration), configuration.storage.episodeFolderName);
}

export function getSettingsPath(configuration = getStudioConfiguration()) {
  return path.join(getAppDataRoot(configuration), "settings.json");
}

export function getWorkspaceStatePath(configuration = getStudioConfiguration()) {
  return path.join(getAppDataRoot(configuration), "studio-workspace.json");
}

export function getLogsRoot(configuration = getStudioConfiguration()) {
  return path.join(getAppDataRoot(configuration), "logs");
}

export function getDiagnosticsRoot(configuration = getStudioConfiguration()) {
  return path.join(getAppDataRoot(configuration), "diagnostics");
}

export function getAppPathSummary(configuration = getStudioConfiguration()) {
  const appDataRoot = getAppDataRoot(configuration);
  return {
    mode: app.isPackaged ? "packaged" : "development",
    appDataRoot,
    episodesRoot: getEpisodesRoot(configuration),
    logsRoot: getLogsRoot(configuration),
    diagnosticsRoot: getDiagnosticsRoot(configuration),
    settingsPath: getSettingsPath(configuration)
  };
}
