import type { ThemeTokens } from "../../shared/types";
import whatAboutIt from "../../../themes/what-about-it.json";
import midnightStudio from "../../../themes/midnight-studio.json";
import cleanSlate from "../../../themes/clean-slate.json";
import cabinSessions from "../../../themes/cabin-sessions.json";
import nashvilleNeon from "../../../themes/nashville-neon.json";
import creatorMode from "../../../themes/creator-mode.json";

export const builtInThemes = [
  whatAboutIt,
  midnightStudio,
  cleanSlate,
  cabinSessions,
  nashvilleNeon,
  creatorMode
] as ThemeTokens[];

export function findTheme(themeId: string) {
  return builtInThemes.find((theme) => theme.id === themeId) ?? builtInThemes[0];
}

export function applyTheme(theme: ThemeTokens) {
  const root = document.documentElement;

  Object.entries(theme.colors).forEach(([key, value]) => {
    root.style.setProperty(`--color-${key}`, value);
  });

  root.style.setProperty("--font-display", theme.typography.displayFont);
  root.style.setProperty("--font-heading", theme.typography.headingFont);
  root.style.setProperty("--font-body", theme.typography.bodyFont);
  root.style.setProperty("--font-accent", theme.typography.accentFont);
  root.style.setProperty("--font-base-size", theme.typography.baseSize);
  root.style.setProperty("--font-display-weight", String(theme.typography.displayWeight));
  root.style.setProperty("--font-heading-weight", String(theme.typography.headingWeight));
  root.style.setProperty("--font-body-weight", String(theme.typography.bodyWeight));
  root.style.setProperty("--letter-spacing", theme.typography.letterSpacing);
  root.style.setProperty("--line-height", theme.typography.lineHeight);

  const activeTexture = theme.textures.active === "none" ? "none" : theme.textures[theme.textures.active];
  root.style.setProperty("--texture-active", activeTexture);
  root.style.setProperty("--texture-intensity", String(theme.textures.intensity));

  root.style.setProperty("--component-border-radius", theme.components.borderRadius);
  root.style.setProperty("--component-card-radius", theme.components.cardRadius);
  root.style.setProperty("--component-shadow", theme.components.shadow);
  root.style.setProperty("--component-border-style", theme.components.borderStyle);
  root.style.setProperty("--component-transition-speed", theme.components.transitionSpeed);
}

