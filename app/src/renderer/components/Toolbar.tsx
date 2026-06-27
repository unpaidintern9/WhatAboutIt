import type { ReactNode } from "react";

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="wai-toolbar">{children}</div>;
}

