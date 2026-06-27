import fs from "node:fs/promises";
import path from "node:path";
import { getLogsRoot } from "./config-service";

export type LogLevel = "info" | "warning" | "error" | "debug";

export interface LogEntry {
  level: LogLevel;
  source: string;
  message: string;
  details?: Record<string, unknown>;
}

function todayLogFile() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(getLogsRoot(), `${date}.log`);
}

export async function writeLog(entry: LogEntry) {
  const logsRoot = getLogsRoot();
  await fs.mkdir(logsRoot, { recursive: true });

  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...entry
  });

  await fs.appendFile(todayLogFile(), `${line}\n`, "utf8");
}

export const logger = {
  info: (source: string, message: string, details?: Record<string, unknown>) => writeLog({ level: "info", source, message, details }),
  warning: (source: string, message: string, details?: Record<string, unknown>) => writeLog({ level: "warning", source, message, details }),
  error: (source: string, message: string, details?: Record<string, unknown>) => writeLog({ level: "error", source, message, details }),
  debug: (source: string, message: string, details?: Record<string, unknown>) => writeLog({ level: "debug", source, message, details })
};

