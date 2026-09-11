"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MobileAppShell } from "@/components/MobileAppShell";
import { Icon } from "@/components/ui/Icon";
import type { AttendancePhotoEntry } from "@/lib/attendance/photo-history";
import { canAccessArea, hasPermission } from "@/lib/auth/access";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import {
  deleteAttendancePhotoEntry,
  getAttendancePhotoImage,
  getAttendancePhotos,
  purgeAttendancePhotoEntries,
} from "@/lib/gateways/attendance-photo";

/** Batas umur foto yang dibersihkan — sama dengan halaman Web/Desktop. */
const PURGE_DAYS = 90;

const MESSAGE_STYLE = {
  success: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
  warning: "border-amber-400/25 bg-amber-400/10 text-amber-200",
  error: "border-rose-400/25 bg-rose-400/10 text-rose-200",
} as const;

/** Rentang cepat yang tersedia di layar sempit. */
const RANGES = [
  { label: "Hari ini", days: 0 },
  { label: "7 hari", days: 6 },
  { label: "30 hari", days: 29 },
] as const;

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * Stempel waktu ditulis SQLite sebagai "YYYY-MM-DD HH:MM:SS" tanpa zona.
 * Ditampilkan apa adanya: memformatnya lewat `new Date()` akan menggesernya ke
 * zona perangkat dan membuat bukti terlihat pada jam yang salah.
 */
function formatTimestamp(value: string) {
  if (!value) return "—";
  return value.replace("T", " ").slice(0, 19);
}

/**
 * Peninjauan foto bukti absensi di perangkat mobile.
 *
 * Foto TIDAK ikut snapshot sync (satu foto sekitar 40 KB), jadi daftar ini
 * dibaca langsung dari database cloud dan isi fotonya baru diunduh ketika
 * benar-benar dibuka — penting di jaringan seluler.
 */
export default function FotoAbsensiMobilePage() {
  // Penjaga anti klik ganda (Aturan 5). `useState` tidak cukup: pembaruannya
  // dijadwalkan, sehingga dua klik dalam satu tick React sama-sama membaca
  // nilai lama dan keduanya lolos. Dideklarasikan di ATAS, sebelum setiap
  // early return, supaya urutan hook tidak pernah berubah antar-render.
  const isSubmittingRef = useRef(false);

  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  const canView = canAccessArea(user, "attendance_photo");
  const canDelete = hasPermission(user, "attendance_photo.delete");

  const [entries, setEntries] = useState<AttendancePhotoEntry[]>([]);
  const [rangeDays, setRangeDays] = useState<number>(6);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: keyof typeof MESSAGE_STYLE;
    text: string;
  } | null>(null);
  const [preview, setPreview] = useState<{
    entry: AttendancePhotoEntry;
    src: string;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] =
    useState<AttendancePhotoEntry | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/login");
      return;
    }
    // Ditolak izin area: dipulangkan, sama seperti Project Meksa. Mobile
    // memakai static export dan tidak punya rute `/forbidden`.
    if (!authLoading && isAuthenticated && !canView) {
      router.replace("/dashboard");
    }
  }, [authLoading, isAuthenticated, canView, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(
        await getAttendancePhotos({
          tanggalMulai: isoDaysAgo(rangeDays),
          tanggalSelesai: isoDaysAgo(0),
        }),
      );
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "Daftar foto tidak dapat dimuat.",
      });
    } finally {
      setLoading(false);
    }
  }, [rangeDays]);

  useEffect(() => {
    if (authLoading || !isAuthenticated || !canView) return;
    void load();
  }, [authLoading, isAuthenticated, canView, load]);

  const openPhoto = async (entry: AttendancePhotoEntry) => {
    setBusy(true);
    triggerHaptic("light");
    try {
      const result = await getAttendancePhotoImage(entry.idFoto);
      setPreview({
        entry,
        src: `data:${result.mime};base64,${result.base64}`,
      });
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error ? error.message : "Foto tidak dapat dibuka.",
      });
    } finally {
      setBusy(false);
    }
  };

  const runDelete = async () => {
    if (isSubmittingRef.current) return;
    if (!confirmDelete) return;
    setBusy(true);
    isSubmittingRef.current = true;
    try {
      await deleteAttendancePhotoEntry(confirmDelete.idFoto);
      setMessage({
        tone: "success",
        text: `Foto bukti ${confirmDelete.nama} dihapus. Data absensinya tetap utuh.`,
      });
      setConfirmDelete(null);
      await load();
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error ? error.message : "Foto tidak dapat dihapus.",
      });
    } finally {
      isSubmittingRef.current = false;
      setBusy(false);
    }
  };

  /** Hapus massal foto lama. Baris absensi & log scan tidak tersentuh. */
  const runPurge = async () => {
    if (isSubmittingRef.current) return;
    setBusy(true);
    isSubmittingRef.current = true;
    try {
      const result = await purgeAttendancePhotoEntries(PURGE_DAYS);
      triggerHaptic(result.deleted > 0 ? "success" : "light");
      setPurgeOpen(false);
      setMessage({
        tone: result.deleted > 0 ? "success" : "warning",
        text:
          result.deleted > 0
            ? `${result.deleted} foto lama dibersihkan. Rekap kehadirannya tetap utuh.`
            : `Tidak ada foto yang lebih tua dari ${PURGE_DAYS} hari.`,
      });
      await load();
    } catch (error) {
      triggerHaptic("error");
      setMessage({
        tone: "error",
        text:
          error instanceof Error ? error.message : "Pembersihan foto gagal.",
      });
    } finally {
      isSubmittingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <MobileAppShell>
      <div className="flex flex-col gap-4 text-slate-100">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              triggerHaptic("light");
              router.push("/settings");
            }}
            aria-label="Kembali ke Pengaturan"
            className="grid size-9 place-items-center rounded-2xl bg-white/5 text-slate-300 transition hover:bg-white/10 active:scale-95"
          >
            <svg
              className="size-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-base font-black text-white">
              Foto Bukti Absensi
            </h1>
            <p className="truncate text-[11px] text-slate-400">
              {canView
                ? `${entries.length} foto ditampilkan`
                : "Akses dibatasi"}
            </p>
          </div>
        </div>

        {!canView ? (
          <div className="rounded-2xl border border-rose-400/25 bg-rose-400/10 p-4 text-xs font-semibold text-rose-200">
            Akun Anda tidak memiliki izin &quot;Lihat Foto Bukti Absensi&quot;.
            Minta admin menambahkan izin tersebut pada Role &amp; Akses.
          </div>
        ) : (
          <>
            {message ? (
              <button
                type="button"
                onClick={() => setMessage(null)}
                className={`rounded-2xl border p-3 text-left text-[11px] leading-4 ${MESSAGE_STYLE[message.tone]}`}
              >
                {message.text}
              </button>
            ) : null}

            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {RANGES.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    triggerHaptic("light");
                    setRangeDays(item.days);
                  }}
                  className={`shrink-0 rounded-xl border px-3 py-1.5 text-[11px] font-black transition active:scale-95 ${
                    rangeDays === item.days
                      ? "border-sky-400/40 bg-sky-500/20 text-sky-200"
                      : "border-white/10 bg-slate-900/70 text-slate-400"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {canDelete ? (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("warning");
                  setPurgeOpen(true);
                }}
                disabled={busy}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-rose-400/30 bg-rose-400/10 text-xs font-black text-rose-200 transition active:scale-95 disabled:opacity-50"
              >
                <Icon name="trash" className="size-4" />
                Bersihkan foto &gt; {PURGE_DAYS} hari
              </button>
            ) : null}

            {loading ? (
              <div className="grid min-h-40 place-items-center rounded-3xl border border-white/10 bg-slate-900/70 text-xs text-slate-400">
                Memuat foto bukti...
              </div>
            ) : entries.length === 0 ? (
              <div className="grid min-h-40 place-items-center rounded-3xl border border-white/10 bg-slate-900/70 p-5 text-center text-xs text-slate-400">
                Belum ada foto pada rentang ini. Foto terkumpul otomatis untuk
                role yang mewajibkan foto bukti absensi.
              </div>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {entries.map((entry) => (
                  <li
                    key={entry.idFoto}
                    className="rounded-3xl border border-white/10 bg-slate-900/70 p-3.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-white">
                          {entry.nama || entry.idKaryawan}
                        </p>
                        <p className="truncate font-mono text-[11px] text-slate-400">
                          {entry.idKaryawan}
                          {entry.divisi ? ` · ${entry.divisi}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full border border-white/10 bg-slate-950 px-2.5 py-1 text-[10px] font-bold text-slate-300">
                        {entry.jenisScan || "Scan"}
                      </span>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                      <div className="min-w-0">
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Waktu
                        </dt>
                        <dd className="truncate font-mono text-slate-200">
                          {formatTimestamp(entry.timestampScan)}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          IP perangkat
                        </dt>
                        <dd className="truncate font-mono text-slate-200">
                          {entry.ipPerangkat || "Tidak tercatat"}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void openPhoto(entry)}
                        disabled={busy}
                        className="min-h-10 flex-1 rounded-xl bg-sky-400/10 px-3 text-xs font-black text-sky-200 transition active:scale-95 disabled:opacity-50"
                      >
                        Lihat foto
                      </button>
                      {canDelete ? (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(entry)}
                          disabled={busy}
                          className="min-h-10 rounded-xl bg-rose-400/10 px-3 text-xs font-black text-rose-200 transition active:scale-95 disabled:opacity-50"
                        >
                          Hapus
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {preview ? (
        <dialog
          open
          aria-label="Pratinjau foto bukti absensi"
          onKeyDown={(event) => {
            if (event.key === "Escape") setPreview(null);
          }}
          className="fixed inset-0 z-50 m-0 flex size-full max-h-none max-w-none items-center justify-center bg-slate-950/90 p-4 backdrop-blur"
        >
          <div className="max-h-[88vh] w-full max-w-md overflow-y-auto overscroll-contain rounded-3xl border border-white/10 bg-slate-900 p-4 touch-pan-y">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="truncate text-sm font-black text-white">
                {preview.entry.nama || preview.entry.idKaryawan}
              </h2>
              <button
                type="button"
                onClick={() => setPreview(null)}
                aria-label="Tutup pratinjau"
                className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/10 text-slate-300"
              >
                ✕
              </button>
            </div>
            {/* Foto disimpan base64 di database cloud dan ditampilkan lewat data
                URI — tanpa permintaan jaringan keluar, sesuai batasan CSP. */}
            {/** biome-ignore lint/performance/noImgElement: sumbernya data URI dari database, bukan aset yang bisa dioptimalkan next/image */}
            <img
              src={preview.src}
              alt={`Bukti absensi ${preview.entry.nama}`}
              className="w-full rounded-2xl border border-white/10"
            />
            <dl className="mt-3 grid gap-2 rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-[11px]">
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Waktu scan
                </dt>
                <dd className="font-mono text-slate-200">
                  {formatTimestamp(preview.entry.timestampScan)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  IP perangkat
                </dt>
                <dd className="font-mono text-slate-200">
                  {preview.entry.ipPerangkat || "Tidak tercatat"}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Operator
                </dt>
                <dd className="font-mono text-slate-200">
                  {preview.entry.kodeOperator || "—"}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="mt-3 w-full rounded-xl border border-white/15 py-2.5 text-xs font-bold text-slate-300"
            >
              Tutup
            </button>
          </div>
        </dialog>
      ) : null}

      {confirmDelete ? (
        <dialog
          open
          aria-label="Konfirmasi hapus foto bukti"
          onKeyDown={(event) => {
            if (event.key === "Escape") setConfirmDelete(null);
          }}
          className="fixed inset-0 z-50 m-0 flex size-full max-h-none max-w-none items-center justify-center bg-slate-950/90 p-4 backdrop-blur"
        >
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900 p-4">
            <h2 className="text-sm font-black text-white">Hapus foto bukti</h2>
            <p className="mt-2 text-xs leading-5 text-slate-300">
              Foto milik {confirmDelete.nama} pada{" "}
              {formatTimestamp(confirmDelete.timestampScan)} dihapus permanen.
              Baris absensi dan log scannya tetap ada.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => void runDelete()}
                disabled={busy}
                className="min-h-11 flex-1 rounded-xl bg-rose-500 text-xs font-black text-slate-950 disabled:opacity-60"
              >
                {busy ? "Menghapus..." : "Hapus"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="min-h-11 flex-1 rounded-xl border border-white/15 text-xs font-bold text-slate-300"
              >
                Batal
              </button>
            </div>
          </div>
        </dialog>
      ) : null}

      {purgeOpen ? (
        <dialog
          open
          aria-label="Konfirmasi bersihkan foto lama"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !busy) setPurgeOpen(false);
          }}
          className="fixed inset-0 z-50 m-0 flex size-full max-h-none max-w-none items-center justify-center bg-slate-950/90 p-4 backdrop-blur"
        >
          <div className="w-full max-w-sm rounded-3xl border border-rose-400/25 bg-slate-900 p-4">
            <h2 className="text-sm font-black text-white">
              Bersihkan foto lama
            </h2>
            <p className="mt-2 text-xs leading-5 text-slate-300">
              Seluruh foto bukti yang tanggal kerjanya lebih dari {PURGE_DAYS}{" "}
              hari lalu dihapus permanen dari database cloud dan perangkat ini.
            </p>
            <p className="mt-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-2.5 text-[11px] leading-4 text-emerald-200">
              Yang TETAP ada: rekap kehadiran, riwayat, log scan, dan laporan.
              Yang hilang hanya bukti visualnya.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setPurgeOpen(false)}
                disabled={busy}
                className="min-h-11 flex-1 rounded-xl border border-white/15 text-xs font-bold text-slate-300 disabled:opacity-60"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void runPurge()}
                disabled={busy}
                className="min-h-11 flex-1 rounded-xl bg-rose-500 text-xs font-black text-slate-950 disabled:opacity-60"
              >
                {busy ? "Membersihkan..." : `Bersihkan > ${PURGE_DAYS} hari`}
              </button>
            </div>
          </div>
        </dialog>
      ) : null}
    </MobileAppShell>
  );
}
