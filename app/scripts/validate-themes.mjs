import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "./project-paths.mjs";
import { fail, pathExists } from "./validation-utils.mjs";

const themesRoot = path.join(projectRoot, "themes");
const requiredFiles = ["colors.json", "typography.json", "spacing.json", "components.json", "icons.json", "textures.json", "animations.json"];
const requiredColorKeys = ["primary", "secondary", "accent", "success", "warning", "danger", "background", "surface", "cards", "buttons", "icons", "audioMeters", "text", "mutedText", "inverseText", "border", "focus"];
const requiredTypographyKeys = ["displayFont", "headingFont", "bodyFont", "accentFont", "baseSize", "displaySize", "headingSize", "smallSize", "displayWeight", "headingWeight", "bodyWeight", "letterSpacing", "lineHeight"];

const themeDirs = (await readdir(themesRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
if (themeDirs.length === 0) fail("No theme folders found.");

for (const theme of themeDirs) {
  const themePath = path.join(themesRoot, theme.name);
  for (const file of requiredFiles) {
    const fullPath = path.join(themePath, file);
    if (!(await pathExists(fullPath))) fail(`Theme ${theme.name} is missing ${file}.`);
  }

  const colors = JSON.parse(await readFile(path.join(themePath, "colors.json"), "utf8"));
  const typography = JSON.parse(await readFile(path.join(themePath, "typography.json"), "utf8"));

  for (const key of requiredColorKeys) {
    if (!colors[key]) fail(`Theme ${theme.name} colors.json is missing ${key}.`);
  }

  for (const key of requiredTypographyKeys) {
    if (typography[key] === undefined) fail(`Theme ${theme.name} typography.json is missing ${key}.`);
  }
}

console.log(`Theme validation passed for ${themeDirs.length} themes.`);

