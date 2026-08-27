import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { downloadDataUrl } from "@/lib/client/download";
import { triggerHaptic } from "@/lib/client/haptics";
import { shareDataUrl } from "@/lib/client/share";

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
 * Dilengkapi tombol "Bagikan" dan "Simpan" QR Code untuk kemudahan operasional.
 * Latar putih bersih memberikan kontras optimal untuk pemindaian scanner hardware/kamera.
 */
export function QrFullscreenDialog({
  qrDataUrl,
  employeeName,
  isOpen,
  onClose,
}: QrFullscreenDialogProps) {
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

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

  const cleanFilename = `QR-Absensi-${employeeName.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;

  const handleDownload = async () => {
    try {
      const res = await downloadDataUrl(qrDataUrl, cleanFilename);
      triggerHaptic("success");
      setSaveStatus(
        res.path ? `Tersimpan di ${res.path}` : "Tersimpan di Download!",
      );
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      triggerHaptic("error");
      setSaveStatus(err instanceof Error ? err.message : "Gagal Menyimpan");
      setTimeout(() => setSaveStatus(null), 3000);
    }
  };

  const handleShare = async () => {
    setSharing(true);
    try {
      const title = `QR Code Absensi - ${employeeName}`;
      const text = `QR Code Absensi SPPG untuk ${employeeName}`;
      const res = await shareDataUrl(qrDataUrl, cleanFilename, title, text);
      if (res.sukses) {
        triggerHaptic("success");
        setSaveStatus(res.message || "Berhasil Membagikan");
        setTimeout(() => setSaveStatus(null), 3000);
      } else if (!res.cancelled) {
        triggerHaptic("error");
        setSaveStatus(res.message || "Gagal Membagikan");
        setTimeout(() => setSaveStatus(null), 3000);
      }
    } catch (err) {
      triggerHaptic("error");
      setSaveStatus(err instanceof Error ? err.message : "Gagal Membagikan");
      setTimeout(() => setSaveStatus(null), 3000);
    } finally {
      setSharing(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`QR Code absensi: ${employeeName}`}
      className="theme-invariant fixed inset-0 z-[100] flex flex-col justify-between bg-white text-slate-900"
    >
      {/* Header: Tombol Tutup */}
      <div className="flex items-center justify-between p-4 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="size-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            QR Code Absensi
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup tampilan penuh QR Code"
          className="grid size-10 place-items-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 active:scale-95 transition text-xl font-bold"
        >
          &times;
        </button>
      </div>

      {/* Konten Tengah: Gambar QR Code + Info Karyawan */}
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        {/* QR Code Frame */}
        <div className="rounded-3xl bg-slate-50 p-4 shadow-xl border border-slate-200/80">
          {/* biome-ignore lint/performance/noImgElement: QR Code base64 dinamis */}
          <img
            src={qrDataUrl}
            alt={`QR Code Absensi ${employeeName}`}
            className="w-full max-w-[72vmin] rounded-2xl object-contain pointer-events-auto"
            style={{ WebkitTouchCallout: "default" }}
          />
        </div>

        {/* Nama Karyawan & Petunjuk */}
        <div className="text-center">
          <p className="text-lg font-black text-slate-900 tracking-tight">
            {employeeName}
          </p>
          <p className="text-xs font-medium text-slate-500 mt-1">
            Gunakan tombol <b>Bagikan QR</b> untuk membagikan ke WhatsApp
            <br />
            atau tombol <b>Simpan Berkas</b> untuk mengunduh gambar.
          </p>
        </div>
      </div>

      {/* Footer: Action Buttons (Bagikan & Simpan) */}
      <div className="flex items-center gap-3 p-4 bg-slate-50 border-t border-slate-200/80">
        {/* Tombol Bagikan */}
        <button
          type="button"
          disabled={sharing}
          onClick={() => void handleShare()}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-sky-500 py-3.5 px-4 text-xs font-black text-slate-950 shadow-md hover:bg-sky-400 active:scale-95 transition disabled:opacity-50"
        >
          <Icon name="share" className="size-4" />
          {sharing ? "Membagikan..." : "Bagikan QR"}
        </button>

        {/* Tombol Simpan */}
        <button
          type="button"
          onClick={() => void handleDownload()}
          className={`flex flex-1 items-center justify-center gap-2 rounded-2xl border py-3.5 px-4 text-xs font-black transition active:scale-95 ${
            saveStatus
              ? "border-emerald-500/40 bg-emerald-50 text-emerald-700 shadow-sm"
              : "border-slate-300 bg-white text-slate-800 hover:bg-slate-100 shadow-sm"
          }`}
        >
          <Icon name={saveStatus ? "check" : "download"} className="size-4" />
          {saveStatus ? saveStatus : "Simpan Berkas"}
        </button>
      </div>
    </div>
  );
}
