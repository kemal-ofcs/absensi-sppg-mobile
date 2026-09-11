"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MobileAppShell } from "@/components/MobileAppShell";
import { RunStatusBadge } from "@/components/payroll/RunStatusBadge";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { hasPermission } from "@/lib/auth/access";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import {
  createPayrollRun,
  getPayrollRecap,
  listPayrollRuns,
  type PayrollRunRow,
} from "@/lib/gateways/payroll";

/*
 * Daftar batch payroll + pembuatan batch baru untuk Mobile — padanan
 * `web-desktop/src/app/payroll/runs` dan tombol "Buat Batch Payroll" di
 * halaman Payroll Web.
 *
 * Perhitungan resmi batch dilakukan `desktop_create_payroll_run` dari modul
 * `payroll_admin` — SALINAN modul Desktop oleh `sync-rust-modules.ts` — jadi
 * angkanya identik dengan batch yang dibuat di Desktop. Ringkasan di dialog
 * konfirmasi hanyalah ESTIMASI dari rekap.
 */

const IDR = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const STATUS_FILTERS = [
  { value: "", label: "Semua" },
  { value: "DRAFT", label: "Draft" },
  { value: "SUBMITTED", label: "Diajukan" },
  { value: "REVIEWED", label: "Direview" },
  { value: "APPROVED", label: "Disetujui" },
  { value: "PAID", label: "Dibayar" },
  { value: "REJECTED", label: "Ditolak" },
];

function localDate(date: Date) {
  return date.toLocaleDateString("en-CA");
}

function monthRange(offset: number) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { start: localDate(first), end: localDate(last) };
}

export default function MobilePayrollRunsPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const canView = hasPermission(user, "payroll.view");
  const canCreate = hasPermission(user, "payroll.run.create");

  const [runs, setRuns] = useState<PayrollRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [periodStart, setPeriodStart] = useState(() => monthRange(0).start);
  const [periodEnd, setPeriodEnd] = useState(() => monthRange(0).end);
  const [estimate, setEstimate] = useState<{
    employees: number;
    net: number;
  } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [creating, setCreating] = useState(false);
  const isSubmittingRef = useRef(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/login");
      return;
    }
    // Mobile memakai static export dan tidak punya rute `/forbidden`.
    if (!authLoading && isAuthenticated && !canView) {
      router.replace("/settings");
    }
  }, [authLoading, isAuthenticated, canView, router]);

  const loadRuns = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        setRuns(await listPayrollRuns(statusFilter || undefined));
      } catch (err) {
        if (!silent) {
          setFeedback({
            type: "error",
            message:
              err instanceof Error
                ? err.message
                : "Gagal memuat daftar batch payroll.",
          });
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [statusFilter],
  );

  useEffect(() => {
    if (isAuthenticated && canView) void loadRuns();
  }, [isAuthenticated, canView, loadRuns]);

  useEffect(() => {
    const onSyncCompleted = () => {
      void loadRuns(true);
    };
    window.addEventListener("sppg:sync-completed", onSyncCompleted);
    return () => {
      window.removeEventListener("sppg:sync-completed", onSyncCompleted);
    };
  }, [loadRuns]);

  const openCreate = () => {
    triggerHaptic("light");
    setEstimate(null);
    setCreateError(null);
    setCreateOpen(true);
  };

  const applyPreset = (offset: number) => {
    const range = monthRange(offset);
    setPeriodStart(range.start);
    setPeriodEnd(range.end);
    setEstimate(null);
  };

  const calculateEstimate = async () => {
    if (!periodStart || !periodEnd || periodStart > periodEnd) {
      setCreateError(
        "Periode tidak valid: tanggal mulai harus sebelum selesai.",
      );
      return;
    }
    setEstimating(true);
    setCreateError(null);
    try {
      const rows = await getPayrollRecap(periodStart, periodEnd);
      setEstimate({
        employees: rows.length,
        net: rows.reduce(
          (sum, row) => sum + Number(row.est_net_salary || 0),
          0,
        ),
      });
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Rekap periode gagal dihitung.",
      );
    } finally {
      setEstimating(false);
    }
  };

  const handleCreate = async () => {
    if (isSubmittingRef.current || !estimate || estimate.employees === 0)
      return;
    isSubmittingRef.current = true;
    setCreating(true);
    setCreateError(null);
    try {
      const idempotencyKey = `PR-RUN-${periodStart}-${periodEnd}-${Date.now()}`;
      const run = await createPayrollRun(
        idempotencyKey,
        periodStart,
        periodEnd,
      );
      triggerHaptic("success");
      setCreateOpen(false);
      router.push(`/payroll/runs/detail?id=${encodeURIComponent(run.id)}`);
    } catch (err) {
      triggerHaptic("error");
      setCreateError(
        err instanceof Error ? err.message : "Gagal membuat batch payroll.",
      );
    } finally {
      isSubmittingRef.current = false;
      setCreating(false);
    }
  };

  if (authLoading || !isAuthenticated || !canView) {
    return <div className="min-h-dvh bg-slate-950" />;
  }

  return (
    <MobileAppShell>
      <div className="flex flex-col gap-4 text-slate-100">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              triggerHaptic("light");
              router.push("/payroll");
            }}
            aria-label="Kembali ke Payroll"
            className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/5 text-slate-300 transition hover:bg-white/10 active:scale-95"
          >
            <Icon name="arrow-left" className="size-5" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-black tracking-tight text-white">
              Batch Payroll
            </h1>
            <p className="text-[11px] text-slate-400">
              Riwayat eksekusi penggajian &amp; alur persetujuan
            </p>
          </div>
        </div>

        {feedback ? (
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            onClose={() => setFeedback(null)}
          />
        ) : null}

        {canCreate ? (
          <button
            type="button"
            onClick={openCreate}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 text-sm font-black text-slate-950 shadow-lg transition hover:bg-sky-400 active:scale-95"
          >
            <Icon name="plus" className="size-5" />
            Buat Batch Payroll
          </button>
        ) : null}

        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {STATUS_FILTERS.map((item) => (
            <button
              key={item.value || "all"}
              type="button"
              onClick={() => {
                triggerHaptic("light");
                setStatusFilter(item.value);
              }}
              className={`min-h-9 shrink-0 rounded-xl px-3 text-xs font-semibold transition ${
                statusFilter === item.value
                  ? "bg-sky-500 font-bold text-slate-950"
                  : "bg-white/5 text-slate-400 hover:bg-white/10"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-2xl border border-white/5 bg-slate-900/40"
              />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-8 text-center text-xs text-slate-500">
            Belum ada batch payroll
            {statusFilter ? " dengan status ini" : ""}.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {runs.map((run) => (
              <li key={run.id}>
                <Link
                  href={`/payroll/runs/detail?id=${encodeURIComponent(run.id)}`}
                  onClick={() => triggerHaptic("light")}
                  className="flex flex-col gap-2.5 rounded-2xl border border-white/10 bg-slate-900/80 p-3.5 transition active:scale-[0.98]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs font-bold text-slate-200">
                        {run.id}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {run.period_start} s.d. {run.period_end}
                      </p>
                    </div>
                    <RunStatusBadge status={run.status} />
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-white/5 bg-slate-950/60 p-2 text-center text-[10px]">
                    <div>
                      <p className="text-slate-500">Karyawan</p>
                      <p className="font-bold text-slate-200">
                        {run.total_employees}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Gross</p>
                      <p className="font-mono font-bold text-slate-300">
                        {IDR.format(run.total_gross_payout)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Net</p>
                      <p className="font-mono font-bold text-emerald-400">
                        {IDR.format(run.total_net_payout)}
                      </p>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Dibuat {run.created_by} ·{" "}
                    {new Date(run.created_at).toLocaleDateString("id-ID")}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        isOpen={createOpen}
        onClose={() => {
          if (!creating) setCreateOpen(false);
        }}
        title="Buat Batch Payroll"
        titleId="payroll-create-run-title"
        maxWidth="max-w-md"
        hideFooter
      >
        <div className="flex flex-col gap-3.5 text-xs">
          {createError ? (
            <FeedbackBanner
              type="error"
              message={createError}
              onClose={() => setCreateError(null)}
              className="text-xs"
            />
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => applyPreset(0)}
              className="min-h-10 rounded-xl border border-white/10 bg-white/5 font-bold text-slate-300 transition active:scale-95"
            >
              Bulan ini
            </button>
            <button
              type="button"
              onClick={() => applyPreset(-1)}
              className="min-h-10 rounded-xl border border-white/10 bg-white/5 font-bold text-slate-300 transition active:scale-95"
            >
              Bulan lalu
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor="payroll-period-start"
                className="mb-1 block text-[11px] font-semibold text-slate-400"
              >
                Dari tanggal
              </label>
              <input
                id="payroll-period-start"
                type="date"
                value={periodStart}
                onChange={(event) => {
                  setPeriodStart(event.target.value);
                  setEstimate(null);
                }}
                className="min-h-11 w-full rounded-xl border border-white/15 bg-slate-950 px-3 font-mono text-xs text-white outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <label
                htmlFor="payroll-period-end"
                className="mb-1 block text-[11px] font-semibold text-slate-400"
              >
                Sampai tanggal
              </label>
              <input
                id="payroll-period-end"
                type="date"
                value={periodEnd}
                onChange={(event) => {
                  setPeriodEnd(event.target.value);
                  setEstimate(null);
                }}
                className="min-h-11 w-full rounded-xl border border-white/15 bg-slate-950 px-3 font-mono text-xs text-white outline-none focus:border-sky-400"
              />
            </div>
          </div>

          {estimate ? (
            <div className="space-y-1.5 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-3">
              <p className="text-[11px] text-slate-300">
                Estimasi untuk{" "}
                <strong className="text-white">
                  {estimate.employees} karyawan
                </strong>
                :
              </p>
              <p className="font-mono text-lg font-black text-emerald-300">
                {IDR.format(estimate.net)}
              </p>
              <p className="text-[10px] leading-4 text-slate-400">
                Batch mengunci snapshot jam kerja, tarif lembur, PPh 21, dan
                BPJS. Angka resmi dihitung saat batch dibuat dan tampil di
                detailnya.
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void calculateEstimate()}
              disabled={estimating}
              className="min-h-11 w-full rounded-xl border border-sky-500/30 bg-sky-500/10 font-bold text-sky-300 transition active:scale-95 disabled:opacity-50"
            >
              {estimating ? "Menghitung..." : "Hitung estimasi periode ini"}
            </button>
          )}

          {estimate && estimate.employees === 0 ? (
            <p className="text-[11px] text-amber-300">
              Rekap periode ini kosong — batch tidak bisa dibuat.
            </p>
          ) : null}

          <div className="flex items-center gap-2 border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
              className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/5 font-bold text-slate-300 transition active:scale-95 disabled:opacity-50"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating || !estimate || estimate.employees === 0}
              className="min-h-11 flex-1 rounded-xl bg-sky-500 font-black text-slate-950 shadow-lg transition active:scale-95 disabled:opacity-50"
            >
              {creating ? "Memproses..." : "Buat Batch DRAFT"}
            </button>
          </div>
        </div>
      </Modal>
    </MobileAppShell>
  );
}
