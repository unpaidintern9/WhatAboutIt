import { readdir } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "./project-paths.mjs";
import { fail, pathExists } from "./validation-utils.mjs";

const pluginsRoot = path.join(projectRoot, "plugins");
const requiredPlugins = ["recording", "cameras", "audio", "timeline", "auto-edit", "export", "teleprompter", "themes", "learning-center"];

for (const plugin of requiredPlugins) {
  const readme = path.join(pluginsRoot, plugin, "README.md");
  if (!(await pathExists(readme))) fail(`Plugin ${plugin} is missing README.md.`);
}

const entries = (await readdir(pluginsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
const unknown = entries.filter((entry) => !requiredPlugins.includes(entry));
if (unknown.length > 0) fail(`Unknown plugin folders: ${unknown.join(", ")}`);

console.log(`Plugin validation passed for ${requiredPlugins.length} plugins.`);

