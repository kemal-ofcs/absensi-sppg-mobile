"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MobileAppShell } from "@/components/MobileAppShell";
import {
  RunStatusBadge,
  runStatusLabel,
} from "@/components/payroll/RunStatusBadge";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { hasPermission } from "@/lib/auth/access";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import {
  getPayrollRunDetail,
  type PayrollRunDetail,
  transitionPayrollStatus,
} from "@/lib/gateways/payroll";

/*
 * Detail batch payroll untuk Mobile — padanan
 * `web-desktop/src/app/payroll/runs/detail/RunDetailClient.tsx`.
 *
 * Tombol transisi mengikuti izin yang dituntut BACKEND
 * (`desktop_transition_payroll_status`): Ajukan = run.create, Review & Tolak =
 * run.review, Setujui = run.approve, Dibayar = run.disburse. (Web menampilkan
 * "Tolak" juga untuk pemegang run.approve, tetapi backend menolaknya.)
 */

const IDR = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

interface Transition {
  target: string;
  label: string;
  className: string;
  warning?: string;
}

function hours(value: number) {
  return `${Number(Number(value || 0).toFixed(2))} j`;
}

export default function RunDetailClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const runId = searchParams.get("id") || "";
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const canView = hasPermission(user, "payroll.view");

  const [detail, setDetail] = useState<PayrollRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"items" | "audit">("items");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [transition, setTransition] = useState<Transition | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const isSubmittingRef = useRef(false);

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

  const loadDetail = useCallback(
    async (silent = false) => {
      if (!runId) {
        setLoading(false);
        return;
      }
      if (!silent) setLoading(true);
      try {
        setDetail(await getPayrollRunDetail(runId));
      } catch (err) {
        if (!silent) {
          setFeedback({
            type: "error",
            message:
              err instanceof Error
                ? err.message
                : "Gagal memuat detail batch payroll.",
          });
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [runId],
  );

  useEffect(() => {
    if (isAuthenticated && canView) void loadDetail();
  }, [isAuthenticated, canView, loadDetail]);

  useEffect(() => {
    const onSyncCompleted = () => {
      void loadDetail(true);
    };
    window.addEventListener("sppg:sync-completed", onSyncCompleted);
    return () => {
      window.removeEventListener("sppg:sync-completed", onSyncCompleted);
    };
  }, [loadDetail]);

  const run = detail?.run;
  const items = detail?.items ?? [];
  const auditLogs = detail?.audit_logs ?? [];
  const status = run?.status ?? "DRAFT";

  const transitions: Transition[] = [];
  if (hasPermission(user, "payroll.run.create") && status === "DRAFT") {
    transitions.push({
      target: "SUBMITTED",
      label: "Ajukan untuk Review",
      className: "bg-sky-500 text-slate-950",
    });
  }
  if (hasPermission(user, "payroll.run.review") && status === "SUBMITTED") {
    transitions.push({
      target: "REVIEWED",
      label: "Tandai Sudah Direview",
      className: "bg-indigo-500 text-white",
    });
  }
  if (hasPermission(user, "payroll.run.approve") && status === "REVIEWED") {
    transitions.push({
      target: "APPROVED",
      label: "Setujui (Approve)",
      className: "bg-teal-500 text-slate-950",
    });
  }
  if (hasPermission(user, "payroll.run.disburse") && status === "APPROVED") {
    transitions.push({
      target: "PAID",
      label: "Tandai Dibayar & Kunci Slip",
      className: "bg-emerald-500 text-slate-950",
      warning:
        "Setelah Dibayar, slip terkunci permanen dan batch tidak dapat diubah lagi.",
    });
  }
  if (
    hasPermission(user, "payroll.run.review") &&
    (status === "SUBMITTED" || status === "REVIEWED")
  ) {
    transitions.push({
      target: "REJECTED",
      label: "Tolak Batch",
      className: "bg-rose-500 text-white",
      warning:
        "Batch yang ditolak berhenti di sini dan tidak ikut dibayarkan. Tulis alasannya di catatan agar pembuat batch tahu apa yang perlu diperbaiki.",
    });
  }

  const openTransition = (item: Transition) => {
    triggerHaptic(item.target === "REJECTED" ? "warning" : "light");
    setNotes("");
    setTransition(item);
  };

  const executeTransition = async () => {
    if (!transition || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      await transitionPayrollStatus(
        runId,
        transition.target,
        notes || undefined,
      );
      triggerHaptic("success");
      setFeedback({
        type: "success",
        message: `Status batch diubah menjadi ${runStatusLabel(transition.target)}.`,
      });
      setTransition(null);
      await loadDetail(true);
    } catch (err) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Gagal mengubah status batch.",
      });
      setTransition(null);
    } finally {
      isSubmittingRef.current = false;
      setSaving(false);
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
              router.push("/payroll/runs");
            }}
            aria-label="Kembali ke daftar batch"
            className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/5 text-slate-300 transition hover:bg-white/10 active:scale-95"
          >
            <Icon name="arrow-left" className="size-5" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate font-mono text-sm font-black text-white">
              {runId || "Batch tidak dikenal"}
            </h1>
            <p className="text-[11px] text-slate-400">
              {loading
                ? "Memuat detail..."
                : run
                  ? `${run.period_start} s.d. ${run.period_end} · ${run.total_employees} karyawan`
                  : "Batch tidak ditemukan."}
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

        {run ? (
          <div className="grid grid-cols-2 gap-2 rounded-3xl border border-white/10 bg-slate-900/80 p-3.5">
            <div className="col-span-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-400">
                Status persetujuan
              </span>
              <RunStatusBadge status={run.status} />
            </div>
            <div className="rounded-xl bg-slate-950/60 p-2.5">
              <p className="text-[10px] text-slate-500">Total kotor</p>
              <p className="font-mono text-sm font-bold text-slate-200">
                {IDR.format(run.total_gross_payout)}
              </p>
            </div>
            <div className="rounded-xl bg-slate-950/60 p-2.5">
              <p className="text-[10px] text-slate-500">Total bersih</p>
              <p className="font-mono text-sm font-bold text-emerald-400">
                {IDR.format(run.total_net_payout)}
              </p>
            </div>
            <p className="col-span-2 text-[10px] text-slate-500">
              Dibuat {run.created_by} ·{" "}
              {new Date(run.created_at).toLocaleString("id-ID")}
            </p>
          </div>
        ) : null}

        {transitions.length > 0 ? (
          <div className="flex flex-col gap-2">
            {transitions.map((item) => (
              <button
                key={item.target}
                type="button"
                onClick={() => openTransition(item)}
                disabled={saving}
                className={`min-h-11 w-full rounded-xl text-xs font-black shadow-md transition active:scale-95 disabled:opacity-50 ${item.className}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-slate-950/80 p-1">
          {(
            [
              ["items", `Rincian (${items.length})`],
              ["audit", `Audit Trail (${auditLogs.length})`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                triggerHaptic("light");
                setTab(value);
              }}
              className={`min-h-11 rounded-xl text-xs font-bold transition active:scale-95 ${
                tab === value
                  ? "bg-sky-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex flex-col gap-2">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-2xl border border-white/5 bg-slate-900/40"
              />
            ))}
          </div>
        ) : tab === "items" ? (
          items.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-8 text-center text-xs text-slate-500">
              Tidak ada rincian karyawan dalam batch ini.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-slate-900/80 p-3.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white">
                        {item.nama_karyawan}
                      </p>
                      <p className="truncate text-[11px] text-slate-400">
                        {item.divisi} · {item.id_karyawan} ·{" "}
                        <span className="font-mono">{item.ptkp_status}</span>
                      </p>
                    </div>
                    <p className="shrink-0 font-mono text-sm font-black text-emerald-400">
                      {IDR.format(item.net_salary)}
                    </p>
                  </div>
                  <dl className="grid grid-cols-3 gap-1.5 text-center text-[10px]">
                    <div className="rounded-lg bg-white/5 p-1.5">
                      <dt className="text-slate-500">Reguler</dt>
                      <dd className="font-mono font-bold text-slate-200">
                        {hours(item.total_regular_hours)}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-white/5 p-1.5">
                      <dt className="text-slate-500">Lembur</dt>
                      <dd className="font-mono font-bold text-amber-300">
                        {hours(item.total_overtime_hours)}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-white/5 p-1.5">
                      <dt className="text-slate-500">Hari libur</dt>
                      <dd className="font-mono font-bold text-rose-300">
                        {hours(item.total_holiday_hours)}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-white/5 p-1.5">
                      <dt className="text-slate-500">Gaji pokok</dt>
                      <dd className="font-mono font-bold text-slate-200">
                        {IDR.format(item.basic_salary)}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-white/5 p-1.5">
                      <dt className="text-slate-500">Potongan</dt>
                      <dd className="font-mono font-bold text-rose-300">
                        {IDR.format(
                          item.total_deductions + item.bpjs_employee_total,
                        )}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-white/5 p-1.5">
                      <dt className="text-slate-500">PPh 21</dt>
                      <dd className="font-mono font-bold text-rose-300">
                        {IDR.format(item.pph21_amount)}
                      </dd>
                    </div>
                  </dl>
                  <Link
                    href={`/payroll/slip/${encodeURIComponent(item.id)}`}
                    onClick={() => triggerHaptic("light")}
                    className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-sky-300/20 bg-sky-300/10 text-xs font-bold text-sky-200 transition active:scale-95"
                  >
                    <Icon name="document" className="size-4" />
                    Lihat slip
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : auditLogs.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-8 text-center text-xs text-slate-500">
            Belum ada riwayat audit.
          </div>
        ) : (
          <ol className="flex flex-col gap-2">
            {auditLogs.map((log) => (
              <li
                key={log.id}
                className="rounded-2xl border border-white/10 bg-slate-900/80 p-3"
              >
                <p className="text-xs font-bold text-slate-200">
                  {log.action === "CREATE_RUN"
                    ? "Batch dibuat"
                    : `Status → ${runStatusLabel(log.new_status)}`}
                </p>
                <p className="text-[11px] text-slate-400">
                  oleh {log.performed_by} ·{" "}
                  {new Date(log.created_at).toLocaleString("id-ID", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
                {log.notes ? (
                  <p className="mt-1.5 rounded-lg bg-white/5 p-2 text-[11px] italic text-slate-300">
                    {log.notes}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>

      <Modal
        isOpen={Boolean(transition)}
        onClose={() => {
          if (!saving) setTransition(null);
        }}
        title={transition ? transition.label : "Ubah status"}
        titleId="payroll-transition-title"
        maxWidth="max-w-md"
        hideFooter
      >
        {transition ? (
          <div className="flex flex-col gap-3 text-xs">
            <p className="text-sm leading-6 text-slate-300">
              Pindahkan batch <strong className="font-mono">{runId}</strong> ke
              status{" "}
              <strong className="text-sky-300">
                {runStatusLabel(transition.target)}
              </strong>
              ?
            </p>
            {transition.warning ? (
              <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-2.5 text-[11px] leading-4 text-amber-100">
                {transition.warning}
              </p>
            ) : null}
            <div>
              <label
                htmlFor="payroll-transition-notes"
                className="mb-1 block text-[11px] font-semibold text-slate-400"
              >
                Catatan / justifikasi (opsional)
              </label>
              <textarea
                id="payroll-transition-notes"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Catatan persetujuan atau alasan penolakan..."
                className="w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-2.5 text-xs text-white placeholder-slate-500 outline-none focus:border-sky-400"
              />
            </div>
            <div className="flex items-center gap-2 border-t border-white/10 pt-3">
              <button
                type="button"
                onClick={() => setTransition(null)}
                disabled={saving}
                className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/5 font-bold text-slate-300 transition active:scale-95 disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void executeTransition()}
                disabled={saving}
                className={`min-h-11 flex-1 rounded-xl font-black shadow-lg transition active:scale-95 disabled:opacity-50 ${transition.className}`}
              >
                {saving ? "Menyimpan..." : "Konfirmasi"}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </MobileAppShell>
  );
}
