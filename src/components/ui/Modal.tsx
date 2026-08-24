"use client";

import { type KeyboardEvent, type ReactNode, useEffect } from "react";

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
  maxWidth = "max-w-lg",
}: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleContainerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-4 bg-slate-950/90 backdrop-blur-md animate-in fade-in duration-200">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleContainerKeyDown}
        className={`flex flex-col w-full ${maxWidth} max-h-[85dvh] rounded-3xl border border-white/15 bg-slate-900/98 shadow-2xl backdrop-blur-2xl overflow-hidden transition-all my-auto`}
      >
        {/* Sticky Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0 bg-slate-900/95">
          <h3
            id={titleId}
            className="text-sm sm:text-base font-bold text-white tracking-wide"
          >
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog"
            className="grid size-9 place-items-center rounded-xl bg-white/10 text-slate-300 hover:bg-white/20 transition active:scale-95 text-sm font-bold"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Body with Momentum Touch Scrolling */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 text-slate-100 touch-pan-y">
          {children}
        </div>

        {/* Sticky Modal Footer */}
        <div className="px-5 py-3 border-t border-white/10 shrink-0 bg-slate-950/80 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 active:scale-95 text-slate-950 font-black text-xs transition shadow-md shadow-sky-500/20"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}
