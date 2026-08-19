"use client";

import { type ReactNode, useEffect } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  titleId?: string;
  children: ReactNode;
  maxWidth?: string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  titleId = "modal-title",
  children,
  maxWidth = "max-w-md",
}: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className={`w-full ${maxWidth} rounded-t-3xl sm:rounded-3xl border border-white/15 bg-slate-900/95 p-5 shadow-2xl backdrop-blur-xl transition-all max-h-[90dvh] overflow-y-auto pb-[calc(1.5rem+env(safe-area-inset-bottom))]`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
          <h3 id={titleId} className="text-base font-bold text-white">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog"
            className="grid size-9 place-items-center rounded-xl bg-white/10 text-slate-300 hover:bg-white/20 transition active:scale-95"
          >
            ✕
          </button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}
