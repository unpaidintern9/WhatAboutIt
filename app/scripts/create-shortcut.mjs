import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  getElectronTargetPath,
  getFallbackDesktopPath,
  getShortcutArguments,
  getShortcutIconPath,
  getShortcutPath,
  getShortcutWorkingDirectory,
  shortcutDisplayName
} from "./shortcut-paths.mjs";

const appRoot = process.cwd();
const targetPath = getElectronTargetPath(appRoot);

if (!existsSync(targetPath)) {
  throw new Error(`Electron was not found at ${targetPath}. Run npm install inside app first.`);
}

const desktopPath = execFileSync("powershell.exe", [
  "-NoProfile",
  "-Command",
  "[Environment]::GetFolderPath('Desktop')"
])
  .toString()
  .trim() || getFallbackDesktopPath();

const shortcutPath = getShortcutPath(desktopPath);
const shortcutArguments = getShortcutArguments();
const workingDirectory = getShortcutWorkingDirectory(appRoot);
const iconPath = getShortcutIconPath(appRoot);

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
      WAI_SHORTCUT_ICON: iconPath
    },
    stdio: "inherit"
  }
);

console.log(`Created ${shortcutDisplayName} shortcut at ${shortcutPath}`);
