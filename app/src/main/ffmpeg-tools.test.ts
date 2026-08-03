import { describe, expect, it } from "vitest";
import { resolveBundledToolPath } from "./ffmpeg-tools";

describe("resolveBundledToolPath", () => {
  it("points packaged media tools at Electron's unpacked executable directory", () => {
    expect(
      resolveBundledToolPath(
        "C:\\Studio\\resources\\app.asar\\node_modules\\@ffmpeg-installer\\win32-x64\\ffmpeg.exe"
      )
    ).toBe(
      "C:\\Studio\\resources\\app.asar.unpacked\\node_modules\\@ffmpeg-installer\\win32-x64\\ffmpeg.exe"
    );
  });

  it("leaves development paths unchanged", () => {
    expect(resolveBundledToolPath("C:\\Studio\\app\\node_modules\\ffmpeg.exe")).toBe(
      "C:\\Studio\\app\\node_modules\\ffmpeg.exe"
    );
  });
});
