import { rm } from "node:fs/promises";
import path from "node:path";

const appRoot = path.resolve(import.meta.dirname, "..");
await rm(path.join(appRoot, "dist"), { recursive: true, force: true });

