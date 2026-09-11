"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  todayLocal,
} from "@/components/payroll/ConfigShared";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { hasPermission } from "@/lib/auth/access";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import { getDaftarKaryawan } from "@/lib/gateways/employee";
import {
  deletePayrollComponent,
  deleteSalaryConfig,
  getPayrollComponents,
  getSalaryConfigs,
  type PayrollComponentRow,
  type SalaryConfigRow,
  savePayrollComponent,
  saveSalaryConfig,
} from "@/lib/gateways/payroll";

/*
 * Konfigurasi penggajian untuk Mobile — padanan
 * `web-desktop/src/app/payroll/config/page.tsx`: rate gaji per jam tiap
 * karyawan dan komponen tunjangan/potongan, plus pintu ke tiga sub-halaman
 * aturan (lembur, PPh 21, BPJS).
 *
 * Penyimpanannya memakai command `desktop_*` dari modul `payroll_admin`
 * (SALINAN modul Desktop), yang menuntut `payroll.config.manage` — izin yang
 * sama dipakai gerbang halaman ini.
 */

const PTKP_OPTIONS = [
  { value: "TK/0", label: "TK/0 (Lajang 0 Tanggungan)" },
  { value: "TK/1", label: "TK/1 (Lajang 1 Tanggungan)" },
  { value: "TK/2", label: "TK/2 (Lajang 2 Tanggungan)" },
  { value: "TK/3", label: "TK/3 (Lajang 3 Tanggungan)" },
  { value: "K/0", label: "K/0 (Kawin 0 Tanggungan)" },
  { value: "K/1", label: "K/1 (Kawin 1 Tanggungan)" },
  { value: "K/2", label: "K/2 (Kawin 2 Tanggungan)" },
  { value: "K/3", label: "K/3 (Kawin 3 Tanggungan)" },
];

const RULE_LINKS = [
  {
    href: "/payroll/config/overtime-rules",
    title: "Jenjang Lembur PP 35/2021",
    subtitle: "Pengali Hari Kerja vs Hari Libur",
  },
  {
    href: "/payroll/config/tax-rules",
    title: "PPh 21 (TER & Pasal 17)",
    subtitle: "Tarif Efektif PMK 168/2023 & UU HPP",
  },
  {
    href: "/payroll/config/bpjs-rules",
    title: "Aturan Iuran BPJS",
    subtitle: "JHT, JP, JKK, JKM, BPJS Kesehatan",
  },
];

interface SalaryDraft {
  id: string;
  id_karyawan: string;
  rate: string;
  ptkp_status: string;
  effective_date: string;
}

interface ComponentDraft {
  id: string;
  name: string;
  category: "ALLOWANCE" | "DEDUCTION";
  calc_type: "FIXED" | "PERCENTAGE";
  value: string;
  applies_to: string;
  is_active: number;
}

type DeleteTarget =
  | { kind: "salary"; id: string; label: string }
  | { kind: "component"; id: string; label: string };

export default function MobilePayrollConfigPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const canManage = hasPermission(user, "payroll.config.manage");

  const [activeTab, setActiveTab] = useState<"salary" | "components">("salary");
  const [salaryConfigs, setSalaryConfigs] = useState<SalaryConfigRow[]>([]);
  const [components, setComponents] = useState<PayrollComponentRow[]>([]);
  const [employees, setEmployees] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const [salaryDraft, setSalaryDraft] = useState<SalaryDraft | null>(null);
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [componentDraft, setComponentDraft] = useState<ComponentDraft | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.replace("/login");
      return;
    }
    // Sama seperti Web: tanpa izin kelola, kembali ke dashboard Payroll.
    if (!hasPermission(user, "payroll.config.manage")) {
      router.replace("/payroll");
    }
  }, [authLoading, isAuthenticated, user, router]);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [configs, comps, empList] = await Promise.all([
        getSalaryConfigs(),
        getPayrollComponents(),
        getDaftarKaryawan(),
      ]);
      setSalaryConfigs(configs);
      setComponents(comps);
      setEmployees(empList);
    } catch (err) {
      if (!silent) {
        setFeedback({
          type: "error",
          message:
            err instanceof Error
              ? err.message
              : "Gagal memuat konfigurasi penggajian.",
        });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && canManage) void loadData();
  }, [isAuthenticated, canManage, loadData]);

  useEffect(() => {
    const onSyncCompleted = () => {
      void loadData(true);
    };
    window.addEventListener("sppg:sync-completed", onSyncCompleted);
    return () => {
      window.removeEventListener("sppg:sync-completed", onSyncCompleted);
    };
  }, [loadData]);

  const employeeNames = useMemo(() => {
    const map = new Map<string, { nama: string; divisi: string }>();
    for (const emp of employees) {
      map.set(String(emp.id_unik), {
        nama: String(emp.nama ?? ""),
        divisi: emp.divisi ? String(emp.divisi) : "",
      });
    }
    return map;
  }, [employees]);

  const today = todayLocal();

  const filteredConfigs = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return salaryConfigs;
    return salaryConfigs.filter((cfg) => {
      const nama = employeeNames.get(cfg.id_karyawan)?.nama ?? "";
      return (
        nama.toLowerCase().includes(keyword) ||
        cfg.id_karyawan.toLowerCase().includes(keyword)
      );
    });
  }, [salaryConfigs, search, employeeNames]);

  const pickerEmployees = useMemo(() => {
    const keyword = employeeFilter.trim().toLowerCase();
    if (!keyword) return employees;
    return employees.filter(
      (emp) =>
        String(emp.nama ?? "")
          .toLowerCase()
          .includes(keyword) ||
        String(emp.id_unik ?? "")
          .toLowerCase()
          .includes(keyword),
    );
  }, [employees, employeeFilter]);

  const openNewSalary = () => {
    triggerHaptic("light");
    setFormError(null);
    setEmployeeFilter("");
    setSalaryDraft({
      id: "",
      id_karyawan: "",
      rate: "25000",
      ptkp_status: "TK/0",
      effective_date: today,
    });
  };

  const openEditSalary = (cfg: SalaryConfigRow) => {
    setFormError(null);
    setEmployeeFilter("");
    setSalaryDraft({
      id: cfg.id,
      id_karyawan: cfg.id_karyawan,
      rate: String(cfg.rate_per_hour),
      ptkp_status: cfg.ptkp_status || "TK/0",
      effective_date: cfg.effective_date,
    });
  };

  const submitSalary = async () => {
    if (!salaryDraft || isSubmittingRef.current) return;
    const rate = Number(salaryDraft.rate);
    if (!salaryDraft.id_karyawan) {
      setFormError("Pilih karyawan terlebih dahulu.");
      return;
    }
    // Rust menyimpan `rate_per_hour` sebagai i64: angka pecahan akan ditolak
    // saat deserialisasi dengan pesan yang tidak bisa dipahami pengguna.
    if (!Number.isInteger(rate) || rate <= 0) {
      setFormError("Rate per jam harus bilangan bulat lebih dari 0.");
      return;
    }
    if (!salaryDraft.effective_date) {
      setFormError("Tanggal berlaku wajib diisi.");
      return;
    }
    // Rate unik per (karyawan, tanggal berlaku). Backend menimpa baris lama
    // lewat ON CONFLICT tetapi tetap mengantrekan sinkronisasi dengan id BARU,
    // sehingga cloud dan perangkat bisa memegang id berbeda untuk rate yang
    // sama. Memakai ulang id baris yang sudah ada menghindari itu.
    const existing = salaryDraft.id
      ? null
      : salaryConfigs.find(
          (cfg) =>
            cfg.id_karyawan === salaryDraft.id_karyawan &&
            cfg.effective_date === salaryDraft.effective_date,
        );
    isSubmittingRef.current = true;
    setSaving(true);
    setFormError(null);
    try {
      await saveSalaryConfig({
        id: existing?.id ?? salaryDraft.id,
        id_karyawan: salaryDraft.id_karyawan,
        rate_per_hour: rate,
        ptkp_status: salaryDraft.ptkp_status,
        effective_date: salaryDraft.effective_date,
      });
      triggerHaptic("success");
      setSalaryDraft(null);
      setFeedback({
        type: "success",
        message: existing
          ? "Rate pada tanggal berlaku yang sama sudah ada dan telah diperbarui."
          : "Rate gaji karyawan berhasil disimpan.",
      });
      await loadData(true);
    } catch (err) {
      triggerHaptic("error");
      setFormError(
        err instanceof Error ? err.message : "Gagal menyimpan rate gaji.",
      );
    } finally {
      isSubmittingRef.current = false;
      setSaving(false);
    }
  };

  const openNewComponent = () => {
    triggerHaptic("light");
    setFormError(null);
    setComponentDraft({
      id: "",
      name: "",
      category: "ALLOWANCE",
      calc_type: "FIXED",
      value: "0",
      applies_to: "ALL",
      is_active: 1,
    });
  };

  const openEditComponent = (comp: PayrollComponentRow) => {
    setFormError(null);
    setComponentDraft({
      id: comp.id,
      name: comp.name,
      category: comp.category,
      calc_type: comp.calc_type,
      value: String(comp.default_value),
      applies_to: comp.applies_to || "ALL",
      is_active: comp.is_active,
    });
  };

  const submitComponent = async () => {
    if (!componentDraft || isSubmittingRef.current) return;
    const name = componentDraft.name.trim();
    const value = Number(componentDraft.value);
    if (!name) {
      setFormError("Nama komponen wajib diisi.");
      return;
    }
    if (
      componentDraft.value.trim() === "" ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      setFormError("Nilai komponen harus angka 0 atau lebih.");
      return;
    }
    if (componentDraft.calc_type === "PERCENTAGE" && value > 100) {
      setFormError("Persentase tidak boleh melebihi 100%.");
      return;
    }
    isSubmittingRef.current = true;
    setSaving(true);
    setFormError(null);
    try {
      await savePayrollComponent({
        id: componentDraft.id,
        name,
        category: componentDraft.category,
        calc_type: componentDraft.calc_type,
        default_value: value,
        applies_to: componentDraft.applies_to,
        is_active: componentDraft.is_active,
      });
      triggerHaptic("success");
      setComponentDraft(null);
      setFeedback({
        type: "success",
        message: "Komponen payroll berhasil disimpan.",
      });
      await loadData(true);
    } catch (err) {
      triggerHaptic("error");
      setFormError(
        err instanceof Error ? err.message : "Gagal menyimpan komponen.",
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
      if (deleteTarget.kind === "salary") {
        await deleteSalaryConfig(deleteTarget.id);
      } else {
        await deletePayrollComponent(deleteTarget.id);
      }
      triggerHaptic("success");
      setFeedback({
        type: "success",
        message: `${deleteTarget.label} berhasil dihapus.`,
      });
      await loadData(true);
    } catch (err) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Gagal menghapus data.",
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

  const isEditingSalary = Boolean(salaryDraft?.id);

  return (
    <MobileAppShell>
      <div className="flex flex-col gap-4 text-slate-100">
        <PayrollConfigHeader
          title="Konfigurasi Penggajian"
          subtitle="Rate gaji per jam, komponen, dan aturan tarif"
          backHref="/payroll"
          backLabel="Kembali ke Payroll"
          loading={loading}
          onReload={() => void loadData()}
        />

        {feedback ? (
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            onClose={() => setFeedback(null)}
          />
        ) : null}

        <nav aria-label="Aturan tarif payroll" className="flex flex-col gap-2">
          {RULE_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => triggerHaptic("light")}
              className="flex min-h-14 items-center justify-between gap-2 rounded-2xl border border-white/10 bg-slate-900/80 px-3.5 py-2.5 transition active:scale-[0.98]"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold text-slate-100">
                  {link.title}
                </span>
                <span className="block truncate text-[10px] text-slate-500">
                  {link.subtitle}
                </span>
              </span>
              <Icon
                name="chevron-right"
                className="size-4 shrink-0 text-slate-500"
              />
            </Link>
          ))}
        </nav>

        <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-white/10 bg-slate-900/60 p-1">
          <button
            type="button"
            onClick={() => setActiveTab("salary")}
            className={`min-h-10 rounded-xl text-xs font-bold transition ${
              activeTab === "salary"
                ? "bg-sky-500 text-slate-950"
                : "text-slate-400 hover:bg-white/5"
            }`}
          >
            Rate Gaji ({salaryConfigs.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("components")}
            className={`min-h-10 rounded-xl text-xs font-bold transition ${
              activeTab === "components"
                ? "bg-sky-500 text-slate-950"
                : "text-slate-400 hover:bg-white/5"
            }`}
          >
            Komponen ({components.length})
          </button>
        </div>

        {activeTab === "salary" ? (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cari nama / ID karyawan"
                aria-label="Cari rate gaji berdasarkan nama atau ID karyawan"
                className={CONFIG_INPUT_CLASS}
              />
              <button
                type="button"
                onClick={openNewSalary}
                aria-label="Atur rate gaji karyawan"
                className="grid size-11 shrink-0 place-items-center rounded-xl bg-sky-500 text-slate-950 shadow-lg transition hover:bg-sky-400 active:scale-95"
              >
                <Icon name="plus" className="size-5" />
              </button>
            </div>

            {loading ? (
              <ConfigSkeletonList />
            ) : filteredConfigs.length === 0 ? (
              <ConfigEmptyState>
                {search
                  ? "Tidak ada rate gaji yang cocok dengan pencarian."
                  : "Belum ada rate gaji karyawan yang diatur."}
              </ConfigEmptyState>
            ) : (
              <ul className="flex flex-col gap-2">
                {filteredConfigs.map((cfg) => {
                  const emp = employeeNames.get(cfg.id_karyawan);
                  const label = emp?.nama || cfg.id_karyawan;
                  return (
                    <li
                      key={cfg.id}
                      className="rounded-2xl border border-white/10 bg-slate-900/80 p-3.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-white">
                            {label}
                          </p>
                          <p className="truncate text-[11px] text-slate-500">
                            {cfg.id_karyawan}
                            {emp?.divisi ? ` · ${emp.divisi}` : ""}
                          </p>
                        </div>
                        <p className="shrink-0 font-mono text-sm font-black text-sky-300">
                          {IDR.format(cfg.rate_per_hour)}
                          <span className="text-[10px] font-semibold text-slate-500">
                            /jam
                          </span>
                        </p>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span className="rounded-md border border-white/10 bg-slate-950/60 px-2 py-0.5 font-bold text-slate-300">
                          PTKP {cfg.ptkp_status || "-"}
                        </span>
                        <span className="rounded-md border border-white/10 bg-slate-950/60 px-2 py-0.5 font-mono text-slate-400">
                          Berlaku {cfg.effective_date}
                        </span>
                        {cfg.effective_date > today ? (
                          <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-bold text-amber-300">
                            Mendatang
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-2">
                        <p className="truncate text-[10px] text-slate-500">
                          Diatur {cfg.created_by || "-"}
                        </p>
                        <ConfigRowActions
                          deleteLabel={`Hapus rate gaji ${label}`}
                          onEdit={() => openEditSalary(cfg)}
                          onDelete={() =>
                            setDeleteTarget({
                              kind: "salary",
                              id: cfg.id,
                              label: `Rate gaji ${label} (berlaku ${cfg.effective_date})`,
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
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] leading-4 text-slate-500">
                Tunjangan &amp; potongan tambahan per periode payroll.
              </p>
              <button
                type="button"
                onClick={openNewComponent}
                className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-sky-500 px-3 text-xs font-black text-slate-950 shadow-lg transition hover:bg-sky-400 active:scale-95"
              >
                <Icon name="plus" className="size-4" />
                Tambah
              </button>
            </div>

            {loading ? (
              <ConfigSkeletonList />
            ) : components.length === 0 ? (
              <ConfigEmptyState>
                Belum ada komponen tunjangan atau potongan.
              </ConfigEmptyState>
            ) : (
              <ul className="flex flex-col gap-2">
                {components.map((comp) => {
                  const isAllowance = comp.category === "ALLOWANCE";
                  const recipient =
                    comp.applies_to === "ALL"
                      ? "Semua karyawan"
                      : employeeNames.get(comp.applies_to)?.nama ||
                        comp.applies_to;
                  return (
                    <li
                      key={comp.id}
                      className="rounded-2xl border border-white/10 bg-slate-900/80 p-3.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-white">
                            {comp.name}
                          </p>
                          <p className="truncate text-[11px] text-slate-500">
                            {recipient}
                          </p>
                        </div>
                        <p
                          className={`shrink-0 font-mono text-sm font-black ${
                            isAllowance ? "text-emerald-300" : "text-rose-300"
                          }`}
                        >
                          {isAllowance ? "+" : "−"}
                          {comp.calc_type === "FIXED"
                            ? IDR.format(comp.default_value)
                            : `${comp.default_value}%`}
                        </p>
                      </div>
                      <div className="mt-2 flex items-end justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                          <span
                            className={`rounded-md border px-2 py-0.5 font-bold ${
                              isAllowance
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                            }`}
                          >
                            {isAllowance ? "Tunjangan" : "Potongan"}
                          </span>
                          <span className="rounded-md border border-white/10 bg-slate-950/60 px-2 py-0.5 text-slate-400">
                            {comp.calc_type === "FIXED"
                              ? "Nominal tetap"
                              : "% gaji pokok"}
                          </span>
                          {comp.is_active === 0 ? (
                            <span className="rounded-md border border-white/15 bg-slate-500/15 px-2 py-0.5 font-bold text-slate-400">
                              Nonaktif
                            </span>
                          ) : null}
                        </div>
                        <ConfigRowActions
                          deleteLabel={`Hapus komponen ${comp.name}`}
                          onEdit={() => openEditComponent(comp)}
                          onDelete={() =>
                            setDeleteTarget({
                              kind: "component",
                              id: comp.id,
                              label: `Komponen "${comp.name}"`,
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
        )}
      </div>

      <ConfigFormModal
        isOpen={Boolean(salaryDraft)}
        title={isEditingSalary ? "Ubah Rate Gaji" : "Atur Rate Gaji Karyawan"}
        titleId="payroll-salary-config-title"
        error={formError}
        saving={saving}
        submitLabel="Simpan Rate"
        onDismissError={() => setFormError(null)}
        onClose={() => setSalaryDraft(null)}
        onSubmit={() => void submitSalary()}
      >
        {salaryDraft ? (
          <>
            {isEditingSalary ? (
              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                <p className="text-[11px] text-slate-500">Karyawan</p>
                <p className="text-sm font-bold text-white">
                  {employeeNames.get(salaryDraft.id_karyawan)?.nama ||
                    salaryDraft.id_karyawan}
                </p>
                <p className="mt-1.5 text-[10px] leading-4 text-slate-400">
                  Karyawan dan tanggal berlaku dikunci. Untuk mengubah
                  tanggalnya, tambahkan rate baru — rate lama tetap tersimpan
                  sebagai riwayat.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="salary-employee-filter"
                  className="text-[11px] font-semibold text-slate-400"
                >
                  Karyawan
                </label>
                <input
                  id="salary-employee-filter"
                  type="search"
                  value={employeeFilter}
                  onChange={(event) => setEmployeeFilter(event.target.value)}
                  placeholder="Saring nama / ID..."
                  className={CONFIG_INPUT_CLASS}
                />
                <select
                  value={salaryDraft.id_karyawan}
                  onChange={(event) =>
                    setSalaryDraft((prev) =>
                      prev
                        ? { ...prev, id_karyawan: event.target.value }
                        : prev,
                    )
                  }
                  required
                  aria-label="Pilih karyawan"
                  className={CONFIG_INPUT_CLASS}
                >
                  <option value="">
                    -- Pilih karyawan ({pickerEmployees.length}) --
                  </option>
                  {pickerEmployees.map((emp) => (
                    <option
                      key={String(emp.id_unik)}
                      value={String(emp.id_unik)}
                    >
                      {String(emp.nama)} ·{" "}
                      {emp.divisi ? String(emp.divisi) : "Divisi -"}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="salary-rate" className={CONFIG_LABEL_CLASS}>
                  Rate pokok (Rp/jam)
                </label>
                <input
                  id="salary-rate"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={salaryDraft.rate}
                  onChange={(event) =>
                    setSalaryDraft((prev) =>
                      prev ? { ...prev, rate: event.target.value } : prev,
                    )
                  }
                  required
                  className={`${CONFIG_INPUT_CLASS} font-mono`}
                />
              </div>
              <div>
                <label htmlFor="salary-ptkp" className={CONFIG_LABEL_CLASS}>
                  Status PTKP
                </label>
                <select
                  id="salary-ptkp"
                  value={salaryDraft.ptkp_status}
                  onChange={(event) =>
                    setSalaryDraft((prev) =>
                      prev
                        ? { ...prev, ptkp_status: event.target.value }
                        : prev,
                    )
                  }
                  className={CONFIG_INPUT_CLASS}
                >
                  {PTKP_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor="salary-effective-date"
                className={CONFIG_LABEL_CLASS}
              >
                Tanggal berlaku
              </label>
              <input
                id="salary-effective-date"
                type="date"
                value={salaryDraft.effective_date}
                onChange={(event) =>
                  setSalaryDraft((prev) =>
                    prev
                      ? { ...prev, effective_date: event.target.value }
                      : prev,
                  )
                }
                disabled={isEditingSalary}
                required
                className={`${CONFIG_INPUT_CLASS} font-mono`}
              />
            </div>
          </>
        ) : null}
      </ConfigFormModal>

      <ConfigFormModal
        isOpen={Boolean(componentDraft)}
        title={componentDraft?.id ? "Ubah Komponen" : "Tambah Komponen"}
        titleId="payroll-component-config-title"
        error={formError}
        saving={saving}
        submitLabel="Simpan Komponen"
        onDismissError={() => setFormError(null)}
        onClose={() => setComponentDraft(null)}
        onSubmit={() => void submitComponent()}
      >
        {componentDraft ? (
          <>
            <div>
              <label htmlFor="component-name" className={CONFIG_LABEL_CLASS}>
                Nama komponen
              </label>
              <input
                id="component-name"
                type="text"
                value={componentDraft.name}
                onChange={(event) =>
                  setComponentDraft((prev) =>
                    prev ? { ...prev, name: event.target.value } : prev,
                  )
                }
                placeholder="Misal: Tunjangan Jabatan"
                required
                className={CONFIG_INPUT_CLASS}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="component-category"
                  className={CONFIG_LABEL_CLASS}
                >
                  Kategori
                </label>
                <select
                  id="component-category"
                  value={componentDraft.category}
                  onChange={(event) =>
                    setComponentDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            category: event.target.value as
                              | "ALLOWANCE"
                              | "DEDUCTION",
                          }
                        : prev,
                    )
                  }
                  className={CONFIG_INPUT_CLASS}
                >
                  <option value="ALLOWANCE">Tunjangan (+)</option>
                  <option value="DEDUCTION">Potongan (−)</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="component-calc-type"
                  className={CONFIG_LABEL_CLASS}
                >
                  Tipe kalkulasi
                </label>
                <select
                  id="component-calc-type"
                  value={componentDraft.calc_type}
                  onChange={(event) =>
                    setComponentDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            calc_type: event.target.value as
                              | "FIXED"
                              | "PERCENTAGE",
                          }
                        : prev,
                    )
                  }
                  className={CONFIG_INPUT_CLASS}
                >
                  <option value="FIXED">Nominal (Rp)</option>
                  <option value="PERCENTAGE">% Gaji pokok</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="component-value" className={CONFIG_LABEL_CLASS}>
                {componentDraft.calc_type === "FIXED"
                  ? "Nominal (Rp)"
                  : "Persentase (%)"}
              </label>
              <input
                id="component-value"
                type="number"
                inputMode="decimal"
                min={0}
                max={
                  componentDraft.calc_type === "PERCENTAGE" ? 100 : undefined
                }
                step="any"
                value={componentDraft.value}
                onChange={(event) =>
                  setComponentDraft((prev) =>
                    prev ? { ...prev, value: event.target.value } : prev,
                  )
                }
                required
                className={`${CONFIG_INPUT_CLASS} font-mono`}
              />
            </div>
          </>
        ) : null}
      </ConfigFormModal>

      <ConfirmDeleteModal
        label={deleteTarget?.label ?? null}
        note={FROZEN_RUN_NOTE}
        titleId="payroll-config-delete-title"
        busy={saving}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </MobileAppShell>
  );
}
