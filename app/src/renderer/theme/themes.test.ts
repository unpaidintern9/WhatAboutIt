import { describe, expect, it } from "vitest";
import { applyTheme, builtInThemes, findTheme } from "./themes";

describe("theme engine", () => {
  it("loads all built-in split-token themes", () => {
    expect(builtInThemes.map((theme) => theme.id).sort()).toEqual([
      "cabin-sessions",
      "clean-slate",
      "creator-mode",
      "midnight-studio",
      "nashville-neon",
      "what-about-it"
    ]);
  });

  it("falls back to the default theme", () => {
    expect(findTheme("missing-theme").id).toBe("what-about-it");
  });

  it("applies theme tokens as CSS custom properties", () => {
    applyTheme(findTheme("what-about-it"));
    expect(document.documentElement.style.getPropertyValue("--color-primary")).toBe("#8F1D1B");
    expect(document.documentElement.style.getPropertyValue("--space-controlHeight")).toBe("58px");
  });
});

