"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { triggerHaptic } from "@/lib/client/haptics";
import {
  getRekapBulanan,
  getTopKaryawanTerajin,
  type RekapBulananItem,
} from "@/lib/gateways/report";
import { useDebounce } from "@/lib/hooks/useDebounce";

/*
 * Rekap bulanan & papan peringkat untuk Dasbor Mobile — padanan tab
 * "Rekap Bulanan" dan "Papan Peringkat" di `web-desktop/src/app/dashboard`.
 *
 * Sengaja 2D: podium 3D Web tidak dibawa ke sini (satu konteks WebGL per
 * aplikasi, dan perangkat Android kelas menengah). Datanya sama persis —
 * `desktop_get_dashboard_data` jenis `monthly` dan `top` dari SQLite lokal,
 * jadi bagian ini tetap berfungsi tanpa jaringan.
 */

type Tab = "bulanan" | "peringkat";
type SortKey = "nama" | "hadir" | "telat" | "jam";

/** Kartu dirender bertahap: satu institusi bisa punya ratusan karyawan. */
const PAGE_SIZE = 20;
const TOP_LIMIT = 10;

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "nama", label: "Nama (A-Z)" },
  { value: "hadir", label: "Hadir terbanyak" },
  { value: "telat", label: "Telat terbanyak" },
  { value: "jam", label: "Jam kerja terbanyak" },
];

const MEDALS = ["🥇", "🥈", "🥉"];

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function DashboardInsights() {
  const [tab, setTab] = useState<Tab>("bulanan");
  const [monthly, setMonthly] = useState<RekapBulananItem[]>([]);
  const [top, setTop] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [sortKey, setSortKey] = useState<SortKey>("nama");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [monthlyData, topData] = await Promise.all([
        getRekapBulanan(),
        getTopKaryawanTerajin(TOP_LIMIT),
      ]);
      setMonthly(monthlyData ?? []);
      setTop(topData ?? []);
      setError(null);
    } catch (err) {
      // Kegagalan WAJIB terlihat: rekap kosong tidak bisa dibedakan dari
      // bulan yang memang belum punya absensi.
      if (!silent) {
        setError(
          err instanceof Error
            ? err.message
            : "Rekap bulanan gagal dimuat. Tarik ke bawah untuk mencoba lagi.",
        );
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onSyncCompleted = () => {
      void load(true);
    };
    window.addEventListener("sppg:sync-completed", onSyncCompleted);
    return () => {
      window.removeEventListener("sppg:sync-completed", onSyncCompleted);
    };
  }, [load]);

  const monthLabel = useMemo(
    () =>
      new Date().toLocaleDateString("id-ID", {
        month: "long",
        year: "numeric",
      }),
    [],
  );

  const summary = useMemo(
    () =>
      monthly.reduce(
        (acc, row) => ({
          hadir: acc.hadir + num(row.totalHadir),
          telat: acc.telat + num(row.frekuensiTelat),
          izinSakit:
            acc.izinSakit +
            num(row.totalSakit) +
            num(row.totalIzin) +
            num(row.totalDispen),
          alfa: acc.alfa + num(row.totalAlfa),
        }),
        { hadir: 0, telat: 0, izinSakit: 0, alfa: 0 },
      ),
    [monthly],
  );

  const filteredMonthly = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    const list = term
      ? monthly.filter((row) =>
          [row.nama, row.idKaryawan, row.divisi]
            .join(" ")
            .toLowerCase()
            .includes(term),
        )
      : [...monthly];
    list.sort((a, b) => {
      if (sortKey === "hadir") return num(b.totalHadir) - num(a.totalHadir);
      if (sortKey === "telat")
        return num(b.totalTerlambat) - num(a.totalTerlambat);
      if (sortKey === "jam") return num(b.totalJamKerja) - num(a.totalJamKerja);
      return String(a.nama ?? "").localeCompare(String(b.nama ?? ""), "id-ID");
    });
    return list;
  }, [monthly, debouncedSearch, sortKey]);

  const switchTab = (next: Tab) => {
    triggerHaptic("light");
    setTab(next);
  };

  return (
    <section className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-slate-900/70 p-3.5">
      <div className="grid grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-slate-950/80 p-1">
        {(
          [
            ["bulanan", "Rekap Bulan Ini"],
            ["peringkat", "Peringkat Terajin"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => switchTab(value)}
            className={`min-h-11 rounded-xl px-2 text-xs font-bold transition active:scale-95 ${
              tab === value
                ? "bg-sky-500 text-slate-950 shadow-md"
                : "text-slate-400 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-400/10 p-3 text-xs text-rose-200">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-2xl border border-white/5 bg-slate-950/40"
            />
          ))}
        </div>
      ) : tab === "bulanan" ? (
        <>
          <p className="px-1 text-[11px] text-slate-400">
            Akumulasi per karyawan untuk{" "}
            <strong className="text-slate-200">{monthLabel}</strong>.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <SummaryTile
              label="Hari hadir"
              value={summary.hadir}
              tone="text-emerald-400"
            />
            <SummaryTile
              label="Kali terlambat"
              value={summary.telat}
              tone="text-amber-400"
            />
            <SummaryTile
              label="Izin / Sakit / Dispen"
              value={summary.izinSakit}
              tone="text-blue-400"
            />
            <SummaryTile
              label="Alfa"
              value={summary.alfa}
              tone="text-rose-400"
            />
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              type="text"
              value={search}
              onChange={(event) => {
                // Filter berubah → mulai lagi dari halaman pertama.
                setSearch(event.target.value);
                setVisible(PAGE_SIZE);
              }}
              placeholder="Cari nama, ID, divisi..."
              aria-label="Cari rekap bulanan karyawan"
              className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 text-xs text-white placeholder-slate-500 outline-none focus:border-sky-400"
            />
            <select
              value={sortKey}
              onChange={(event) => {
                setSortKey(event.target.value as SortKey);
                setVisible(PAGE_SIZE);
              }}
              aria-label="Urutkan rekap bulanan"
              className="min-h-11 rounded-xl border border-white/10 bg-slate-950/80 px-2 text-xs text-slate-200 outline-none focus:border-sky-400"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {filteredMonthly.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-6 text-center text-xs text-slate-500">
              {monthly.length === 0
                ? "Belum ada absensi tercatat pada bulan ini."
                : "Tidak ada karyawan yang cocok dengan pencarian."}
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {filteredMonthly.slice(0, visible).map((row) => (
                <li
                  key={row.idKaryawan}
                  className="rounded-2xl border border-white/10 bg-slate-950/50 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white">
                        {row.nama}
                      </p>
                      <p className="truncate text-[11px] text-slate-400">
                        {row.divisi || "-"} • ID: {row.idKaryawan}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                      {num(row.totalHadir)} hari hadir
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-1.5 text-center text-[10px]">
                    <Stat
                      label="Telat"
                      value={`${num(row.totalTerlambat)} mnt`}
                      hint={`${num(row.frekuensiTelat)}x`}
                      tone="text-amber-300"
                    />
                    <Stat
                      label="Jam kerja"
                      value={`${num(row.totalJamKerja)} j`}
                      hint={`Lembur ${num(row.totalLembur)} j`}
                      tone="text-slate-200"
                    />
                    <Stat
                      label="S / I / D / A"
                      value={`${num(row.totalSakit)}/${num(row.totalIzin)}/${num(row.totalDispen)}/${num(row.totalAlfa)}`}
                      tone={
                        num(row.totalAlfa) > 0
                          ? "text-rose-300"
                          : "text-slate-200"
                      }
                    />
                  </dl>
                </li>
              ))}
            </ul>
          )}

          {filteredMonthly.length > visible ? (
            <button
              type="button"
              onClick={() => {
                triggerHaptic("light");
                setVisible((current) => current + PAGE_SIZE);
              }}
              className="min-h-11 w-full rounded-xl border border-white/10 bg-white/5 text-xs font-bold text-sky-300 transition active:scale-95"
            >
              Tampilkan {Math.min(PAGE_SIZE, filteredMonthly.length - visible)}{" "}
              lagi ({visible} dari {filteredMonthly.length})
            </button>
          ) : null}
        </>
      ) : (
        <>
          <p className="px-1 text-[11px] text-slate-400">
            {TOP_LIMIT} karyawan dengan hari hadir terbanyak dari seluruh
            riwayat; bila seri, yang total terlambatnya paling sedikit lebih
            dulu.
          </p>
          {top.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-6 text-center text-xs text-slate-500">
              Belum ada data kehadiran untuk dijadikan peringkat.
            </div>
          ) : (
            <ol className="flex flex-col gap-2">
              {top.map((item, index) => {
                const telat = num(item.total_telat);
                return (
                  <li
                    key={String(item.id_karyawan ?? index)}
                    className={`flex items-center gap-3 rounded-2xl border p-3 ${
                      index === 0
                        ? "border-amber-400/40 bg-amber-400/10"
                        : "border-white/10 bg-slate-950/50"
                    }`}
                  >
                    <span
                      className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/5 text-base font-black text-slate-200"
                      role="img"
                      aria-label={`Peringkat ${index + 1}`}
                    >
                      {MEDALS[index] ?? index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-white">
                        {String(item.nama ?? "-")}
                      </p>
                      <p className="truncate text-[11px] text-slate-400">
                        {String(item.divisi || "-")} • ID:{" "}
                        {String(item.id_karyawan ?? "-")}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-black text-sky-300">
                        {num(item.total_kehadiran)} hari
                      </p>
                      <p
                        className={`text-[10px] font-bold ${
                          telat > 0 ? "text-amber-400" : "text-emerald-400"
                        }`}
                      >
                        {telat > 0 ? `telat ${telat} mnt` : "tak pernah telat"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}

      <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-500">
        <Icon name="database" className="size-3" />
        Dari data lokal perangkat — tarik ke bawah untuk sinkron terbaru.
      </div>
    </section>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-3">
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <span className={`text-xl font-black ${tone}`}>{value}</span>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: string;
}) {
  return (
    <div className="rounded-xl bg-white/5 px-1.5 py-1.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`font-mono font-bold ${tone}`}>{value}</dd>
      {hint ? <dd className="text-slate-500">{hint}</dd> : null}
    </div>
  );
}
