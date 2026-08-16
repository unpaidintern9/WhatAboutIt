import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  getElectronTargetPath,
  getFallbackDesktopPath,
  getInstalledTargetPath,
  getPackagedTargetPath,
  getShortcutArguments,
  getShortcutIconPath,
  getShortcutPath,
  getShortcutWorkingDirectory,
  shortcutDisplayName,
} from "./shortcut-paths.mjs";

const appRoot = process.cwd();
const developmentShortcut = process.argv.includes("--dev");
const installedTargetPath = getInstalledTargetPath();
const packagedTargetPath = getPackagedTargetPath(appRoot);
const packagedTarget = [installedTargetPath, packagedTargetPath].find(
  (candidate) => candidate && existsSync(candidate),
);
const targetPath = developmentShortcut
  ? getElectronTargetPath(appRoot)
  : packagedTarget;

if (developmentShortcut && !existsSync(targetPath)) {
  throw new Error(
    `Electron was not found at ${targetPath}. Run npm install inside app first.`,
  );
}

if (!targetPath) {
  throw new Error(
    "No installed or packaged app was found. Run npm run installer:win and install it, or run npm run package:win first. " +
      "Use npm run create-shortcut:dev only when an updater-disabled development shortcut is intentional.",
  );
}

const desktopPath =
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    "[Environment]::GetFolderPath('Desktop')",
  ])
    .toString()
    .trim() || getFallbackDesktopPath();

const shortcutPath = getShortcutPath(desktopPath);
const shortcutArguments = developmentShortcut ? getShortcutArguments() : "";
const workingDirectory = developmentShortcut
  ? getShortcutWorkingDirectory(appRoot)
  : path.dirname(targetPath);
const iconPath = developmentShortcut
  ? getShortcutIconPath(appRoot)
  : targetPath;

const script = `
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($env:WAI_SHORTCUT_PATH)
$shortcut.TargetPath = $env:WAI_SHORTCUT_TARGET
$shortcut.Arguments = $env:WAI_SHORTCUT_ARGS
$shortcut.WorkingDirectory = $env:WAI_SHORTCUT_WORKDIR
$shortcut.IconLocation = $env:WAI_SHORTCUT_ICON
$shortcut.Description = "Launch ${shortcutDisplayName}"
$shortcut.Save()
`;

execFileSync(
  "powershell.exe",
  ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
  {
    env: {
      ...process.env,
      WAI_SHORTCUT_PATH: shortcutPath,
      WAI_SHORTCUT_TARGET: targetPath,
      WAI_SHORTCUT_ARGS: shortcutArguments,
      WAI_SHORTCUT_WORKDIR: workingDirectory,
      WAI_SHORTCUT_ICON: iconPath,
    },
    stdio: "inherit",
  },
);

console.log(
  `Created ${shortcutDisplayName} ${developmentShortcut ? "development" : "packaged app"} shortcut at ${shortcutPath}`,
);
console.log(`Target: ${targetPath}`);
