"use client";

import { type KeyboardEvent, type ReactNode, useEffect } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  titleId?: string;
  subtitle?: string;
  children: ReactNode;
  maxWidth?: string;
  hideFooter?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  title,
  titleId = "modal-title",
  subtitle,
  children,
  maxWidth = "max-w-lg",
  hideFooter = false,
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
    /*
     * Modal dialog diposisikan tepat di tengah layar (center-aligned)
     * dengan margin responsif, rounded-3xl modern, dan batasan tinggi
     * aman dinamis sesuai Rule 4.17.
     *
     * `data-no-pull-refresh` mencegah gestur tarik-ke-bawah aktif di atas
     * backdrop (lihat components/PullToRefresh.tsx).
     */
    <div
      data-no-pull-refresh
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/85 p-3.5 sm:p-4 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleContainerKeyDown}
        className={`flex w-full ${maxWidth} max-h-[min(88dvh,calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom)_-_1.5rem))] flex-col overflow-hidden rounded-3xl border border-white/15 bg-slate-900/98 shadow-2xl shadow-black/80 backdrop-blur-2xl transition-all animate-in zoom-in-95 duration-200`}
      >
        {/* Sticky Modal Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-white/10 shrink-0 bg-slate-900/95 sm:py-4">
          <div className="min-w-0 flex-1">
            <h3
              id={titleId}
              className="truncate text-sm sm:text-base font-bold text-white tracking-wide"
              title={title}
            >
              {title}
            </h3>
            {subtitle ? (
              <p className="text-[11px] text-slate-400 truncate mt-0.5">
                {subtitle}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog"
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white transition active:scale-95 text-sm font-bold"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Body with Momentum Touch Scrolling */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 text-slate-100 touch-pan-y">
          {children}
        </div>

        {/* Sticky Footer */}
        {!hideFooter ? (
          <div className="flex shrink-0 items-center justify-end border-t border-white/10 bg-slate-950/80 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 active:scale-95 text-slate-950 font-black text-xs transition shadow-md shadow-sky-500/20"
            >
              Tutup
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
