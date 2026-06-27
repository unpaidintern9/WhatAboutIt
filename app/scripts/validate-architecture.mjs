import { readFile } from "node:fs/promises";
import path from "node:path";
import { appRoot, projectRoot } from "./project-paths.mjs";
import { fail, listFiles, pathExists } from "./validation-utils.mjs";

const forbiddenPaths = [path.join(appRoot, "themes")];
for (const forbiddenPath of forbiddenPaths) {
  if (await pathExists(forbiddenPath)) fail(`Duplicated architecture path should not exist: ${path.relative(projectRoot, forbiddenPath)}`);
}

const sourceFiles = await listFiles(path.join(appRoot, "src"));
for (const file of sourceFiles) {
  const content = await readFile(file, "utf8");
  if (content.includes("external-repos")) fail(`App source must not import external repos directly: ${path.relative(projectRoot, file)}`);
  if (content.includes("getUserMedia") || content.includes("enumerateDevices")) {
    fail(`Phase 2 device integration is not allowed yet: ${path.relative(projectRoot, file)}`);
  }
}

const componentFiles = (await listFiles(path.join(appRoot, "src", "renderer", "components"), ".tsx")).map((file) => path.basename(file));
const duplicates = componentFiles.filter((file, index) => componentFiles.indexOf(file) !== index);
if (duplicates.length > 0) fail(`Duplicate component files: ${duplicates.join(", ")}`);

console.log("Architecture validation passed.");

