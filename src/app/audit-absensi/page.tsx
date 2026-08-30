"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MobileAppShell } from "@/components/MobileAppShell";
import { Icon } from "@/components/ui/Icon";
import { canAccessArea } from "@/lib/auth/access";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import {
  getAuditKualitasAbsensi,
  type HasilAuditAbsensi,
  type KeparahanTemuan,
} from "@/lib/gateways/attendance-audit";

type FilterKeparahan = "semua" | KeparahanTemuan;

const KEPARAHAN_STYLE: Record<KeparahanTemuan, string> = {
  tinggi: "border-rose-400/30 bg-rose-400/10 text-rose-200",
  sedang: "border-amber-300/30 bg-amber-300/10 text-amber-200",
  rendah: "border-sky-400/30 bg-sky-400/10 text-sky-200",
  info: "border-slate-700 bg-slate-900/80 text-slate-300",
};

const KEPARAHAN_LABEL: Record<KeparahanTemuan, string> = {
  tinggi: "Perlu Tindakan",
  sedang: "Perlu Dicek",
  rendah: "Catatan",
  info: "Informasi",
};

const FILTER_OPTIONS: Array<{ value: FilterKeparahan; label: string }> = [
  { value: "semua", label: "Semua" },
  { value: "tinggi", label: "Tindakan" },
  { value: "sedang", label: "Dicek" },
  { value: "rendah", label: "Catatan" },
  { value: "info", label: "Info" },
];

function formatTanggalPanjang(value: string) {
  if (!value) return "-";
  try {
    const [y, m, d] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(y, m - 1, d));
  } catch {
    return value;
  }
}

function skorTone(skor: number) {
  if (skor >= 90) return "text-emerald-400";
  if (skor >= 70) return "text-amber-400";
  return "text-rose-400";
}

function StatTile({
  label,
  value,
  tone = "text-white",
}: {
  label: string;
  value: number | string;
  tone?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className={`mt-0.5 text-xl font-black ${tone}`}>{value}</div>
    </div>
  );
}

export default function AuditAbsensiMobilePage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const canView = canAccessArea(user, "audit");

  const [tanggal, setTanggal] = useState("");
  const [audit, setAudit] = useState<HasilAuditAbsensi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKeparahan>("semua");

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [authLoading, isAuthenticated, router]);

  const loadData = useCallback(async (targetTanggal?: string) => {
    setLoading(true);
    try {
      const hasil = await getAuditKualitasAbsensi(targetTanggal || undefined);
      setAudit(hasil);
      // Server yang memutuskan tanggal default (zona operasional).
      setTanggal((current) => current || hasil.tanggal);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Gagal memuat audit kualitas absensi.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !isAuthenticated || !canView) return;
    void loadData();
  }, [authLoading, isAuthenticated, canView, loadData]);

  const temuanTampil = useMemo(() => {
    if (!audit) return [];
    if (filter === "semua") return audit.temuan;
    return audit.temuan.filter((item) => item.keparahan === filter);
  }, [audit, filter]);

  const ringkasan = audit?.ringkasan;

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
              Audit Kualitas Absensi
            </h1>
            <p className="truncate text-[11px] text-slate-400">
              {audit ? formatTanggalPanjang(audit.tanggal) : "Memuat..."}
            </p>
          </div>
        </div>

        {!canView ? (
          <div className="rounded-2xl border border-rose-400/25 bg-rose-400/10 p-4 text-xs font-semibold text-rose-200">
            Akun Anda tidak memiliki izin &quot;Lihat audit absensi&quot;. Minta
            admin menambahkan izin tersebut pada Role &amp; Akses.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="audit-tanggal">
                Tanggal kerja yang diaudit
              </label>
              <input
                id="audit-tanggal"
                type="date"
                value={tanggal}
                onChange={(event) => {
                  setTanggal(event.target.value);
                  void loadData(event.target.value);
                }}
                className="min-h-10 flex-1 rounded-2xl border border-slate-800 bg-slate-950 px-3 text-sm text-white outline-none focus:border-amber-500"
              />
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("light");
                  void loadData(tanggal);
                }}
                disabled={loading}
                aria-label="Muat ulang audit"
                className="grid size-10 place-items-center rounded-2xl bg-sky-500 text-white shadow-md transition active:scale-95 disabled:opacity-50"
              >
                <Icon
                  name="refresh"
                  className={`size-4 ${loading ? "animate-spin" : ""}`}
                />
              </button>
            </div>

            {error ? (
              <div className="rounded-2xl border border-rose-400/25 bg-rose-400/10 p-3 text-xs font-semibold text-rose-200">
                {error}
              </div>
            ) : null}

            {loading && !audit ? (
              <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-xs text-slate-400">
                <Icon
                  name="clock"
                  className="size-4 animate-spin text-sky-400"
                />
                Menghitung kualitas absensi...
              </div>
            ) : null}

            {audit && ringkasan ? (
              <>
                {audit.hariLibur ? (
                  <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 p-3 text-xs font-semibold text-amber-100">
                    {audit.hariLibur} — hari libur aktif, tidak ada karyawan
                    yang dinilai wajib absen.
                  </div>
                ) : null}

                <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-900/40 p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Skor Kualitas
                  </div>
                  <div
                    className={`text-4xl font-black ${skorTone(ringkasan.skorKualitas)}`}
                  >
                    {ringkasan.skorKualitas}%
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {ringkasan.wajibAbsen - ringkasan.karyawanBermasalah} dari{" "}
                    {ringkasan.wajibAbsen} karyawan wajib absen tanpa temuan
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <StatTile
                    label="Belum Scan Masuk"
                    value={ringkasan.belumScanMasuk}
                    tone="text-rose-400"
                  />
                  <StatTile
                    label="Belum Scan Pulang"
                    value={ringkasan.belumScanPulang}
                    tone="text-amber-400"
                  />
                  <StatTile
                    label="Perlu Verifikasi"
                    value={ringkasan.perluVerifikasi}
                    tone="text-amber-400"
                  />
                  <StatTile
                    label="Scan Ditolak"
                    value={ringkasan.scanDitolak}
                    tone="text-amber-400"
                  />
                  <StatTile
                    label="Alfa"
                    value={ringkasan.alfa}
                    tone="text-rose-400"
                  />
                  <StatTile
                    label="Hadir"
                    value={ringkasan.hadir}
                    tone="text-emerald-400"
                  />
                  <StatTile label="Terlambat" value={ringkasan.terlambat} />
                  <StatTile
                    label="Jam Kerja Kurang"
                    value={ringkasan.jamKerjaKurang}
                  />
                </div>

                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {FILTER_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        triggerHaptic("light");
                        setFilter(option.value);
                      }}
                      className={`min-h-8 shrink-0 rounded-xl border px-3 text-[11px] font-bold transition ${
                        filter === option.value
                          ? "border-sky-400/40 bg-sky-500/20 text-sky-200"
                          : "border-slate-800 bg-slate-950 text-slate-400"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="space-y-2">
                  <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Temuan ({temuanTampil.length})
                  </h2>
                  {temuanTampil.length === 0 ? (
                    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-center text-xs text-emerald-200">
                      <Icon name="check" className="mx-auto mb-1.5 size-5" />
                      {audit.temuan.length === 0
                        ? "Tidak ada temuan. Data absensi tanggal ini bersih."
                        : "Tidak ada temuan pada filter ini."}
                    </div>
                  ) : (
                    temuanTampil.map((item) => (
                      <div
                        key={`${item.idKaryawan}-${item.kategori}`}
                        className="rounded-2xl border border-white/10 bg-slate-950/60 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-white">
                              {item.nama}
                            </div>
                            <div className="truncate text-[10px] text-slate-500">
                              {item.idKaryawan} &middot; {item.divisi}
                            </div>
                          </div>
                          <span
                            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${KEPARAHAN_STYLE[item.keparahan]}`}
                          >
                            {item.kategori}
                          </span>
                        </div>
                        <p className="mt-2 text-[11px] leading-4 text-slate-300">
                          {item.detail}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
                          <span className="font-mono">
                            {item.jamMasuk || "--:--"} /{" "}
                            {item.jamPulang || "--:--"}
                          </span>
                          <span>{item.jamShift}</span>
                          {item.sumber ? <span>{item.sumber}</span> : null}
                          <span>{KEPARAHAN_LABEL[item.keparahan]}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
    </MobileAppShell>
  );
}
