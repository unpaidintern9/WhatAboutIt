import type { ThemeTokens } from "../../shared/types";

type ThemeFileKind = "colors" | "typography" | "spacing" | "components" | "icons" | "textures" | "animations";

const themeNames: Record<string, { name: string; description: string }> = {
  "what-about-it": {
    name: "What About It?",
    description: "Vintage Americana podcast studio with deep reds, warm cream, leather black, aged paper, and brass."
  },
  "midnight-studio": {
    name: "Midnight Studio",
    description: "Dark recording-room theme with brass controls and warm highlights."
  },
  "clean-slate": {
    name: "Clean Slate",
    description: "Clear, quiet, cream-forward theme that stays branded without becoming corporate."
  },
  "cabin-sessions": {
    name: "Cabin Sessions",
    description: "Wood, paper, and warm lamp light for cozy long-form recordings."
  },
  "nashville-neon": {
    name: "Nashville Neon",
    description: "Night-out studio energy with red neon, brass, and deep room tones."
  },
  "creator-mode": {
    name: "Creator Mode",
    description: "High-clarity control-room theme for focused production days."
  }
};

const themeModules = import.meta.glob("../../../../themes/*/*.json", { eager: true, import: "default" }) as Record<
  string,
  Record<string, unknown>
>;

function buildThemes() {
  const grouped = new Map<string, Partial<Record<ThemeFileKind, Record<string, unknown>>>>();

  Object.entries(themeModules).forEach(([path, module]) => {
    const match = path.match(/themes\/([^/]+)\/([^/]+)\.json$/);
    if (!match) return;
    const [, themeId, kind] = match as [string, string, ThemeFileKind];
    grouped.set(themeId, { ...grouped.get(themeId), [kind]: module });
  });

  return Array.from(grouped.entries()).map(([id, files]) => {
    const meta = themeNames[id] ?? { name: id, description: "Custom local theme." };
    return {
      id,
      name: meta.name,
      description: meta.description,
      colors: files.colors ?? {},
      typography: files.typography,
      spacing: files.spacing ?? {},
      branding: {
        applicationName: "What About It? Studio",
        logoText: "What About It?",
        sidebarLogoText: "WAI Studio",
        splashTitle: meta.name,
        loadingText: "Warming up the studio...",
        exportBranding: "What About It?",
        iconStyle: String(files.icons?.style ?? "brass-line")
      },
      icons: files.icons,
      textures: files.textures,
      animations: files.animations,
      components: {
        ...files.components,
        iconStyle: String(files.icons?.style ?? "brass-line")
      }
    } as ThemeTokens;
  });
}

export const builtInThemes = buildThemes().sort((a, b) => {
  if (a.id === "what-about-it") return -1;
  if (b.id === "what-about-it") return 1;
  return a.name.localeCompare(b.name);
});

export function findTheme(themeId: string) {
  return builtInThemes.find((theme) => theme.id === themeId) ?? builtInThemes[0];
}

export function applyTheme(theme: ThemeTokens) {
  const root = document.documentElement;

  Object.entries(theme.colors).forEach(([key, value]) => root.style.setProperty(`--color-${key}`, value));
  Object.entries(theme.spacing).forEach(([key, value]) => root.style.setProperty(`--space-${key}`, value));

  root.style.setProperty("--font-display", theme.typography.displayFont);
  root.style.setProperty("--font-heading", theme.typography.headingFont);
  root.style.setProperty("--font-body", theme.typography.bodyFont);
  root.style.setProperty("--font-accent", theme.typography.accentFont);
  root.style.setProperty("--font-base-size", theme.typography.baseSize);
  root.style.setProperty("--font-display-size", theme.typography.displaySize);
  root.style.setProperty("--font-heading-size", theme.typography.headingSize);
  root.style.setProperty("--font-small-size", theme.typography.smallSize);
  root.style.setProperty("--font-display-weight", String(theme.typography.displayWeight));
  root.style.setProperty("--font-heading-weight", String(theme.typography.headingWeight));
  root.style.setProperty("--font-body-weight", String(theme.typography.bodyWeight));
  root.style.setProperty("--letter-spacing", theme.typography.letterSpacing);
  root.style.setProperty("--line-height", theme.typography.lineHeight);

  const activeTexture = theme.textures.active === "none" ? "none" : theme.textures[theme.textures.active] ?? "none";
  root.style.setProperty("--texture-active", activeTexture);
  root.style.setProperty("--texture-intensity", String(theme.textures.intensity));

  root.style.setProperty("--component-border-radius", theme.components.borderRadius);
  root.style.setProperty("--component-card-radius", theme.components.cardRadius);
  root.style.setProperty("--component-shadow", theme.components.shadow);
  root.style.setProperty("--component-button-shadow", theme.components.buttonShadow ?? theme.components.shadow);
  root.style.setProperty("--component-border-style", theme.components.borderStyle);
  root.style.setProperty("--component-border-width", theme.components.borderWidth ?? "2px");
  root.style.setProperty("--component-transition-speed", theme.components.transitionSpeed);
  root.style.setProperty("--component-focus-ring", theme.components.focusRing ?? "0 0 0 4px var(--color-focus)");

  root.style.setProperty("--animation-fast", theme.animations.transitionFast);
  root.style.setProperty("--animation-base", theme.animations.transitionBase);
  root.style.setProperty("--animation-slow", theme.animations.transitionSlow);
  root.style.setProperty("--animation-hover-lift", theme.animations.hoverLift);
  root.style.setProperty("--animation-disabled-opacity", String(theme.animations.disabledOpacity));
}
