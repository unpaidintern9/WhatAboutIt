import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

type ShortcutPathHelpers = {
  shortcutFileName: string;
  getElectronTargetPath: (appRoot?: string) => string;
  getInstalledTargetPath: (localAppData?: string) => string | undefined;
  getPackagedTargetPath: (appRoot?: string) => string;
  getShortcutArguments: () => string;
  getShortcutPath: (desktopPath?: string) => string;
  getShortcutWorkingDirectory: (appRoot?: string) => string;
};

let helpers: ShortcutPathHelpers;

beforeAll(async () => {
  const helperModulePath = pathToFileURL(
    path.resolve(__dirname, "../../scripts/shortcut-paths.mjs"),
  ).href;
  helpers = (await import(helperModulePath)) as ShortcutPathHelpers;
});

describe("desktop shortcut path helpers", () => {
  it("creates the expected shortcut file name", () => {
    expect(helpers.shortcutFileName).toBe("What About It Studio.lnk");
    expect(helpers.getShortcutPath("C:\\Users\\Morgan\\Desktop")).toBe(
      path.join("C:\\Users\\Morgan\\Desktop", "What About It Studio.lnk"),
    );
  });

  it("points the shortcut at Electron with the app folder as the working directory", () => {
    const appRoot = "C:\\Projects\\WhatAboutItStudio\\app";

    expect(helpers.getElectronTargetPath(appRoot)).toBe(
      path.join(appRoot, "node_modules", "electron", "dist", "electron.exe"),
    );
    expect(helpers.getShortcutArguments()).toBe(".");
    expect(helpers.getShortcutWorkingDirectory(appRoot)).toBe(appRoot);
  });

  it("resolves packaged and installed app targets", () => {
    const appRoot = "C:\\Projects\\WhatAboutItStudio\\app";
    const localAppData = "C:\\Users\\Morgan\\AppData\\Local";

    expect(helpers.getPackagedTargetPath(appRoot)).toBe(
      path.join(appRoot, "release", "win-unpacked", "What About It Studio.exe"),
    );
    expect(helpers.getInstalledTargetPath(localAppData)).toBe(
      path.join(
        localAppData,
        "Programs",
        "what-about-it-studio",
        "What About It Studio.exe",
      ),
    );
  });
});
