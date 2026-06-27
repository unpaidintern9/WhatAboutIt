import type { DiagnosticsBundleRequest, DiagnosticsBundleResult } from "./hardware-test";

export type { DiagnosticsBundleRequest, DiagnosticsBundleResult };

export interface StorageStatus {
  availableBytes?: number;
  message: "Storage check ready" | "Storage check unavailable";
}
