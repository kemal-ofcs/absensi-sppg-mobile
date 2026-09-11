"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MobileAppShell } from "@/components/MobileAppShell";
import {
  CONFIG_INPUT_CLASS,
  CONFIG_LABEL_CLASS,
  ConfigEmptyState,
  ConfigFormModal,
  ConfigRowActions,
  ConfigSkeletonList,
  ConfirmDeleteModal,
  FROZEN_RUN_NOTE,
  IDR,
  PayrollConfigHeader,
  parseOptionalNumber,
  todayLocal,
} from "@/components/payroll/ConfigShared";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { hasPermission } from "@/lib/auth/access";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import {
  type BpjsRuleRow,
  deleteBpjsRule,
  getBpjsRules,
  saveBpjsRule,
} from "@/lib/gateways/payroll";

/*
 * Aturan iuran BPJS untuk Mobile — padanan
 * `web-desktop/src/app/payroll/config/bpjs-rules/page.tsx`.
 *
 * Siapa yang menanggung iuran ditentukan engine dari KODE saja:
 * `component_code.ends_with("_EMP")` berarti dipotong dari gaji pekerja,
 * selain itu ditanggung perusahaan (`payroll/engine.rs`). Label di halaman
 * ini memakai aturan yang sama persis — bukan tebakan dari nama program.
 *
 * Kode bersifat unik: backend menyimpan dengan `ON CONFLICT(component_code)`,
 * sehingga kode yang dikunci saat mengubah dan kode ganda saat menambah
 * dicegah di sini, sebelum backend diam-diam menimpa program lain.
 */

interface BpjsDraft {
  id: string;
  component_code: string;
  component_name: string;
  rate: string;
  wage_cap: string;
  effective_date: string;
}

function isEmployeeContribution(code: string) {
  return code.endsWith("_EMP");
}

function normalizeCode(value: string) {
  return value.toUpperCase().replace(/\s+/g, "_");
}

export default function MobileBpjsRulesPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const canManage = hasPermission(user, "payroll.config.manage");

  const [rules, setRules] = useState<BpjsRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [draft, setDraft] = useState<BpjsDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.replace("/login");
      return;
    }
    if (!hasPermission(user, "payroll.config.manage")) {
      router.replace("/payroll");
    }
  }, [authLoading, isAuthenticated, user, router]);

  const loadRules = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setRules(await getBpjsRules());
    } catch (err) {
      if (!silent) {
        setFeedback({
          type: "error",
          message:
            err instanceof Error ? err.message : "Gagal memuat aturan BPJS.",
        });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && canManage) void loadRules();
  }, [isAuthenticated, canManage, loadRules]);

  useEffect(() => {
    const onSyncCompleted = () => {
      void loadRules(true);
    };
    window.addEventListener("sppg:sync-completed", onSyncCompleted);
    return () => {
      window.removeEventListener("sppg:sync-completed", onSyncCompleted);
    };
  }, [loadRules]);

  const openAdd = () => {
    triggerHaptic("light");
    setFormError(null);
    setDraft({
      id: "",
      component_code: "",
      component_name: "",
      rate: "1",
      wage_cap: "",
      effective_date: todayLocal(),
    });
  };

  const openEdit = (rule: BpjsRuleRow) => {
    setFormError(null);
    setDraft({
      id: rule.id,
      component_code: rule.component_code,
      component_name: rule.component_name,
      rate: String(rule.rate_percentage),
      wage_cap: rule.wage_cap === null ? "" : String(rule.wage_cap),
      effective_date: rule.effective_date,
    });
  };

  const submit = async () => {
    if (!draft || isSubmittingRef.current) return;
    const code = normalizeCode(draft.component_code.trim());
    const name = draft.component_name.trim();
    const rate = Number(draft.rate);
    const wageCap = parseOptionalNumber(draft.wage_cap);

    if (!code) {
      setFormError("Kode komponen wajib diisi.");
      return;
    }
    if (!draft.id) {
      const clash = rules.find((r) => r.component_code === code);
      if (clash) {
        setFormError(
          `Kode ${code} sudah dipakai program "${clash.component_name}". Ubah baris itu, atau pakai kode lain.`,
        );
        return;
      }
    }
    if (!name) {
      setFormError("Nama program wajib diisi.");
      return;
    }
    if (
      draft.rate.trim() === "" ||
      !Number.isFinite(rate) ||
      rate < 0 ||
      rate > 100
    ) {
      setFormError("Tarif iuran harus di antara 0 dan 100%.");
      return;
    }
    // `wage_cap` bertipe i64 di Rust: pecahan ditolak saat deserialisasi.
    if (wageCap !== null && (!Number.isInteger(wageCap) || wageCap <= 0)) {
      setFormError(
        "Plafon upah harus bilangan bulat rupiah lebih dari 0, atau dikosongkan untuk tanpa plafon.",
      );
      return;
    }
    if (!draft.effective_date) {
      setFormError("Tanggal berlaku wajib diisi.");
      return;
    }

    isSubmittingRef.current = true;
    setSaving(true);
    setFormError(null);
    try {
      await saveBpjsRule({
        id: draft.id,
        component_code: code,
        component_name: name,
        rate_percentage: rate,
        wage_cap: wageCap,
        effective_date: draft.effective_date,
      });
      triggerHaptic("success");
      setDraft(null);
      setFeedback({
        type: "success",
        message: "Program BPJS berhasil disimpan.",
      });
      await loadRules(true);
    } catch (err) {
      triggerHaptic("error");
      setFormError(
        err instanceof Error ? err.message : "Gagal menyimpan aturan BPJS.",
      );
    } finally {
      isSubmittingRef.current = false;
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSaving(true);
    try {
      await deleteBpjsRule(deleteTarget.id);
      triggerHaptic("success");
      setFeedback({
        type: "success",
        message: `Program BPJS ${deleteTarget.label} berhasil dihapus.`,
      });
      await loadRules(true);
    } catch (err) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Gagal menghapus aturan BPJS.",
      });
    } finally {
      setDeleteTarget(null);
      isSubmittingRef.current = false;
      setSaving(false);
    }
  };

  if (authLoading || !isAuthenticated || !canManage) {
    return <div className="min-h-dvh bg-slate-950" />;
  }

  const draftCode = draft ? normalizeCode(draft.component_code.trim()) : "";

  return (
    <MobileAppShell>
      <div className="flex flex-col gap-4 text-slate-100">
        <PayrollConfigHeader
          title="Aturan BPJS"
          subtitle="Tarif iuran pekerja/perusahaan & plafon upah"
          backHref="/payroll/config"
          backLabel="Kembali ke Konfigurasi Penggajian"
          loading={loading}
          onReload={() => void loadRules()}
        />

        {feedback ? (
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            onClose={() => setFeedback(null)}
          />
        ) : null}

        <button
          type="button"
          onClick={openAdd}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 text-sm font-black text-slate-950 shadow-lg transition hover:bg-sky-400 active:scale-95"
        >
          <Icon name="plus" className="size-5" />
          Tambah Program BPJS
        </button>

        {loading ? (
          <ConfigSkeletonList count={4} />
        ) : rules.length === 0 ? (
          <ConfigEmptyState>Belum ada aturan program BPJS.</ConfigEmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {rules.map((rule) => {
              const employee = isEmployeeContribution(rule.component_code);
              return (
                <li
                  key={rule.id || rule.component_code}
                  className="rounded-2xl border border-white/10 bg-slate-900/80 p-3.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white">
                        {rule.component_name}
                      </p>
                      <p className="truncate font-mono text-[11px] font-bold text-sky-300">
                        {rule.component_code}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-md border border-white/10 bg-slate-950/60 px-2 py-0.5 font-mono text-sm font-black text-sky-300">
                      {rule.rate_percentage}%
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span
                      className={`rounded-md border px-2 py-0.5 font-bold ${
                        employee
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                          : "border-indigo-500/30 bg-indigo-500/10 text-indigo-300"
                      }`}
                    >
                      {employee ? "Pekerja (potong gaji)" : "Perusahaan"}
                    </span>
                    <span className="rounded-md border border-white/10 bg-slate-950/60 px-2 py-0.5 font-mono text-slate-400">
                      Plafon{" "}
                      {rule.wage_cap !== null
                        ? IDR.format(rule.wage_cap)
                        : "tanpa batas"}
                    </span>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <p className="font-mono text-[10px] text-slate-500">
                      berlaku {rule.effective_date || "-"}
                    </p>
                    <ConfigRowActions
                      deleteLabel={`Hapus program BPJS ${rule.component_name}`}
                      onEdit={() => openEdit(rule)}
                      onDelete={() =>
                        setDeleteTarget({
                          id: rule.id || rule.component_code,
                          label: `${rule.component_name} (${rule.component_code})`,
                        })
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ConfigFormModal
        isOpen={Boolean(draft)}
        title={draft?.id ? "Ubah Program BPJS" : "Tambah Program BPJS"}
        titleId="payroll-bpjs-rule-title"
        error={formError}
        saving={saving}
        submitLabel="Simpan Program"
        onDismissError={() => setFormError(null)}
        onClose={() => setDraft(null)}
        onSubmit={() => void submit()}
      >
        {draft ? (
          <>
            <div>
              <label htmlFor="bpjs-code" className={CONFIG_LABEL_CLASS}>
                Kode komponen (unik)
              </label>
              <input
                id="bpjs-code"
                type="text"
                autoCapitalize="characters"
                required
                disabled={Boolean(draft.id)}
                placeholder="misal: JHT_EMP, BPJS_KES_CO"
                value={draft.component_code}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          component_code: normalizeCode(event.target.value),
                        }
                      : prev,
                  )
                }
                className={`${CONFIG_INPUT_CLASS} font-mono uppercase`}
              />
              <p className="mt-1 text-[10px] leading-4 text-slate-500">
                {draft.id
                  ? "Kode dikunci saat mengubah. Untuk kode lain, tambahkan program baru."
                  : "Akhiri dengan _EMP untuk iuran yang dipotong dari gaji pekerja."}
                {draftCode ? (
                  <>
                    {" "}
                    Ditanggung:{" "}
                    <strong className="text-slate-300">
                      {isEmployeeContribution(draftCode)
                        ? "pekerja"
                        : "perusahaan"}
                    </strong>
                    .
                  </>
                ) : null}
              </p>
            </div>

            <div>
              <label htmlFor="bpjs-name" className={CONFIG_LABEL_CLASS}>
                Nama program
              </label>
              <input
                id="bpjs-name"
                type="text"
                required
                placeholder="misal: JHT Pekerja 2%"
                value={draft.component_name}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? { ...prev, component_name: event.target.value }
                      : prev,
                  )
                }
                className={CONFIG_INPUT_CLASS}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="bpjs-rate" className={CONFIG_LABEL_CLASS}>
                  Tarif iuran (%)
                </label>
                <input
                  id="bpjs-rate"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step={0.01}
                  required
                  value={draft.rate}
                  onChange={(event) =>
                    setDraft((prev) =>
                      prev ? { ...prev, rate: event.target.value } : prev,
                    )
                  }
                  className={`${CONFIG_INPUT_CLASS} font-mono font-bold text-sky-300`}
                />
              </div>
              <div>
                <label htmlFor="bpjs-wage-cap" className={CONFIG_LABEL_CLASS}>
                  Plafon upah (Rp)
                </label>
                <input
                  id="bpjs-wage-cap"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  placeholder="Tanpa plafon"
                  value={draft.wage_cap}
                  onChange={(event) =>
                    setDraft((prev) =>
                      prev ? { ...prev, wage_cap: event.target.value } : prev,
                    )
                  }
                  className={`${CONFIG_INPUT_CLASS} font-mono`}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="bpjs-effective-date"
                className={CONFIG_LABEL_CLASS}
              >
                Tanggal berlaku
              </label>
              <input
                id="bpjs-effective-date"
                type="date"
                required
                value={draft.effective_date}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? { ...prev, effective_date: event.target.value }
                      : prev,
                  )
                }
                className={`${CONFIG_INPUT_CLASS} font-mono`}
              />
            </div>
          </>
        ) : null}
      </ConfigFormModal>

      <ConfirmDeleteModal
        label={deleteTarget?.label ?? null}
        note={FROZEN_RUN_NOTE}
        titleId="payroll-bpjs-delete-title"
        busy={saving}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </MobileAppShell>
  );
}
