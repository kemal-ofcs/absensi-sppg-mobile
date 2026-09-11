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
  deleteTaxRule,
  getTaxRules,
  saveTaxRule,
  type TaxRuleRow,
} from "@/lib/gateways/payroll";

/*
 * Lapisan tarif PPh 21 (Pasal 17 & TER A/B/C) untuk Mobile — padanan
 * `web-desktop/src/app/payroll/config/tax-rules/page.tsx`.
 *
 * `bracket_min`/`bracket_max` bertipe i64 di Rust, jadi form ini hanya
 * menerima bilangan bulat rupiah.
 */

type TaxCategory = TaxRuleRow["category"];

const CATEGORIES: Array<{
  value: TaxCategory;
  title: string;
  scope: string;
  period: string;
  accent: string;
}> = [
  {
    value: "PASAL_17",
    title: "Pasal 17",
    scope: "Tarif progresif tahunan",
    period: "Rekonsiliasi Desember",
    accent: "border-amber-500 text-amber-300",
  },
  {
    value: "TER_A",
    title: "TER A",
    scope: "TK/0, TK/1, K/0",
    period: "Bulanan Jan–Nov",
    accent: "border-sky-500 text-sky-300",
  },
  {
    value: "TER_B",
    title: "TER B",
    scope: "TK/2, TK/3, K/1, K/2",
    period: "Bulanan Jan–Nov",
    accent: "border-indigo-500 text-indigo-300",
  },
  {
    value: "TER_C",
    title: "TER C",
    scope: "K/3",
    period: "Bulanan Jan–Nov",
    accent: "border-emerald-500 text-emerald-300",
  },
];

interface TaxDraft {
  id: string;
  category: TaxCategory;
  bracket_min: string;
  bracket_max: string;
  rate: string;
  effective_date: string;
}

export default function MobileTaxRulesPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const canManage = hasPermission(user, "payroll.config.manage");

  const [rules, setRules] = useState<TaxRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<TaxCategory>("TER_A");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [draft, setDraft] = useState<TaxDraft | null>(null);
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
      setRules(await getTaxRules());
    } catch (err) {
      if (!silent) {
        setFeedback({
          type: "error",
          message:
            err instanceof Error
              ? err.message
              : "Gagal memuat aturan pajak PPh 21.",
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

  const categoryRules = rules.filter((r) => r.category === activeCategory);

  const openAdd = () => {
    triggerHaptic("light");
    // Usulan awal sama dengan Web: lapisan baru mulai tepat setelah batas
    // atas lapisan terakhir (daftar sudah terurut `bracket_min`).
    const last = categoryRules[categoryRules.length - 1];
    const minValue = last?.bracket_max ? last.bracket_max + 1 : 0;
    setFormError(null);
    setDraft({
      id: "",
      category: activeCategory,
      bracket_min: String(minValue),
      bracket_max: "",
      rate: "5",
      effective_date: todayLocal(),
    });
  };

  const openEdit = (rule: TaxRuleRow) => {
    setFormError(null);
    setDraft({
      id: rule.id,
      category: rule.category,
      bracket_min: String(rule.bracket_min),
      bracket_max: rule.bracket_max === null ? "" : String(rule.bracket_max),
      rate: String(rule.rate_percentage),
      effective_date: rule.effective_date,
    });
  };

  const submit = async () => {
    if (!draft || isSubmittingRef.current) return;
    const bracketMin = Number(draft.bracket_min);
    const bracketMax = parseOptionalNumber(draft.bracket_max);
    const rate = Number(draft.rate);

    if (!Number.isInteger(bracketMin) || bracketMin < 0) {
      setFormError("Batas bawah harus bilangan bulat rupiah, 0 atau lebih.");
      return;
    }
    if (
      bracketMax !== null &&
      (!Number.isInteger(bracketMax) || bracketMax <= bracketMin)
    ) {
      setFormError(
        "Batas atas harus bilangan bulat rupiah yang lebih besar dari batas bawah, atau dikosongkan untuk tanpa batas.",
      );
      return;
    }
    if (
      draft.rate.trim() === "" ||
      !Number.isFinite(rate) ||
      rate < 0 ||
      rate > 100
    ) {
      setFormError("Tarif pajak harus di antara 0 dan 100%.");
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
      await saveTaxRule({
        id: draft.id,
        category: draft.category,
        bracket_min: bracketMin,
        bracket_max: bracketMax,
        rate_percentage: rate,
        effective_date: draft.effective_date,
      });
      triggerHaptic("success");
      setActiveCategory(draft.category);
      setDraft(null);
      setFeedback({
        type: "success",
        message: "Lapisan tarif pajak berhasil disimpan.",
      });
      await loadRules(true);
    } catch (err) {
      triggerHaptic("error");
      setFormError(
        err instanceof Error ? err.message : "Gagal menyimpan tarif pajak.",
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
      await deleteTaxRule(deleteTarget.id);
      triggerHaptic("success");
      setFeedback({
        type: "success",
        message: `${deleteTarget.label} berhasil dihapus.`,
      });
      await loadRules(true);
    } catch (err) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Gagal menghapus lapisan pajak.",
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

  const active = CATEGORIES.find((c) => c.value === activeCategory);

  return (
    <MobileAppShell>
      <div className="flex flex-col gap-4 text-slate-100">
        <PayrollConfigHeader
          title="Aturan PPh 21"
          subtitle="PMK 168/2023 (TER) & UU HPP (Pasal 17)"
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

        <div className="grid grid-cols-2 gap-2">
          {CATEGORIES.map((category) => {
            const selected = category.value === activeCategory;
            const count = rules.filter(
              (r) => r.category === category.value,
            ).length;
            return (
              <button
                key={category.value}
                type="button"
                onClick={() => {
                  triggerHaptic("light");
                  setActiveCategory(category.value);
                }}
                aria-pressed={selected}
                className={`rounded-2xl border p-3 text-left transition active:scale-[0.98] ${
                  selected
                    ? `bg-slate-900 ${category.accent}`
                    : "border-white/10 bg-slate-900/50 text-slate-400"
                }`}
              >
                <span className="flex items-center justify-between text-xs font-black uppercase">
                  {category.title}
                  <span className="font-mono text-[10px] text-slate-500">
                    {count}
                  </span>
                </span>
                <span className="mt-1 block text-[11px] font-medium text-slate-300">
                  {category.scope}
                </span>
                <span className="block text-[10px] text-slate-500">
                  {category.period}
                </span>
              </button>
            );
          })}
        </div>

        <section
          aria-labelledby="tax-bracket-heading"
          className="flex flex-col gap-2.5 rounded-2xl border border-white/10 bg-slate-900/60 p-3.5"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2
                id="tax-bracket-heading"
                className="text-sm font-bold text-white"
              >
                Lapisan tarif {active?.title}
              </h2>
              <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
                Penghasilan bruto dipetakan ke lapisan yang sesuai.
              </p>
            </div>
            <button
              type="button"
              onClick={openAdd}
              aria-label={`Tambah lapisan ${active?.title ?? ""}`}
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-500 text-slate-950 shadow-lg transition hover:bg-sky-400 active:scale-95"
            >
              <Icon name="plus" className="size-5" />
            </button>
          </div>

          {loading ? (
            <ConfigSkeletonList />
          ) : categoryRules.length === 0 ? (
            <ConfigEmptyState>
              Belum ada lapisan tarif untuk kategori ini.
            </ConfigEmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {categoryRules.map((rule, index) => (
                <li
                  key={rule.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/60 p-3"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold text-slate-100">
                      {IDR.format(rule.bracket_min)}
                      {" – "}
                      {rule.bracket_max !== null
                        ? IDR.format(rule.bracket_max)
                        : "tanpa batas"}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span className="rounded-md border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 font-mono font-black text-sky-300">
                        {rule.rate_percentage}%
                      </span>
                      <span className="font-mono text-slate-500">
                        berlaku {rule.effective_date}
                      </span>
                    </p>
                  </div>
                  <ConfigRowActions
                    deleteLabel={`Hapus lapisan ${index + 1} ${rule.category}`}
                    onEdit={() => openEdit(rule)}
                    onDelete={() =>
                      setDeleteTarget({
                        id: rule.id,
                        label: `${rule.category} lapis ${index + 1} (${rule.rate_percentage}%)`,
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ConfigFormModal
        isOpen={Boolean(draft)}
        title={draft?.id ? "Ubah Lapisan Pajak" : "Tambah Lapisan Pajak"}
        titleId="payroll-tax-rule-title"
        error={formError}
        saving={saving}
        submitLabel="Simpan Lapisan"
        onDismissError={() => setFormError(null)}
        onClose={() => setDraft(null)}
        onSubmit={() => void submit()}
      >
        {draft ? (
          <>
            <div>
              <label htmlFor="tax-category" className={CONFIG_LABEL_CLASS}>
                Kategori pajak
              </label>
              <select
                id="tax-category"
                value={draft.category}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? { ...prev, category: event.target.value as TaxCategory }
                      : prev,
                  )
                }
                className={CONFIG_INPUT_CLASS}
              >
                <option value="PASAL_17">Pasal 17 UU HPP (tahunan)</option>
                <option value="TER_A">TER kategori A (bulanan)</option>
                <option value="TER_B">TER kategori B (bulanan)</option>
                <option value="TER_C">TER kategori C (bulanan)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="tax-bracket-min" className={CONFIG_LABEL_CLASS}>
                  Bruto min (Rp)
                </label>
                <input
                  id="tax-bracket-min"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  required
                  value={draft.bracket_min}
                  onChange={(event) =>
                    setDraft((prev) =>
                      prev
                        ? { ...prev, bracket_min: event.target.value }
                        : prev,
                    )
                  }
                  className={`${CONFIG_INPUT_CLASS} font-mono`}
                />
              </div>
              <div>
                <label htmlFor="tax-bracket-max" className={CONFIG_LABEL_CLASS}>
                  Bruto max (Rp)
                </label>
                <input
                  id="tax-bracket-max"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  placeholder="Tanpa batas"
                  value={draft.bracket_max}
                  onChange={(event) =>
                    setDraft((prev) =>
                      prev
                        ? { ...prev, bracket_max: event.target.value }
                        : prev,
                    )
                  }
                  className={`${CONFIG_INPUT_CLASS} font-mono`}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="tax-rate" className={CONFIG_LABEL_CLASS}>
                  Tarif (%)
                </label>
                <input
                  id="tax-rate"
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
                <label
                  htmlFor="tax-effective-date"
                  className={CONFIG_LABEL_CLASS}
                >
                  Tanggal berlaku
                </label>
                <input
                  id="tax-effective-date"
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
            </div>
          </>
        ) : null}
      </ConfigFormModal>

      <ConfirmDeleteModal
        label={deleteTarget?.label ?? null}
        note={FROZEN_RUN_NOTE}
        titleId="payroll-tax-delete-title"
        busy={saving}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </MobileAppShell>
  );
}
