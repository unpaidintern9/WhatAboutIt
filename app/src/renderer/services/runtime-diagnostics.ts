import type { RuntimeLogEntry } from "../../shared/diagnostics";
import { sanitizeDiagnosticValue } from "../../shared/diagnostic-data";
let context: Record<string, unknown> = {};
export function setRuntimeDiagnosticContext(next: Record<string, unknown>) { context = next; }
export function writeRuntimeDiagnostic(level: RuntimeLogEntry["level"], source: string, message: string, details: Record<string, unknown> = {}) {
  try {
    void window.studio?.writeRuntimeLog?.({ level, source, message,
      details: sanitizeDiagnosticValue({ ...context, rendererObservedAt: new Date().toISOString(), ...details }) as Record<string, unknown> }).catch(() => undefined);
  } catch { /* Diagnostics must not stop capture, including during renderer failure. */ }
}
let installed = false;
export function installRendererErrorDiagnostics() {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (event) => writeRuntimeDiagnostic("error", "Renderer", "Unhandled renderer error.", {
    error: event.error ?? event.message, filename: event.filename, line: event.lineno, column: event.colno }));
  window.addEventListener("unhandledrejection", (event) => writeRuntimeDiagnostic("error", "Renderer", "Unhandled renderer promise rejection.", { error: event.reason }));
}
