import { readFile } from "node:fs/promises";
import path from "node:path";
import { appRoot, projectRoot } from "./project-paths.mjs";
import { listFiles } from "./validation-utils.mjs";

const roots = [appRoot, path.join(projectRoot, "themes"), path.join(projectRoot, "docs")];
const files = [];

for (const root of roots) {
  files.push(...(await listFiles(root, ".json")));
}

for (const file of files) {
  if (file.includes(`${path.sep}node_modules${path.sep}`) || file.includes(`${path.sep}external-repos${path.sep}`)) continue;
  try {
    JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON: ${path.relative(projectRoot, file)}\n${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    });
  }
}

console.log(`JSON validation passed for ${files.length} files.`);
