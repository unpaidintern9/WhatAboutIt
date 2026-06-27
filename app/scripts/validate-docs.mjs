import path from "node:path";
import { projectRoot } from "./project-paths.mjs";
import { fail, pathExists } from "./validation-utils.mjs";

const requiredDocs = [
  "docs/ARCHITECTURE.md",
  "docs/ARCHITECTURE_REVIEW.md",
  "docs/AUTO_EDIT_ARCHITECTURE.md",
  "docs/BRAND_SYSTEM.md",
  "docs/BUILD_PROCESS.md",
  "docs/CODE_STYLE.md",
  "docs/CODING_STANDARDS.md",
  "docs/COMPONENT_LIBRARY.md",
  "docs/CONTRIBUTING.md",
  "docs/DESIGN_TOKENS.md",
  "docs/DEVELOPMENT_SETUP.md",
  "docs/LEARNING_ARCHITECTURE.md",
  "docs/PLUGIN_ARCHITECTURE.md",
  "docs/RELEASE_PROCESS.md",
  "docs/TESTING.md"
];

for (const doc of requiredDocs) {
  if (!(await pathExists(path.join(projectRoot, doc)))) fail(`Missing required documentation: ${doc}`);
}

console.log(`Documentation validation passed for ${requiredDocs.length} documents.`);

