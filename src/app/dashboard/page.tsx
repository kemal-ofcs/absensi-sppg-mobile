"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DashboardInsights } from "@/components/dashboard/DashboardInsights";
import { MobileAppShell } from "@/components/MobileAppShell";
import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { canAccessArea, hasPermission } from "@/lib/auth/access";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import {
  type DashboardMetrics,
  getDashboardMetrics,
  getRiwayatScan,
} from "@/lib/gateways/report";
import { useClock } from "@/lib/hooks/useClock";

export default function DashboardPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const clock = useClock();

  const canViewMetrics = hasPermission(user, "dashboard.view");
  // Riwayat scan terbaru dijaga `home.view` di backend. Tanpa izin itu
  // bagiannya disembunyikan, bukan dimuat lalu gagal menjadi pesan error.
  const canViewRecentScans = canAccessArea(user, "home");
  const canViewHistory = canAccessArea(user, "history");
  const canViewKaryawan = canAccessArea(user, "karyawan");

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [recentScans, setRecentScans] = useState<Record<string, unknown>[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      try {
        const [metricData, scansData] = await Promise.all([
          canViewMetrics ? getDashboardMetrics() : Promise.resolve(null),
          canViewRecentScans
            ? getRiwayatScan({ limit: 5 })
            : Promise.resolve([] as Record<string, unknown>[]),
        ]);
        if (!cancelled) {
          setMetrics(metricData);
          setRecentScans(scansData || []);
          setLoadError(null);
        }
      } catch (err) {
        // Diam berarti dasbor tampil kosong dan tidak bisa dibedakan dari hari
        // yang memang belum ada aktivitasnya (sama seperti Project Meksa).
        if (!cancelled) {
          setLoadError(
            err instanceof Error
              ? err.message
              : "Data dasbor gagal dimuat. Tarik ke bawah untuk mencoba lagi.",
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    if (isAuthenticated) {
      void loadData();
    }
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, canViewMetrics, canViewRecentScans]);

  const formattedTime = clock
    ? clock.toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "--:--:--";

  const formattedDate = clock
    ? clock.toLocaleDateString("id-ID", {
        weekday: "long",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Memuat waktu...";

  return (
    <MobileAppShell>
      <div className="flex flex-col gap-4">
        {loadError ? (
          <div className="rounded-2xl border border-rose-400/30 bg-rose-400/10 p-3 text-xs text-rose-200">
            {loadError}
          </div>
        ) : null}

        {/* Time & Shift Card */}
        <div className="relative overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-br from-slate-900 via-slate-900/90 to-sky-950/40 p-5 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-sky-400">
                Waktu Kerja Saat Ini
              </span>
              <h2 className="text-2xl font-black tracking-tight text-white font-mono mt-0.5">
                {formattedTime}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">{formattedDate}</p>
            </div>
            <div className="grid size-12 place-items-center rounded-2xl border border-sky-400/30 bg-sky-500/10 text-sky-300 shadow-inner">
              <Icon name="clock" className="size-6 stroke-[2]" />
            </div>
          </div>
        </div>

        {/* Quick Launch QR Scanner Hero Button */}
        <Link
          href="/scanner"
          onClick={() => triggerHaptic("success")}
          className="theme-invariant group relative flex items-center justify-between overflow-hidden rounded-3xl border border-sky-400/40 bg-gradient-to-r from-sky-500 via-sky-600 to-blue-700 p-5 shadow-xl shadow-sky-950/60 active:scale-[0.98] transition-all"
        >
          <div className="flex items-center gap-3.5">
            <div className="grid size-12 place-items-center rounded-2xl bg-white/20 text-white shadow-md">
              <Icon name="scanner" className="size-6 stroke-[2.2]" />
            </div>
            <div>
              <h3 className="text-base font-black text-white leading-tight">
                Scan QR Absensi
              </h3>
              <p className="text-xs text-sky-100/80 mt-0.5">
                Kamera aktif instan dengan auto-haptics
              </p>
            </div>
          </div>
          <Icon
            name="chevron-right"
            className="size-5 text-white/80 group-hover:translate-x-1 transition-transform"
          />
        </Link>

        {/* Quick Access: Data Karyawan (hanya jika memiliki izin employees.view) */}
        {canViewKaryawan ? (
          <Link
            href="/karyawan"
            onClick={() => triggerHaptic("light")}
            className="group flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3.5 hover:bg-slate-900/90 active:scale-[0.98] transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-2xl border border-white/10 bg-slate-800/60 text-slate-300">
                <Icon name="users" className="size-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">Data Karyawan</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {isLoading
                    ? "Memuat..."
                    : `${metrics?.totalKaryawan ?? 0} Karyawan Terdaftar`}
                </p>
              </div>
            </div>
            <Icon
              name="chevron-right"
              className="size-4 text-slate-500 group-hover:translate-x-1 transition-transform"
            />
          </Link>
        ) : null}

        {/* Statistics Grid (Hanya jika memiliki izin dashboard.view) */}
        {canViewMetrics ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 backdrop-blur-md">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Total Hadir
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-black text-emerald-400">
                  {isLoading ? "--" : (metrics?.hadirHariIni ?? 0)}
                </span>
                <span className="text-xs text-slate-400 font-medium">
                  / {metrics?.totalKaryawan ?? 0}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 backdrop-blur-md">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Terlambat
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-black text-amber-400">
                  {isLoading ? "--" : (metrics?.terlambatHariIni ?? 0)}
                </span>
                <span className="text-xs text-slate-400 font-medium">
                  orang
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 backdrop-blur-md">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Izin / Sakit
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-black text-blue-400">
                  {isLoading ? "--" : (metrics?.sakitIzinHariIni ?? 0)}
                </span>
                <span className="text-xs text-slate-400 font-medium">
                  orang
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 backdrop-blur-md">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Alfa / Belum
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-black text-rose-400">
                  {isLoading ? "--" : (metrics?.alfaHariIni ?? 0)}
                </span>
                <span className="text-xs text-slate-400 font-medium">
                  orang
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {/* Rekap bulanan & peringkat (izin dashboard.view, sama seperti Web) */}
        {canViewMetrics ? <DashboardInsights /> : null}

        {/* Recent Scans Section (izin home.view) */}
        {canViewRecentScans ? (
          <div className="flex flex-col gap-2 mt-2">
            <div className="flex items-center justify-between px-1">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Aktivitas Absensi Terbaru
              </h4>
              {canViewHistory ? (
                <Link
                  href="/history"
                  className="text-xs font-semibold text-sky-400 hover:underline"
                >
                  Lihat Semua →
                </Link>
              ) : null}
            </div>

            {isLoading ? (
              <div className="flex flex-col gap-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-16 rounded-2xl border border-white/5 bg-slate-900/40 animate-pulse"
                  />
                ))}
              </div>
            ) : recentScans.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-6 text-center text-xs text-slate-500">
                Belum ada aktivitas absensi hari ini.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {recentScans.map((scan, idx) => {
                  const nama = String(scan.nama || "Tanpa Nama");
                  const divisi = String(scan.divisi || "-");
                  const jam = String(scan.jam_scan || "--:--");
                  const jenis = String(scan.jenis_scan || "Scan");
                  const statusStr = String(scan.status_proses || "Berhasil");
                  const idLog = String(scan.id_log || idx);

                  return (
                    <div
                      key={idLog}
                      className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/70 p-3.5 backdrop-blur-md"
                    >
                      <div className="flex flex-col min-w-0 pr-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white truncate">
                            {nama}
                          </span>
                          <StatusBadge status={statusStr} />
                        </div>
                        <span className="text-[11px] text-slate-400 mt-0.5">
                          {divisi} • {jam} • {jenis}
                        </span>
                      </div>
                      <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-sky-500/10 text-sky-400 text-xs font-bold">
                        {jenis.charAt(0)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </MobileAppShell>
  );
}
