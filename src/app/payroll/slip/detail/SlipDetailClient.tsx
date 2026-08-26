"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { MobileAppShell } from "@/components/MobileAppShell";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { triggerHaptic } from "@/lib/client/haptics";
import { shareText } from "@/lib/client/share";
import { useAuth } from "@/lib/context/AuthContext";
import {
  getPayrollSlipDetail,
  type MobileSlipDetail,
} from "@/lib/gateways/payroll";
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

export default function SlipDetailClient() {
  const isHydrated = useHydrated();
  const router = useRouter();
  const searchParams = useSearchParams();
  const slipId = searchParams.get("id") || "";
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const [slip, setSlip] = useState<MobileSlipDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const loadSlip = useCallback(async () => {
    if (!slipId) return;
    setLoading(true);
    setFeedback(null);
    try {
      const data = await getPayrollSlipDetail(slipId);
      setSlip(data);
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal memuat rincian slip gaji.",
      });
    } finally {
      setLoading(false);
    }
  }, [slipId]);

  useEffect(() => {
    if (!isHydrated || authLoading) return;
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }
    void loadSlip();
  }, [isHydrated, authLoading, isAuthenticated, loadSlip, router]);

  const handleShare = async () => {
    if (!slip) return;
    triggerHaptic();
    setSharing(true);
    try {
      const textSummary = `*SLIP GAJI SPPG*
Nama: ${slip.nama_karyawan} (${slip.id_karyawan})
Divisi: ${slip.divisi}
Periode: ${slip.period_start} s.d. ${slip.period_end}
----------------------------------------
Gaji Pokok: ${IDR.format(slip.basic_salary)}
Upah Lembur: ${IDR.format(slip.overtime_salary)}
Total Potongan: -${IDR.format(slip.total_deductions + slip.bpjs_employee_total + slip.pph21_amount)}
----------------------------------------
*TAKE HOME PAY: ${IDR.format(slip.net_salary)}*
Status: LUNAS / DIBAYAR`;

      await shareText(
        textSummary,
        `Slip_Gaji_${slip.nama_karyawan.replace(/\s+/g, "_")}`,
      );
      setFeedback({ type: "success", message: "Slip berhasil dibagikan." });
    } catch {
      // User cancelled or share dismissed
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

  let breakdown: BreakdownSnapshot = {};
  if (slip) {
    try {
      breakdown = JSON.parse(
        slip.breakdown_snapshot || "{}",
      ) as BreakdownSnapshot;
    } catch {
      breakdown = {};
    }
  }

  const components: ComponentItem[] = breakdown.components || [];
  const allowances = components.filter((c) => c.category === "ALLOWANCE");
  const deductions = components.filter((c) => c.category === "DEDUCTION");
  const bpjsList: BpjsItem[] = (breakdown.bpjs || []).filter(
    (b) => b.is_employee,
  );

  return (
    <MobileAppShell>
      <div className="p-4 space-y-4 max-w-lg mx-auto pb-12">
        {/* Header Bar */}
        <div className="flex items-center justify-between">
          <Link
            href="/payroll"
            onClick={() => triggerHaptic()}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl border border-slate-700 flex items-center gap-1.5 text-xs font-semibold"
          >
            <Icon name="arrow-left" className="w-4 h-4" />
            <span>Kembali</span>
          </Link>
          <button
            type="button"
            onClick={handleShare}
            disabled={sharing || !slip}
            className="px-3 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow"
          >
            <Icon name="share" className="w-4 h-4" />
            <span>{sharing ? "Membagikan..." : "Bagikan"}</span>
          </button>
        </div>

        {feedback && (
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            onClose={() => setFeedback(null)}
          />
        )}

        {loading || !slip ? (
          <div className="py-16 text-center text-slate-500 text-sm">
            Memuat rincian slip...
          </div>
        ) : (
          <div className="space-y-4">
            {/* Header Info Card */}
            <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-[10px] text-sky-400 font-bold uppercase tracking-wider">
                    SPPG BUKTI GAJI RESMI
                  </span>
                  <h2 className="text-lg font-bold text-slate-100 mt-0.5">
                    {slip.nama_karyawan}
                  </h2>
                  <p className="text-xs text-slate-400 font-mono">
                    {slip.id_karyawan} • {slip.divisi}
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  LUNAS
                </span>
              </div>
              <div className="pt-2 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-500">Periode:</span>
                  <div className="font-semibold text-slate-300">
                    {slip.period_start} s.d. {slip.period_end}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Jam Kerja:</span>
                  <div className="font-mono text-slate-300">
                    {slip.total_regular_hours}j (Lembur:{" "}
                    {slip.total_overtime_hours}j)
                  </div>
                </div>
              </div>
            </div>

            {/* Card Penghasilan */}
            <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
              <h3 className="text-xs font-bold uppercase text-emerald-400 flex items-center gap-1.5">
                <Icon name="check" className="w-3.5 h-3.5" />
                Penghasilan
              </h3>
              <div className="space-y-2 text-xs divide-y divide-slate-800/80">
                <div className="flex justify-between items-center pt-1.5">
                  <span className="text-slate-400">
                    Gaji Pokok ({slip.total_regular_hours} Jam)
                  </span>
                  <span className="font-mono font-semibold text-slate-200">
                    {IDR.format(slip.basic_salary)}
                  </span>
                </div>
                {slip.overtime_salary > 0 && (
                  <div className="flex justify-between items-center pt-1.5">
                    <span className="text-slate-400">
                      Upah Lembur ({slip.total_overtime_index} Indeks)
                    </span>
                    <span className="font-mono font-semibold text-amber-400">
                      {IDR.format(slip.overtime_salary)}
                    </span>
                  </div>
                )}
                {allowances.map((a) => (
                  <div
                    key={a.id}
                    className="flex justify-between items-center pt-1.5"
                  >
                    <span className="text-slate-400">{a.name}</span>
                    <span className="font-mono font-semibold text-slate-200">
                      {IDR.format(a.nominal)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-2 font-bold text-sm">
                  <span className="text-slate-200">
                    Total Penghasilan Kotor
                  </span>
                  <span className="font-mono text-emerald-400">
                    {IDR.format(slip.gross_salary)}
                  </span>
                </div>
              </div>
            </div>

            {/* Card Potongan */}
            <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
              <h3 className="text-xs font-bold uppercase text-rose-400 flex items-center gap-1.5">
                <Icon name="x" className="w-3.5 h-3.5" />
                Potongan & Pajak
              </h3>
              <div className="space-y-2 text-xs divide-y divide-slate-800/80">
                {bpjsList.map((b) => (
                  <div
                    key={b.code}
                    className="flex justify-between items-center pt-1.5"
                  >
                    <span className="text-slate-400">{b.name}</span>
                    <span className="font-mono font-semibold text-rose-400">
                      -{IDR.format(b.nominal)}
                    </span>
                  </div>
                ))}
                {slip.pph21_amount > 0 && (
                  <div className="flex justify-between items-center pt-1.5">
                    <span className="text-slate-400">
                      PPh 21 (TER {slip.ptkp_status})
                    </span>
                    <span className="font-mono font-semibold text-rose-400">
                      -{IDR.format(slip.pph21_amount)}
                    </span>
                  </div>
                )}
                {deductions.map((d) => (
                  <div
                    key={d.id}
                    className="flex justify-between items-center pt-1.5"
                  >
                    <span className="text-slate-400">{d.name}</span>
                    <span className="font-mono font-semibold text-rose-400">
                      -{IDR.format(d.nominal)}
                    </span>
                  </div>
                ))}
                {bpjsList.length === 0 &&
                  slip.pph21_amount === 0 &&
                  deductions.length === 0 && (
                    <div className="text-slate-500 py-1 text-center italic">
                      Tidak ada potongan.
                    </div>
                  )}
                <div className="flex justify-between items-center pt-2 font-bold text-sm">
                  <span className="text-slate-200">Total Pemotongan</span>
                  <span className="font-mono text-rose-400">
                    -
                    {IDR.format(
                      slip.total_deductions +
                        slip.bpjs_employee_total +
                        slip.pph21_amount,
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Total Take Home Pay Card */}
            <div className="p-6 bg-gradient-to-br from-emerald-950/60 to-slate-900 border-2 border-emerald-500/40 rounded-2xl text-center space-y-1 shadow-xl">
              <span className="text-xs uppercase font-bold text-emerald-400 tracking-wider">
                GAJI BERSIH DITERIMA (TAKE HOME PAY)
              </span>
              <div className="text-3xl font-extrabold font-mono text-emerald-300">
                {IDR.format(slip.net_salary)}
              </div>
              <p className="text-[11px] text-slate-400 pt-1">
                Telah ditransfer ke rekening karyawan terdaftar
              </p>
            </div>
          </div>
        )}
      </div>
    </MobileAppShell>
  );
}
