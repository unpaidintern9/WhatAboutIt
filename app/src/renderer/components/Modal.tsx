import type { ReactNode } from "react";

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="wai-modal-backdrop" role="presentation">
      <section className="wai-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close">X</button>
        </header>
        {children}
      </section>
    </div>
  );
}
