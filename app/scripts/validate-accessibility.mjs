import { readFile } from "node:fs/promises";
import path from "node:path";
import { appRoot, projectRoot } from "./project-paths.mjs";
import { fail, listFiles } from "./validation-utils.mjs";

const files = await listFiles(path.join(appRoot, "src", "renderer"), ".tsx");
const unlabeledIconButtons = [];

for (const file of files) {
  const content = await readFile(file, "utf8");
  const iconButtonMatches = content.match(/<Button[^>]*variant="icon"[^>]*>/g) ?? [];
  for (const match of iconButtonMatches) {
    if (!match.includes("aria-label")) unlabeledIconButtons.push(path.relative(projectRoot, file));
  }
}

if (unlabeledIconButtons.length > 0) {
  fail(`Icon buttons need aria-label: ${[...new Set(unlabeledIconButtons)].join(", ")}`);
}

console.log("Accessibility validation passed.");

