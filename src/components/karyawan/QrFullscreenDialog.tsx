"use client";

import { useEffect } from "react";

interface QrFullscreenDialogProps {
  /** Data URL base64 dari QR Code yang akan ditampilkan. */
  qrDataUrl: string;
  /** Nama karyawan untuk label di bawah QR. */
  employeeName: string;
  /** Apakah dialog ditampilkan. */
  isOpen: boolean;
  /** Callback untuk menutup dialog. */
  onClose: () => void;
}

/**
 * Dialog fullscreen untuk menampilkan QR Code pada ukuran maksimal.
 * Latar putih digunakan untuk kontras QR Code terbaik saat di-scan dari jarak jauh.
 * Menutup dengan tombol silang, klik luar area QR, atau tekan Escape.
 */
export function QrFullscreenDialog({
  qrDataUrl,
  employeeName,
  isOpen,
  onClose,
}: QrFullscreenDialogProps) {
  // Listener keyboard Escape sesuai Rule 4.17
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  // Cegah body scroll saat dialog terbuka
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`QR Code absensi: ${employeeName}`}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-white"
    >
      {/* Konten tengah */}
      <div className="flex flex-col items-center gap-4 p-6">
        {/* QR Code */}
        {/* biome-ignore lint/performance/noImgElement: QR Code base64 dinamis */}
        <img
          src={qrDataUrl}
          alt={`QR Code Absensi ${employeeName}`}
          className="w-full max-w-[80vmin] rounded-xl"
          draggable={false}
        />

        {/* Nama Karyawan */}
        <p className="text-center text-base font-black text-slate-900">
          {employeeName}
        </p>
        <p className="text-center text-xs text-slate-500">
          Arahkan scanner QR ke kode di atas
        </p>
      </div>

      {/* Tombol Tutup di pojok kanan atas */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Tutup tampilan penuh QR Code"
        className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-slate-900/10 text-slate-700 hover:bg-slate-900/20 active:scale-95 transition text-xl font-bold"
      >
        &times;
      </button>
    </div>
  );
}
