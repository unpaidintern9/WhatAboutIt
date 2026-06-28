import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Windows beta installer config", () => {
  it("creates safe Windows shortcuts with the beta app identity", async () => {
    const packageJson = JSON.parse(await fs.readFile(path.resolve(__dirname, "../../package.json"), "utf8")) as {
      build: {
        productName: string;
        appId: string;
        win: { target: string[] };
        nsis: {
          createDesktopShortcut: boolean;
          createStartMenuShortcut: boolean;
          shortcutName: string;
        };
      };
      scripts: Record<string, string>;
    };

    expect(packageJson.build.productName).toBe("What About It Studio");
    expect(packageJson.build.appId).toBe("studio.whataboutit.desktop");
    expect(packageJson.build.win.target).toContain("nsis");
    expect(packageJson.build.nsis).toMatchObject({
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: "What About It Studio"
    });
    expect(packageJson.scripts["installer:win"]).toContain("electron-builder --win nsis");
  });
});
