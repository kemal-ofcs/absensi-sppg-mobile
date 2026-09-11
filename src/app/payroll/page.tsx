"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MobileAppShell } from "@/components/MobileAppShell";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { canAccessArea, hasPermission } from "@/lib/auth/access";
import { triggerHaptic } from "@/lib/client/haptics";
import { shareText } from "@/lib/client/share";
import { useAuth } from "@/lib/context/AuthContext";
import { getDaftarKaryawan } from "@/lib/gateways/employee";
import {
  getEmployeePayrollEstimate,
  getMyPayrollSlips,
  type MobileSlipDetail,
  type MobileSlipSummary,
} from "@/lib/gateways/payroll";
import { useCompanyName } from "@/lib/hooks/useCompanyName";
import { useHydrated } from "@/lib/hooks/useHydrated";

interface ComponentItem {
  id: string;
  name: string;
  category: "ALLOWANCE" | "DEDUCTION";
  calc_type: string;
  rate: number;
  nominal: number;
}

interface BpjsItem {
  code: string;
  name: string;
  rate: number;
  wage_cap: number | null;
  nominal: number;
  is_employee: boolean;
}

interface BreakdownSnapshot {
  rate_per_hour?: number;
  regular_hours?: number;
  overtime_hours?: number;
  overtime_index?: number;
  basic_salary?: number;
  overtime_salary?: number;
  components?: ComponentItem[];
  bpjs?: BpjsItem[];
  tax?: {
    method?: string;
    category?: string;
    ptkp_status?: string;
    rate_percentage?: number;
    pph21_amount?: number;
  };
}

const IDR = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

function getDefaultMonthRange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
  return {
    start: `${year}-${month}-01`,
    end: `${year}-${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

function getLastMonthRange() {
  const now = new Date();
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const monthIdx = now.getMonth() === 0 ? 12 : now.getMonth();
  const month = String(monthIdx).padStart(2, "0");
  const lastDay = new Date(year, monthIdx, 0).getDate();
  return {
    start: `${year}-${month}-01`,
    end: `${year}-${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

export default function MobilePayrollPortalPage() {
  const isHydrated = useHydrated();
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const companyName = useCompanyName();
  // Administrasi payroll (modul `payroll_admin`, salinan modul Desktop).
  const canViewPayrollAdmin = hasPermission(user, "payroll.view");
  const canManagePayrollConfig = hasPermission(user, "payroll.config.manage");

  const [activeTab, setActiveTab] = useState<"estimate" | "archive">(
    "estimate",
  );
  const [employees, setEmployees] = useState<Record<string, unknown>[]>([]);
  const [selectedKaryawanId, setSelectedKaryawanId] = useState<string>("");

  // Filter Periode
  const defaultRange = useMemo(() => getDefaultMonthRange(), []);
  const [periodStart, setPeriodStart] = useState<string>(defaultRange.start);
  const [periodEnd, setPeriodEnd] = useState<string>(defaultRange.end);

  // Estimasi Live
  const [estimateDetail, setEstimateDetail] = useState<MobileSlipDetail | null>(
    null,
  );
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  // Arsip Resmi
  const [slips, setSlips] = useState<MobileSlipSummary[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);

  const [sharing, setSharing] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const loadEmployees = useCallback(async () => {
    try {
      const empList = await getDaftarKaryawan();
      setEmployees(empList);
      if (empList.length > 0 && !selectedKaryawanId) {
        setSelectedKaryawanId(String(empList[0].id_unik));
      }
    } catch (err) {
      // Diam berarti pemilih karyawan tampil kosong seolah memang tidak ada
      // karyawan, padahal permintaannya yang gagal.
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Daftar karyawan gagal dimuat.",
      });
    }
  }, [selectedKaryawanId]);

  const loadEstimate = useCallback(async () => {
    if (!selectedKaryawanId) return;
    setEstimateLoading(true);
    setFeedback(null);
    try {
      const data = await getEmployeePayrollEstimate(
        selectedKaryawanId,
        periodStart,
        periodEnd,
      );
      setEstimateDetail(data);
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal menghitung estimasi upah karyawan.",
      });
      setEstimateDetail(null);
    } finally {
      setEstimateLoading(false);
    }
  }, [selectedKaryawanId, periodStart, periodEnd]);

  const loadSlips = useCallback(async () => {
    if (!selectedKaryawanId) return;
    setArchiveLoading(true);
    setFeedback(null);
    try {
      const data = await getMyPayrollSlips(selectedKaryawanId);
      setSlips(data);
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Gagal memuat arsip slip gaji.",
      });
    } finally {
      setArchiveLoading(false);
    }
  }, [selectedKaryawanId]);

  useEffect(() => {
    if (!isHydrated || authLoading) return;
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }
    // Otorisasi, bukan sekadar autentikasi (sama seperti Project Meksa). Tanpa
    // baris ini setiap operator dengan sesi yang sah bisa membuka slip gaji
    // beserta datanya. Mobile tidak punya rute `/forbidden`.
    if (!canAccessArea(user, "payroll")) {
      router.replace("/dashboard");
      return;
    }
    void loadEmployees();
  }, [isHydrated, authLoading, isAuthenticated, user, loadEmployees, router]);

  useEffect(() => {
    if (selectedKaryawanId) {
      if (activeTab === "estimate") {
        void loadEstimate();
      } else {
        void loadSlips();
      }
    }
  }, [selectedKaryawanId, activeTab, loadEstimate, loadSlips]);

  useEffect(() => {
    const handleSync = () => {
      if (selectedKaryawanId) {
        if (activeTab === "estimate") void loadEstimate();
        else void loadSlips();
      }
    };
    window.addEventListener("sppg:sync-completed", handleSync);
    return () => window.removeEventListener("sppg:sync-completed", handleSync);
  }, [selectedKaryawanId, activeTab, loadEstimate, loadSlips]);

  // Muat ulang manual kini lewat gestur tarik-ke-bawah di MobileAppShell:
  // ia menjalankan syncNow() lalu memancarkan "sppg:sync-completed", yang sudah
  // ditangani effect di atas untuk memuat ulang estimasi/arsip slip.

  const handleShareSlip = async (detail: MobileSlipDetail) => {
    triggerHaptic();
    setSharing(true);
    try {
      const totalPotongan =
        (detail.total_deductions || 0) +
        (detail.bpjs_employee_total || 0) +
        (detail.pph21_amount || 0);

      const textSummary = `*SLIP GAJI REAL-TIME (${companyName.toUpperCase()})*
Nama: ${detail.nama_karyawan} (${detail.id_karyawan})
Divisi: ${detail.divisi}
Periode: ${detail.period_start} s.d. ${detail.period_end}
----------------------------------------
Kehadiran: ${detail.total_hadir ?? 0} Hari (${(detail.total_regular_hours || 0).toFixed(1)} Jam Reguler)
Jam Lembur: ${(detail.total_overtime_hours || 0).toFixed(1)} Jam (Indeks ${(detail.total_overtime_index || 0).toFixed(2)})
Gaji Pokok: ${IDR.format(detail.basic_salary)}
Upah Lembur: ${IDR.format(detail.overtime_salary)}
Tunjangan: ${IDR.format(detail.total_allowances)}
Total Potongan: -${IDR.format(totalPotongan)}
----------------------------------------
*TAKE HOME PAY: ${IDR.format(detail.net_salary)}*
Status: Estimasi Real-Time ${companyName}`;

      await shareText(
        textSummary,
        `Slip_Gaji_${detail.nama_karyawan.replace(/\s+/g, "_")}`,
      );
      setFeedback({ type: "success", message: "Slip berhasil dibagikan." });
    } catch {
      // Pengguna menutup dialog berbagi. Itu PEMBATALAN, bukan kegagalan —
      // menampilkan pesan error untuk keputusan yang disengaja hanya
      // membingungkan.
    } finally {
      setSharing(false);
    }
  };

  if (!isHydrated || authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-400">
        Memuat otorisasi...
      </div>
    );
  }

  // Parse breakdown snapshot
  let parsedBreakdown: BreakdownSnapshot = {};
  if (estimateDetail?.breakdown_snapshot) {
    try {
      parsedBreakdown = JSON.parse(
        estimateDetail.breakdown_snapshot,
      ) as BreakdownSnapshot;
    } catch {
      parsedBreakdown = {};
    }
  }

  const allowances = (parsedBreakdown.components || []).filter(
    (c) => c.category === "ALLOWANCE",
  );
  const deductions = (parsedBreakdown.components || []).filter(
    (c) => c.category === "DEDUCTION",
  );
  const bpjsList = (parsedBreakdown.bpjs || []).filter((b) => b.is_employee);

  return (
    <MobileAppShell>
      <div className="p-4 space-y-4 max-w-lg mx-auto pb-20">
        {/* Header Title */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Link
              href="/settings"
              onClick={() => triggerHaptic("light")}
              className="p-2 bg-slate-900 hover:bg-slate-800 active:scale-95 text-slate-400 hover:text-white rounded-xl border border-slate-800"
              aria-label="Kembali ke Pengaturan"
            >
              <Icon name="arrow-left" className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-lg font-bold text-slate-100">
                Slip &amp; Estimasi Gaji
              </h1>
              <p className="text-xs text-slate-400">
                Kalkulasi upah harian &amp; arsip digital
              </p>
            </div>
          </div>
        </div>

        {feedback && (
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            onClose={() => setFeedback(null)}
          />
        )}

        {/* Administrasi Payroll (izin payroll.view; tiap aksi dijaga izinnya sendiri) */}
        {canViewPayrollAdmin ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-3">
            <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-emerald-300">
              Administrasi Payroll
            </p>
            <Link
              href="/payroll/runs"
              onClick={() => triggerHaptic("light")}
              className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-900/80 px-3 text-xs font-bold text-slate-200 transition active:scale-95"
            >
              <span className="flex items-center gap-2">
                <Icon name="history" className="size-4 text-emerald-300" />
                Batch Payroll &amp; Persetujuan
              </span>
              <Icon name="chevron-right" className="size-4 text-slate-500" />
            </Link>
            {canManagePayrollConfig ? (
              <Link
                href="/payroll/config"
                onClick={() => triggerHaptic("light")}
                className="mt-2 flex min-h-11 items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-900/80 px-3 text-xs font-bold text-slate-200 transition active:scale-95"
              >
                <span className="flex items-center gap-2">
                  <Icon name="settings" className="size-4 text-emerald-300" />
                  Rate Gaji &amp; Komponen
                </span>
                <Icon name="chevron-right" className="size-4 text-slate-500" />
              </Link>
            ) : null}
          </div>
        ) : null}

        {/* Tab Navigation */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-slate-900 border border-slate-800 rounded-2xl">
          <button
            type="button"
            onClick={() => {
              triggerHaptic();
              setActiveTab("estimate");
            }}
            className={`py-2 text-xs font-bold rounded-xl transition ${
              activeTab === "estimate"
                ? "bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Estimasi Real-Time
          </button>
          <button
            type="button"
            onClick={() => {
              triggerHaptic();
              setActiveTab("archive");
            }}
            className={`py-2 text-xs font-bold rounded-xl transition ${
              activeTab === "archive"
                ? "bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Arsip Slip Resmi
          </button>
        </div>

        {/* Pemilih Personil Karyawan */}
        {employees.length > 0 && (
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <span>Pilih Personil:</span>
              <select
                value={selectedKaryawanId}
                onChange={(e) => {
                  triggerHaptic();
                  setSelectedKaryawanId(e.target.value);
                }}
                className="w-full mt-1 px-3 py-2.5 text-sm bg-slate-900 border border-slate-700/80 rounded-xl text-slate-200 focus:outline-none focus:border-sky-500 font-medium"
              >
                {employees.map((emp) => (
                  <option key={String(emp.id_unik)} value={String(emp.id_unik)}>
                    {String(emp.nama)} (
                    {emp.divisi ? String(emp.divisi) : "Divisi -"})
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {/* TAB 1: ESTIMASI REAL-TIME */}
        {activeTab === "estimate" && (
          <div className="space-y-4">
            {/* Filter Periode Cepat */}
            <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300">
                  Periode Perhitungan
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic();
                      const range = getDefaultMonthRange();
                      setPeriodStart(range.start);
                      setPeriodEnd(range.end);
                    }}
                    className="px-2.5 py-1 text-[11px] font-semibold bg-white/5 hover:bg-white/10 text-sky-400 rounded-lg border border-white/10"
                  >
                    Bulan Ini
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic();
                      const range = getLastMonthRange();
                      setPeriodStart(range.start);
                      setPeriodEnd(range.end);
                    }}
                    className="px-2.5 py-1 text-[11px] font-semibold bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg border border-white/10"
                  >
                    Bulan Lalu
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">
                    <span>Tanggal Awal</span>
                    <input
                      type="date"
                      value={periodStart}
                      onChange={(e) => setPeriodStart(e.target.value)}
                      className="w-full mt-1 px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                    />
                  </label>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">
                    <span>Tanggal Akhir</span>
                    <input
                      type="date"
                      value={periodEnd}
                      onChange={(e) => setPeriodEnd(e.target.value)}
                      className="w-full mt-1 px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* Hasil Estimasi Upah */}
            {estimateLoading ? (
              <div className="py-12 text-center text-slate-400 text-sm">
                Menghitung kalkulasi upah real-time...
              </div>
            ) : estimateDetail ? (
              <div className="space-y-3">
                {/* Highlight Take Home Pay */}
                <div className="rounded-3xl border border-sky-500/30 bg-gradient-to-br from-sky-950/40 via-slate-900 to-slate-950 p-5 shadow-xl relative overflow-hidden">
                  <div className="flex items-center justify-between text-xs text-sky-400 font-semibold mb-1">
                    <span>ESTIMASI TAKE HOME PAY</span>
                    <span className="px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 text-[10px]">
                      Live Engine
                    </span>
                  </div>
                  <div className="text-3xl font-black text-white tracking-tight">
                    {IDR.format(estimateDetail.net_salary)}
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-400 pt-3 border-t border-white/10">
                    <div>
                      Hadir:{" "}
                      <span className="font-bold text-slate-200">
                        {estimateDetail.total_hadir ?? 0} Hari
                      </span>{" "}
                      ·{" "}
                      <span className="text-slate-300">
                        {(estimateDetail.total_regular_hours || 0).toFixed(1)}j
                      </span>
                    </div>
                    <div>
                      Lembur:{" "}
                      <span className="font-bold text-amber-300">
                        {(estimateDetail.total_overtime_hours || 0).toFixed(1)}j
                      </span>
                    </div>
                  </div>
                </div>

                {/* Grid Rincian Komponen Ringkas */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-3.5 space-y-1">
                    <p className="text-[11px] text-slate-400">Gaji Pokok</p>
                    <p className="text-base font-bold text-slate-100">
                      {IDR.format(estimateDetail.basic_salary)}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      @ {IDR.format(estimateDetail.rate_per_hour)} / jam
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-3.5 space-y-1">
                    <p className="text-[11px] text-amber-400/90">Upah Lembur</p>
                    <p className="text-base font-bold text-amber-300">
                      {IDR.format(estimateDetail.overtime_salary)}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      Indeks:{" "}
                      {(estimateDetail.total_overtime_index || 0).toFixed(2)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-3.5 space-y-1">
                    <p className="text-[11px] text-emerald-400/90">Tunjangan</p>
                    <p className="text-base font-bold text-emerald-300">
                      {IDR.format(estimateDetail.total_allowances)}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {allowances.length} Komponen
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-3.5 space-y-1">
                    <p className="text-[11px] text-rose-400/90">
                      Total Potongan
                    </p>
                    <p className="text-base font-bold text-rose-400">
                      {IDR.format(
                        estimateDetail.total_deductions +
                          estimateDetail.bpjs_employee_total +
                          estimateDetail.pph21_amount,
                      )}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      BPJS, Pajak & Lainnya
                    </p>
                  </div>
                </div>

                {/* Tombol Buka Slip Lengkap & Share */}
                <div className="pt-2 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic();
                      setIsDetailModalOpen(true);
                    }}
                    className="w-full py-3 px-4 rounded-2xl bg-sky-500 hover:bg-sky-400 active:scale-98 text-slate-950 font-black text-sm transition shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2"
                  >
                    <Icon name="document" className="w-4 h-4" />
                    Lihat Rincian Slip Lengkap
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleShareSlip(estimateDetail)}
                    disabled={sharing}
                    className="w-full py-2.5 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 active:scale-98 text-slate-200 font-bold text-xs transition border border-slate-700 flex items-center justify-center gap-2"
                  >
                    <Icon name="share" className="w-3.5 h-3.5 text-sky-400" />
                    {sharing ? "Membagikan..." : "Bagikan Ringkasan Slip"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-2xl space-y-2">
                <Icon
                  name="document"
                  className="w-8 h-8 text-slate-500 mx-auto"
                />
                <p className="text-xs text-slate-400">
                  Tidak ada data absensi untuk karyawan ini pada periode yang
                  dipilih.
                </p>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: ARSIP SLIP RESMI */}
        {activeTab === "archive" && (
          <div className="space-y-3">
            {archiveLoading ? (
              <div className="py-12 text-center text-slate-400 text-sm">
                Memuat riwayat slip resmi...
              </div>
            ) : slips.length === 0 ? (
              <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-2xl space-y-2">
                <Icon
                  name="document"
                  className="w-8 h-8 text-slate-500 mx-auto"
                />
                <p className="text-xs text-slate-400">
                  Belum ada arsip slip gaji resmi dari batch yang telah
                  disetujui / dibayar.
                </p>
              </div>
            ) : (
              slips.map((slip) => (
                <Link
                  key={slip.id}
                  href={`/payroll/slip/${slip.id}`}
                  onClick={() => triggerHaptic()}
                  className="block p-4 bg-slate-900/90 border border-slate-800 hover:border-sky-500/50 rounded-2xl transition space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-400">
                      Periode: {slip.period_start} s.d. {slip.period_end}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                      {slip.status}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-lg font-black text-white">
                      {IDR.format(slip.net_salary)}
                    </span>
                    <span className="text-xs text-sky-400 font-bold flex items-center gap-1">
                      Buka Slip <Icon name="arrow-right" className="w-3 h-3" />
                    </span>
                  </div>
                </Link>
              ))
            )}
          </div>
        )}

        {/* MODAL RINCIAN SLIP GAJI REAL-TIME */}
        {isDetailModalOpen && estimateDetail && (
          <Modal
            isOpen={isDetailModalOpen}
            onClose={() => setIsDetailModalOpen(false)}
            title={`Slip Gaji Digital — ${estimateDetail.nama_karyawan}`}
            maxWidth="max-w-xl"
          >
            <div className="space-y-4 text-xs">
              {/* Header Info Personil */}
              <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-white/10 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-slate-300">
                  <div>
                    <span className="text-slate-500 text-[10px] block">
                      NAMA LENGKAP
                    </span>
                    <span className="font-bold text-white text-sm">
                      {estimateDetail.nama_karyawan}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px] block">
                      DIVISI
                    </span>
                    <span className="font-medium text-slate-200">
                      {estimateDetail.divisi}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px] block">
                      PERIODE KERJA
                    </span>
                    <span className="font-mono text-slate-200">
                      {estimateDetail.period_start} s.d.{" "}
                      {estimateDetail.period_end}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px] block">
                      STATUS PTKP / TARIF
                    </span>
                    <span className="font-medium text-slate-200">
                      {estimateDetail.ptkp_status} ·{" "}
                      {IDR.format(estimateDetail.rate_per_hour)}/jam
                    </span>
                  </div>
                </div>
              </div>

              {/* Rincian Kehadiran & Jam */}
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 grid grid-cols-3 gap-2 text-center">
                <div>
                  <span className="text-[10px] text-slate-400 block">
                    Total Hadir
                  </span>
                  <span className="font-bold text-white text-sm">
                    {estimateDetail.total_hadir ?? 0} Hari
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">
                    Jam Reguler
                  </span>
                  <span className="font-bold text-white text-sm">
                    {(estimateDetail.total_regular_hours || 0).toFixed(2)}j
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-amber-400 block">
                    Jam Lembur
                  </span>
                  <span className="font-bold text-amber-300 text-sm">
                    {(estimateDetail.total_overtime_hours || 0).toFixed(2)}j
                  </span>
                </div>
              </div>

              {/* Bagian I: Penghasilan */}
              <div className="space-y-1.5">
                <div className="font-bold text-sky-400 uppercase tracking-wider text-[11px] pb-1 border-b border-sky-500/20">
                  I. Penghasilan Kotor
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-300">Gaji Pokok (Reguler)</span>
                  <span className="font-mono font-medium text-white">
                    {IDR.format(estimateDetail.basic_salary)}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-300">
                    Upah Lembur (Indeks{" "}
                    {(estimateDetail.total_overtime_index || 0).toFixed(2)})
                  </span>
                  <span className="font-mono font-medium text-amber-300">
                    {IDR.format(estimateDetail.overtime_salary)}
                  </span>
                </div>
                {allowances.map((comp) => (
                  <div
                    key={comp.id}
                    className="flex justify-between py-1 border-b border-white/5"
                  >
                    <span className="text-slate-300">{comp.name}</span>
                    <span className="font-mono font-medium text-emerald-300">
                      {IDR.format(comp.nominal)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between py-1.5 font-bold text-slate-100 bg-white/[0.03] px-2 rounded-lg">
                  <span>Total Penghasilan Kotor</span>
                  <span className="font-mono text-sky-300">
                    {IDR.format(estimateDetail.gross_salary)}
                  </span>
                </div>
              </div>

              {/* Bagian II: Pemotongan */}
              <div className="space-y-1.5">
                <div className="font-bold text-rose-400 uppercase tracking-wider text-[11px] pb-1 border-b border-rose-500/20">
                  II. Pemotongan (BPJS, Pajak & Lainnya)
                </div>
                {bpjsList.map((bpjs) => (
                  <div
                    key={bpjs.code}
                    className="flex justify-between py-1 border-b border-white/5"
                  >
                    <span className="text-slate-300">
                      {bpjs.name} ({bpjs.rate}%)
                    </span>
                    <span className="font-mono text-rose-400">
                      {IDR.format(bpjs.nominal)}
                    </span>
                  </div>
                ))}
                {estimateDetail.pph21_amount > 0 && (
                  <div className="flex justify-between py-1 border-b border-white/5">
                    <span className="text-slate-300">
                      PPh 21 TER ({parsedBreakdown.tax?.category || "TER A"} ·{" "}
                      {parsedBreakdown.tax?.rate_percentage || 0}%)
                    </span>
                    <span className="font-mono text-rose-400">
                      {IDR.format(estimateDetail.pph21_amount)}
                    </span>
                  </div>
                )}
                {deductions.map((comp) => (
                  <div
                    key={comp.id}
                    className="flex justify-between py-1 border-b border-white/5"
                  >
                    <span className="text-slate-300">{comp.name}</span>
                    <span className="font-mono text-rose-400">
                      {IDR.format(comp.nominal)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between py-1.5 font-bold text-slate-100 bg-white/[0.03] px-2 rounded-lg">
                  <span>Total Seluruh Potongan</span>
                  <span className="font-mono text-rose-400">
                    {IDR.format(
                      estimateDetail.total_deductions +
                        estimateDetail.bpjs_employee_total +
                        estimateDetail.pph21_amount,
                    )}
                  </span>
                </div>
              </div>

              {/* Bagian III: Take Home Pay */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-sky-500/20 via-sky-500/10 to-transparent border border-sky-500/30 flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-sky-400 block">
                    Gaji Bersih Diterima (Take Home Pay)
                  </span>
                  <span className="text-xl font-black text-white">
                    {IDR.format(estimateDetail.net_salary)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleShareSlip(estimateDetail)}
                  disabled={sharing}
                  className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 active:scale-95 text-slate-950 font-black text-xs transition"
                >
                  Bagikan Slip
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </MobileAppShell>
  );
}
