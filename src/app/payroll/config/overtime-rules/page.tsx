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
  PayrollConfigHeader,
  parseOptionalNumber,
} from "@/components/payroll/ConfigShared";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { hasPermission } from "@/lib/auth/access";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import {
  deleteOvertimeRule,
  getOvertimeRules,
  type OvertimeTierRuleRow,
  saveOvertimeRule,
} from "@/lib/gateways/payroll";

/*
 * Aturan jenjang lembur (PP 35/2021) untuk Mobile — padanan
 * `web-desktop/src/app/payroll/config/overtime-rules/page.tsx`.
 *
 * Cara engine memakainya (`payroll/engine.rs::calculate_overtime_index`):
 * tier aktif dibaca urut `tier_order`, masing-masing menampung
 * `hour_end − hour_start` jam lembur (tanpa batas bila `hour_end` kosong)
 * dikali `multiplier`. Tier dengan `hour_end ≤ hour_start` DILEWATI tanpa
 * pesan apa pun — karena itu form ini menolaknya sejak awal.
 *
 * Tampilan jam mengikuti Web: `hour_start` disimpan 0-based sehingga
 * ditampilkan "Jam ke-(hour_start + 1)", sedangkan `hour_end` apa adanya.
 */

type RuleType = "HARI_KERJA" | "HARI_LIBUR";

const RULE_SECTIONS: Array<{
  type: RuleType;
  title: string;
  description: string;
  dot: string;
  badge: string;
}> = [
  {
    type: "HARI_KERJA",
    title: "Hari Kerja Biasa",
    description: "Lembur pada hari kerja setelah jam kerja shift normal.",
    dot: "bg-sky-400",
    badge: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  },
  {
    type: "HARI_LIBUR",
    title: "Hari Libur & Istirahat Mingguan",
    description:
      "Seluruh jam kerja pada tanggal merah terdaftar (Jam Kerja Hari Libur).",
    dot: "bg-amber-400",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  },
];

interface TierDraft {
  id: string;
  rule_type: RuleType;
  tier_order: string;
  /** Ditampilkan 1-based ("Jam ke-"), disimpan 0-based. */
  start_display: string;
  hour_end: string;
  multiplier: string;
  is_active: number;
}

function describeRange(rule: OvertimeTierRuleRow) {
  return `Jam ke-${rule.hour_start + 1}${
    rule.hour_end ? ` s.d. jam ke-${rule.hour_end}` : " dan seterusnya"
  }`;
}

export default function MobileOvertimeRulesPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const canManage = hasPermission(user, "payroll.config.manage");

  const [rules, setRules] = useState<OvertimeTierRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [draft, setDraft] = useState<TierDraft | null>(null);
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
      setRules(await getOvertimeRules());
    } catch (err) {
      if (!silent) {
        setFeedback({
          type: "error",
          message:
            err instanceof Error ? err.message : "Gagal memuat aturan lembur.",
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

  const openAdd = (ruleType: RuleType) => {
    triggerHaptic("light");
    // Usulan awal sama dengan Web: tier berikutnya mulai dari akhir tier terakhir.
    const existing = rules.filter((r) => r.rule_type === ruleType);
    const nextOrder =
      existing.length > 0
        ? Math.max(...existing.map((e) => e.tier_order)) + 1
        : 1;
    const lastTier = existing.find((e) => e.tier_order === nextOrder - 1);
    const startHour =
      lastTier?.hour_end ??
      (existing.length > 0 ? (lastTier?.hour_start ?? 0) + 1 : 0);
    setFormError(null);
    setDraft({
      id: "",
      rule_type: ruleType,
      tier_order: String(nextOrder),
      start_display: String(startHour + 1),
      hour_end: "",
      multiplier: ruleType === "HARI_KERJA" ? "2" : "3",
      is_active: 1,
    });
  };

  const openEdit = (rule: OvertimeTierRuleRow) => {
    setFormError(null);
    setDraft({
      id: rule.id,
      rule_type: rule.rule_type,
      tier_order: String(rule.tier_order),
      start_display: String(rule.hour_start + 1),
      hour_end: rule.hour_end === null ? "" : String(rule.hour_end),
      multiplier: String(rule.multiplier),
      is_active: rule.is_active,
    });
  };

  const submit = async () => {
    if (!draft || isSubmittingRef.current) return;
    const tierOrder = Number(draft.tier_order);
    const startDisplay = Number(draft.start_display);
    const hourEnd = parseOptionalNumber(draft.hour_end);
    const multiplier = Number(draft.multiplier);

    // `tier_order` bertipe i64 di Rust: pecahan ditolak saat deserialisasi.
    if (!Number.isInteger(tierOrder) || tierOrder < 1) {
      setFormError("Nomor urut tier harus bilangan bulat mulai 1.");
      return;
    }
    if (
      rules.some(
        (r) =>
          r.rule_type === draft.rule_type &&
          r.tier_order === tierOrder &&
          r.id !== draft.id,
      )
    ) {
      setFormError(
        `Tier ${tierOrder} sudah ada untuk jenis hari ini. Pakai nomor lain atau ubah tier tersebut.`,
      );
      return;
    }
    if (!Number.isFinite(startDisplay) || startDisplay < 1) {
      setFormError("Jam mulai minimal jam ke-1.");
      return;
    }
    const hourStart = startDisplay - 1;
    if (
      hourEnd !== null &&
      (!Number.isFinite(hourEnd) || hourEnd <= hourStart)
    ) {
      setFormError(
        `Jam akhir harus lebih besar dari ${hourStart}. Tier yang rentangnya kosong dilewati engine tanpa pesan.`,
      );
      return;
    }
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      setFormError("Pengali harus angka lebih dari 0.");
      return;
    }

    isSubmittingRef.current = true;
    setSaving(true);
    setFormError(null);
    try {
      await saveOvertimeRule({
        id: draft.id,
        rule_type: draft.rule_type,
        tier_order: tierOrder,
        hour_start: hourStart,
        hour_end: hourEnd,
        multiplier,
        is_active: draft.is_active,
      });
      triggerHaptic("success");
      setDraft(null);
      setFeedback({
        type: "success",
        message: "Jenjang lembur berhasil disimpan.",
      });
      await loadRules(true);
    } catch (err) {
      triggerHaptic("error");
      setFormError(
        err instanceof Error ? err.message : "Gagal menyimpan jenjang lembur.",
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
      await deleteOvertimeRule(deleteTarget.id);
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
          err instanceof Error
            ? err.message
            : "Gagal menghapus jenjang lembur.",
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

  const draftHourStart = draft ? Number(draft.start_display) - 1 : 0;

  return (
    <MobileAppShell>
      <div className="flex flex-col gap-4 text-slate-100">
        <PayrollConfigHeader
          title="Jenjang Lembur"
          subtitle="PP 35/2021 — pengali upah lembur per jam"
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

        {RULE_SECTIONS.map((section) => {
          const sectionRules = rules.filter(
            (r) => r.rule_type === section.type,
          );
          return (
            <section
              key={section.type}
              aria-labelledby={`overtime-${section.type}`}
              className="flex flex-col gap-2.5 rounded-2xl border border-white/10 bg-slate-900/60 p-3.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2
                    id={`overtime-${section.type}`}
                    className="flex items-center gap-2 text-sm font-bold text-white"
                  >
                    <span className={`size-2.5 rounded-full ${section.dot}`} />
                    {section.title}
                  </h2>
                  <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
                    {section.description}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openAdd(section.type)}
                  aria-label={`Tambah tier ${section.title}`}
                  className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-500 text-slate-950 shadow-lg transition hover:bg-sky-400 active:scale-95"
                >
                  <Icon name="plus" className="size-5" />
                </button>
              </div>

              {loading ? (
                <ConfigSkeletonList count={2} />
              ) : sectionRules.length === 0 ? (
                <ConfigEmptyState>
                  Belum ada tier lembur untuk jenis hari ini.
                </ConfigEmptyState>
              ) : (
                <ul className="flex flex-col gap-2">
                  {sectionRules.map((rule) => (
                    <li
                      key={rule.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/60 p-3"
                    >
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-white">
                          Tier {rule.tier_order}
                          <span
                            className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-black ${section.badge}`}
                          >
                            {rule.multiplier}× upah
                          </span>
                          {rule.is_active === 0 ? (
                            <span className="rounded-md border border-white/15 bg-slate-500/15 px-1.5 py-0.5 text-[10px] font-bold text-slate-400">
                              Nonaktif
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {describeRange(rule)}
                        </p>
                      </div>
                      <ConfigRowActions
                        deleteLabel={`Hapus tier ${rule.tier_order} ${section.title}`}
                        onEdit={() => openEdit(rule)}
                        onDelete={() =>
                          setDeleteTarget({
                            id: rule.id,
                            label: `Tier ${rule.tier_order} ${section.title}`,
                          })
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <ConfigFormModal
        isOpen={Boolean(draft)}
        title={draft?.id ? "Ubah Jenjang Lembur" : "Tambah Jenjang Lembur"}
        titleId="payroll-overtime-tier-title"
        error={formError}
        saving={saving}
        submitLabel="Simpan Jenjang"
        onDismissError={() => setFormError(null)}
        onClose={() => setDraft(null)}
        onSubmit={() => void submit()}
      >
        {draft ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="overtime-rule-type"
                  className={CONFIG_LABEL_CLASS}
                >
                  Jenis hari
                </label>
                <select
                  id="overtime-rule-type"
                  value={draft.rule_type}
                  onChange={(event) =>
                    setDraft((prev) =>
                      prev
                        ? { ...prev, rule_type: event.target.value as RuleType }
                        : prev,
                    )
                  }
                  className={CONFIG_INPUT_CLASS}
                >
                  <option value="HARI_KERJA">Hari kerja</option>
                  <option value="HARI_LIBUR">Hari libur</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="overtime-tier-order"
                  className={CONFIG_LABEL_CLASS}
                >
                  Nomor urut tier
                </label>
                <input
                  id="overtime-tier-order"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  required
                  value={draft.tier_order}
                  onChange={(event) =>
                    setDraft((prev) =>
                      prev ? { ...prev, tier_order: event.target.value } : prev,
                    )
                  }
                  className={`${CONFIG_INPUT_CLASS} font-mono`}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="overtime-hour-start"
                  className={CONFIG_LABEL_CLASS}
                >
                  Mulai jam ke-
                </label>
                <input
                  id="overtime-hour-start"
                  type="number"
                  inputMode="decimal"
                  min={1}
                  step={0.5}
                  required
                  value={draft.start_display}
                  onChange={(event) =>
                    setDraft((prev) =>
                      prev
                        ? { ...prev, start_display: event.target.value }
                        : prev,
                    )
                  }
                  className={`${CONFIG_INPUT_CLASS} font-mono`}
                />
              </div>
              <div>
                <label
                  htmlFor="overtime-hour-end"
                  className={CONFIG_LABEL_CLASS}
                >
                  Sampai jam ke- (opsional)
                </label>
                <input
                  id="overtime-hour-end"
                  type="number"
                  inputMode="decimal"
                  step={0.5}
                  placeholder="Tanpa batas"
                  value={draft.hour_end}
                  onChange={(event) =>
                    setDraft((prev) =>
                      prev ? { ...prev, hour_end: event.target.value } : prev,
                    )
                  }
                  className={`${CONFIG_INPUT_CLASS} font-mono`}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="overtime-multiplier"
                className={CONFIG_LABEL_CLASS}
              >
                Pengali indeks (× upah per jam)
              </label>
              <input
                id="overtime-multiplier"
                type="number"
                inputMode="decimal"
                min={0.1}
                step={0.1}
                required
                value={draft.multiplier}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev ? { ...prev, multiplier: event.target.value } : prev,
                  )
                }
                className={`${CONFIG_INPUT_CLASS} font-mono font-bold text-sky-300`}
              />
            </div>

            <p className="rounded-xl border border-white/10 bg-slate-950/60 p-2.5 text-[11px] leading-4 text-slate-400">
              {Number.isFinite(draftHourStart) && draftHourStart >= 0
                ? `Tier ini menampung lembur ${
                    draft.hour_end.trim() === ""
                      ? `mulai jam ke-${draftHourStart + 1} dan seterusnya`
                      : `${Math.max(0, Number(draft.hour_end) - draftHourStart)} jam (jam ke-${draftHourStart + 1} s.d. ${draft.hour_end})`
                  }.`
                : "Isi jam mulai untuk melihat rentang tier."}
            </p>
          </>
        ) : null}
      </ConfigFormModal>

      <ConfirmDeleteModal
        label={deleteTarget?.label ?? null}
        note={FROZEN_RUN_NOTE}
        titleId="payroll-overtime-delete-title"
        busy={saving}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </MobileAppShell>
  );
}
