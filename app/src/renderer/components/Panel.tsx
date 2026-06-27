import type { HTMLAttributes, ReactNode } from "react";

interface PanelProps extends HTMLAttributes<HTMLElement> {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}

export function Panel({ title, action, children, className = "", ...props }: PanelProps) {
  return (
    <section className={`wai-panel ${className}`.trim()} {...props}>
      {(title || action) && (
        <header className="wai-panel-heading">
          {title && <h3>{title}</h3>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

