import path from "node:path";
import { app } from "electron";
import { defaultStudioConfiguration, type StudioConfiguration } from "../shared/config";

export function getStudioConfiguration(): StudioConfiguration {
  return defaultStudioConfiguration;
}

export function getAppDataRoot(configuration = getStudioConfiguration()) {
  return path.join(app.getPath("documents"), configuration.storage.appDataFolderName);
}

export function getEpisodesRoot(configuration = getStudioConfiguration()) {
  return path.join(getAppDataRoot(configuration), configuration.storage.episodeFolderName);
}

export function getSettingsPath(configuration = getStudioConfiguration()) {
  return path.join(getAppDataRoot(configuration), "settings.json");
}

export function getLogsRoot(configuration = getStudioConfiguration()) {
  return path.join(getAppDataRoot(configuration), "logs");
}

