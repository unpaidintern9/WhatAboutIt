import os from "node:os";
import path from "node:path";

export const shortcutDisplayName = "What About It Studio";
export const shortcutFileName = `${shortcutDisplayName}.lnk`;
export const installedAppDirectoryName = "what-about-it-studio";

export function getFallbackDesktopPath(homeDir = os.homedir()) {
  return path.join(homeDir, "Desktop");
}

export function getElectronTargetPath(appRoot = process.cwd()) {
  return path.join(appRoot, "node_modules", "electron", "dist", "electron.exe");
}

export function getPackagedTargetPath(appRoot = process.cwd()) {
  return path.join(
    appRoot,
    "release",
    "win-unpacked",
    `${shortcutDisplayName}.exe`,
  );
}

export function getInstalledTargetPath(
  localAppData = process.env.LOCALAPPDATA,
) {
  if (!localAppData) return undefined;
  return path.join(
    localAppData,
    "Programs",
    installedAppDirectoryName,
    `${shortcutDisplayName}.exe`,
  );
}

export function getShortcutPath(desktopPath = getFallbackDesktopPath()) {
  return path.join(desktopPath, shortcutFileName);
}

export function getShortcutArguments() {
  return ".";
}

export function getShortcutWorkingDirectory(appRoot = process.cwd()) {
  return appRoot;
}

export function getShortcutIconPath(appRoot = process.cwd()) {
  return getElectronTargetPath(appRoot);
}
