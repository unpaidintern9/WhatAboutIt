import type { ReactNode } from "react";

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="wai-tooltip">
      {children}
      <span role="tooltip">{label}</span>
    </span>
  );
}

