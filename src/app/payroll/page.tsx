"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { MobileAppShell } from "@/components/MobileAppShell";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import { getDaftarKaryawan } from "@/lib/gateways/employee";
import {
  getMyPayrollSlips,
  type MobileSlipSummary,
} from "@/lib/gateways/payroll";
import { useHydrated } from "@/lib/hooks/useHydrated";

const IDR = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export default function MobilePayrollPortalPage() {
  const isHydrated = useHydrated();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const [employees, setEmployees] = useState<Record<string, unknown>[]>([]);
  const [selectedKaryawanId, setSelectedKaryawanId] = useState<string>("");
  const [slips, setSlips] = useState<MobileSlipSummary[]>([]);
  const [loading, setLoading] = useState(true);
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
    } catch {
      // Ignore
    }
  }, [selectedKaryawanId]);

  const loadSlips = useCallback(async () => {
    if (!selectedKaryawanId) return;
    setLoading(true);
    setFeedback(null);
    try {
      const data = await getMyPayrollSlips(selectedKaryawanId);
      setSlips(data);
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Gagal memuat slip gaji.",
      });
    } finally {
      setLoading(false);
    }
  }, [selectedKaryawanId]);

  useEffect(() => {
    if (!isHydrated || authLoading) return;
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }
    void loadEmployees();
  }, [isHydrated, authLoading, isAuthenticated, loadEmployees, router]);

  useEffect(() => {
    if (selectedKaryawanId) {
      void loadSlips();
    }
  }, [selectedKaryawanId, loadSlips]);

  if (!isHydrated || authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-400">
        Memuat otorisasi...
      </div>
    );
  }

  return (
    <MobileAppShell>
      <div className="p-4 space-y-4 max-w-lg mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-100">
              Slip Gaji Digital
            </h1>
            <p className="text-xs text-slate-400">
              Arsip pembayaran upah & bukti transfer resmi
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              triggerHaptic();
              void loadSlips();
            }}
            disabled={loading}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded-lg border border-slate-700"
          >
            <Icon
              name="refresh"
              className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
            />
          </button>
        </div>

        {feedback && (
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            onClose={() => setFeedback(null)}
          />
        )}

        {/* Pilihan Karyawan */}
        {employees.length > 1 && (
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold uppercase text-slate-400">
              <span>Pilih Personil:</span>
              <select
                value={selectedKaryawanId}
                onChange={(e) => {
                  triggerHaptic();
                  setSelectedKaryawanId(e.target.value);
                }}
                className="w-full mt-1 px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded-xl text-slate-200 focus:outline-none focus:border-sky-500 font-normal"
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

        {/* Daftar Slip Gaji */}
        <div className="space-y-3 pt-2">
          {loading ? (
            <div className="py-12 text-center text-slate-500 text-sm">
              Memuat riwayat slip gaji...
            </div>
          ) : slips.length === 0 ? (
            <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-2xl space-y-2">
              <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-slate-500">
                <Icon name="document" className="w-6 h-6" />
              </div>
              <p className="text-sm font-medium text-slate-300">
                Belum Ada Slip Gaji
              </p>
              <p className="text-xs text-slate-500">
                Slip gaji akan muncul otomatis setelah batch payroll disetujui &
                dibayar oleh manajemen.
              </p>
            </div>
          ) : (
            slips.map((slip) => (
              <Link
                key={slip.id}
                href={`/payroll/slip/detail?id=${encodeURIComponent(slip.id)}`}
                onClick={() => triggerHaptic()}
                className="block p-4 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl transition space-y-3 active:scale-[0.99]"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-xs font-semibold text-slate-400">
                      Periode Gaji
                    </span>
                    <h3 className="text-sm font-bold text-slate-100">
                      {slip.period_start} s.d. {slip.period_end}
                    </h3>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                    Dibayar (PAID)
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs py-2 border-y border-slate-800/80">
                  <div>
                    <span className="text-slate-500">Gaji Pokok:</span>
                    <div className="font-mono text-slate-300 font-medium">
                      {IDR.format(slip.basic_salary)}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Upah Lembur:</span>
                    <div className="font-mono text-amber-400 font-medium">
                      {IDR.format(slip.overtime_salary)}
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-1">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-semibold">
                      Take Home Pay
                    </span>
                    <div className="text-base font-bold font-mono text-emerald-400">
                      {IDR.format(slip.net_salary)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-sky-400 font-semibold">
                    <span>Lihat Detail</span>
                    <Icon name="arrow-right" className="w-3.5 h-3.5" />
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </MobileAppShell>
  );
}
