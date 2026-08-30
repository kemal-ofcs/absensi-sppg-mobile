"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { MobileAppShell } from "@/components/MobileAppShell";
import { Icon } from "@/components/ui/Icon";
import { canAccessArea, hasPermission } from "@/lib/auth/access";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import {
  deletePasswordResetHistory,
  getPasswordResetHistory,
  getPasswordResetPhoto,
} from "@/lib/gateways/password-reset-history";
import {
  RESET_HISTORY_STATUS_HINT,
  RESET_HISTORY_STATUSES,
  type ResetHistoryEntry,
  type ResetHistoryStatus,
} from "@/lib/operators/password-reset-history";

type StatusFilter = ResetHistoryStatus | "SEMUA";

const STATUS_STYLE: Record<ResetHistoryStatus, string> = {
  "Menunggu Verifikasi": "border-amber-300/30 bg-amber-300/10 text-amber-200",
  Terkirim: "border-sky-400/30 bg-sky-400/10 text-sky-200",
  Terpakai: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  Kedaluwarsa: "border-slate-700 bg-slate-900/80 text-slate-300",
  Dibatalkan: "border-rose-400/30 bg-rose-400/10 text-rose-200",
};

const FILTERS: StatusFilter[] = ["SEMUA", ...RESET_HISTORY_STATUSES];

/**
 * Stempel waktu ditulis SQLite dalam UTC ("2026-08-29 10:15:00"). `new Date()`
 * memperlakukan bentuk itu sebagai waktu lokal, jadi penanda `Z` ditambahkan
 * dulu sebelum diformat ke zona pengguna.
 */
function formatTimestamp(value: string) {
  if (!value) return "—";
  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatScore(score: number | null) {
  return score == null ? "Tidak dinilai" : `${Math.round(score * 100)}%`;
}

export default function RiwayatResetPasswordMobilePage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  const canView = canAccessArea(user, "password_reset");
  const canDelete = hasPermission(user, "password_reset.delete");

  const [entries, setEntries] = useState<ResetHistoryEntry[]>([]);
  const [status, setStatus] = useState<StatusFilter>("SEMUA");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [photo, setPhoto] = useState<{
    entry: ResetHistoryEntry;
    src: string;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ResetHistoryEntry | null>(
    null,
  );

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.replace("/login");
  }, [authLoading, isAuthenticated, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await getPasswordResetHistory({ status }));
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "Riwayat tidak dapat dimuat.",
      });
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    if (authLoading || !isAuthenticated || !canView) return;
    void load();
  }, [authLoading, isAuthenticated, canView, load]);

  const openPhoto = async (entry: ResetHistoryEntry) => {
    setBusy(true);
    triggerHaptic("light");
    try {
      const result = await getPasswordResetPhoto(entry.id);
      setPhoto({ entry, src: `data:${result.mime};base64,${result.base64}` });
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
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await deletePasswordResetHistory(confirmDelete.id);
      setMessage({
        tone: "success",
        text: `Riwayat ${confirmDelete.operatorName} dihapus.`,
      });
      setConfirmDelete(null);
      await load();
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "Riwayat tidak dapat dihapus.",
      });
    } finally {
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
              Riwayat Reset Password
            </h1>
            <p className="truncate text-[11px] text-slate-400">
              {canView
                ? `${entries.length} pengajuan ditampilkan`
                : "Akses dibatasi"}
            </p>
          </div>
        </div>

        {!canView ? (
          <div className="rounded-2xl border border-rose-400/25 bg-rose-400/10 p-4 text-xs font-semibold text-rose-200">
            Akun Anda tidak memiliki izin &quot;Lihat Riwayat Reset
            Password&quot;. Minta admin menambahkan izin tersebut pada Role
            &amp; Akses.
          </div>
        ) : (
          <>
            {message ? (
              <button
                type="button"
                onClick={() => setMessage(null)}
                className={`rounded-2xl border p-3 text-left text-[11px] leading-4 ${
                  message.tone === "success"
                    ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
                    : "border-rose-400/25 bg-rose-400/10 text-rose-200"
                }`}
              >
                {message.text}
              </button>
            ) : null}

            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {FILTERS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    triggerHaptic("light");
                    setStatus(item);
                  }}
                  className={`shrink-0 rounded-xl border px-3 py-1.5 text-[11px] font-black transition active:scale-95 ${
                    status === item
                      ? "border-violet-400/40 bg-violet-500/20 text-violet-200"
                      : "border-white/10 bg-slate-900/70 text-slate-400"
                  }`}
                >
                  {item === "SEMUA" ? "Semua" : item}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="grid min-h-40 place-items-center rounded-3xl border border-white/10 bg-slate-900/70 text-xs text-slate-400">
                Memuat riwayat...
              </div>
            ) : entries.length === 0 ? (
              <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 text-center">
                <p className="text-sm font-bold text-white">
                  Belum ada pengajuan
                </p>
                <p className="mt-1 text-[11px] leading-4 text-slate-400">
                  Riwayat terisi begitu ada operator yang memakai tombol Lupa
                  Password di halaman login.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-3xl border border-violet-500/20 bg-gradient-to-br from-violet-950/25 via-slate-900/80 to-slate-900/90 p-4 backdrop-blur-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-white">
                          {entry.operatorName}
                        </p>
                        <p className="truncate text-[11px] text-slate-400">
                          {entry.kodeOperator} · @{entry.username}
                        </p>
                        <p className="truncate text-[11px] text-slate-500">
                          {entry.maskedEmail}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${STATUS_STYLE[entry.status]}`}
                      >
                        {entry.status}
                      </span>
                    </div>

                    <p className="mt-2 text-[11px] leading-4 text-slate-400">
                      {RESET_HISTORY_STATUS_HINT[entry.status]}
                    </p>

                    <dl className="mt-3 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-[11px]">
                      <div className="min-w-0">
                        <dt className="text-slate-500">Diajukan</dt>
                        <dd className="truncate font-bold text-slate-200">
                          {formatTimestamp(entry.requestedAt)}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-slate-500">Skor liveness</dt>
                        <dd className="truncate font-bold text-slate-200">
                          {formatScore(entry.livenessScore)}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-slate-500">Diketik</dt>
                        <dd className="truncate font-bold text-slate-200">
                          {entry.identifierUsed || "—"}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-slate-500">Pengiriman</dt>
                        <dd className="truncate font-bold text-slate-200">
                          {entry.deliveryStatus || "Belum dikirim"}
                        </dd>
                      </div>
                    </dl>

                    {entry.deliveryError ? (
                      <p className="mt-2 rounded-2xl border border-rose-400/25 bg-rose-400/10 p-2.5 text-[11px] leading-4 text-rose-200">
                        {entry.deliveryError}
                      </p>
                    ) : null}

                    <div className="mt-3 flex gap-2">
                      {entry.hasPhoto ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void openPhoto(entry)}
                          className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-violet-500 px-3 text-xs font-black text-white shadow-md transition hover:bg-violet-400 active:scale-95 disabled:opacity-50"
                        >
                          <Icon name="user" className="size-4" />
                          Lihat Foto
                        </button>
                      ) : (
                        <span className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-white/10 px-3 text-xs font-bold text-slate-500">
                          Tanpa foto
                        </span>
                      )}
                      {canDelete ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            triggerHaptic("warning");
                            setConfirmDelete(entry);
                          }}
                          className="min-h-11 rounded-xl border border-rose-400/30 px-3 text-xs font-black text-rose-200 transition active:scale-95 disabled:opacity-50"
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

      {photo ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/90 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-3 rounded-3xl border border-white/15 bg-slate-900 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-white">
                  {photo.entry.operatorName}
                </p>
                <p className="truncate text-[11px] text-slate-400">
                  {formatTimestamp(photo.entry.requestedAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPhoto(null)}
                aria-label="Tutup foto"
                className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/5 text-slate-300 active:scale-95"
              >
                ✕
              </button>
            </div>
            {/* Foto tersimpan base64 di database cloud dan ditampilkan lewat
                data URI — tidak ada permintaan jaringan keluar, sesuai batasan
                CSP aplikasi Tauri. */}
            {/** biome-ignore lint/performance/noImgElement: sumbernya data URI dari database, bukan aset yang bisa dioptimalkan next/image */}
            <img
              src={photo.src}
              alt={`Wajah pemohon reset password ${photo.entry.operatorName}`}
              className="w-full rounded-2xl border border-white/10"
            />
            <p className="text-[10px] leading-4 text-slate-500">
              Verifikasi liveness menahan foto cetak dan layar diam, bukan
              rekaman video orang lain. Periksa juga kewajaran waktu dan
              identitas yang diketik.
            </p>
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/90 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-3 rounded-3xl border border-white/15 bg-slate-900 p-4">
            <p className="text-sm font-black text-white">Hapus riwayat ini?</p>
            <p className="text-[11px] leading-4 text-slate-400">
              Riwayat pengajuan {confirmDelete.operatorName} beserta foto
              verifikasinya dihapus permanen.
              {confirmDelete.status === "Terkirim"
                ? " Pengajuan ini masih hidup — link resetnya ikut mati dan pemiliknya perlu mengajukan ulang."
                : ""}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="min-h-11 flex-1 rounded-xl border border-white/15 px-3 text-xs font-bold text-slate-300 active:scale-95"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runDelete()}
                className="min-h-11 flex-1 rounded-xl bg-rose-500 px-3 text-xs font-black text-white active:scale-95 disabled:opacity-50"
              >
                {busy ? "Menghapus..." : "Hapus"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </MobileAppShell>
  );
}
