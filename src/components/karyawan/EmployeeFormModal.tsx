"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { triggerHaptic } from "@/lib/client/haptics";
import {
  type KaryawanInput,
  tambahKaryawan,
  updateKaryawan,
} from "@/lib/gateways/employee";
import {
  createEmployeeIdentifiers,
  firstValidationMessage,
  validateEmployeeDraft,
} from "@/lib/validations/stabilization";

const JENIS_PERSONIL_OPTIONS = [
  "Pegawai",
  "Magang",
  "Kontrak",
  "Honorer",
  "Security",
  "Cleaning Service",
] as const;

const DEFAULT_FORM: KaryawanInput = {
  id_unik: "",
  kode_karyawan: "",
  nama: "",
  divisi: "SPPG Operational",
  jabatan_status: "Staff",
  no_hp: "",
  lp: "L",
  id_shift: 1,
  status_aktif: "Aktif",
  tanggal_daftar: new Date().toLocaleDateString("en-CA"),
  catatan: "",
  jenis_personil: "Pegawai",
  tanggal_mulai_aktif: new Date().toLocaleDateString("en-CA"),
  tanggal_selesai_aktif: "",
};

interface EmployeeFormModalProps {
  /** True jika modal ditampilkan. */
  isOpen: boolean;
  /** Mode 'add' untuk tambah baru, 'edit' untuk edit karyawan yang ada. */
  mode: "add" | "edit";
  /** Data awal untuk mode 'edit'. Null untuk mode 'add'. */
  initialData: KaryawanInput | null;
  /** Daftar shift yang tersedia untuk dipilih. */
  shifts: Record<string, unknown>[];
  /** Callback menutup modal tanpa menyimpan. */
  onClose: () => void;
  /** Callback sukses menyimpan — menerima pesan konfirmasi. */
  onSuccess: (message: string) => void;
}

/**
 * Modal form Tambah / Edit karyawan.
 * Hanya boleh dirender jika operator memiliki izin employees.manage.
 *
 * Guard:
 * - isSubmittingRef mencegah double-submit.
 * - validateEmployeeDraft() dari stabilization.ts untuk validasi sebelum submit.
 * - Seluruh field numerik di-parse dan divalidasi sebelum dikirim ke gateway.
 */
export function EmployeeFormModal({
  isOpen,
  mode,
  initialData,
  shifts,
  onClose,
  onSuccess,
}: EmployeeFormModalProps) {
  const isSubmittingRef = useRef(false);
  const [formData, setFormData] = useState<KaryawanInput>(DEFAULT_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Inisialisasi form saat modal dibuka
  useEffect(() => {
    if (!isOpen) return;
    setFormErrors({});
    setErrorMsg(null);
    isSubmittingRef.current = false;

    if (mode === "edit" && initialData) {
      setFormData({ ...DEFAULT_FORM, ...initialData });
    } else {
      // Mode 'add': auto-generate identifiers
      const todayStr = new Date().toLocaleDateString("en-CA");
      const identifiers = createEmployeeIdentifiers(crypto.randomUUID());
      const firstShiftId = Number(shifts[0]?.id_shift ?? 1);
      setFormData({
        ...DEFAULT_FORM,
        id_unik: identifiers.idUnik,
        kode_karyawan: identifiers.kodeKaryawan,
        tanggal_daftar: todayStr,
        tanggal_mulai_aktif: todayStr,
        id_shift: firstShiftId,
      });
    }
  }, [isOpen, mode, initialData, shifts]);

  const set = (field: keyof KaryawanInput, value: unknown) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Hapus error field yang sedang diubah
    if (formErrors[field]) {
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;

    const errors = validateEmployeeDraft(formData);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      setErrorMsg(firstValidationMessage(errors));
      triggerHaptic("error");
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      if (mode === "edit" && initialData?.id_unik) {
        await updateKaryawan(initialData.id_unik, formData);
        onSuccess(`Data karyawan ${formData.nama} berhasil diperbarui.`);
      } else {
        await tambahKaryawan(formData);
        onSuccess(`Karyawan baru ${formData.nama} berhasil ditambahkan.`);
      }
      triggerHaptic("success");
      onClose();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal menyimpan data karyawan.";
      setErrorMsg(msg);
      triggerHaptic("error");
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const inputClass = (field: string) =>
    `w-full rounded-xl border px-3 py-2.5 text-sm bg-slate-800/60 text-white placeholder-slate-500 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 ${
      formErrors[field]
        ? "border-rose-500/60 ring-2 ring-rose-500/20"
        : "border-white/10"
    }`;

  const fieldError = (field: string) =>
    formErrors[field] ? (
      <p className="mt-1 text-[11px] text-rose-400">{formErrors[field]}</p>
    ) : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === "add" ? "Tambah Karyawan Baru" : "Edit Data Karyawan"}
      titleId="employee-form-modal-title"
      maxWidth="max-w-md"
    >
      <form onSubmit={(e) => void handleSubmit(e)} noValidate>
        {/* Banner Error Umum */}
        {errorMsg ? (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
            <Icon
              name="alert"
              className="size-4 text-rose-400 shrink-0 mt-0.5"
            />
            <p className="text-xs text-rose-300">{errorMsg}</p>
          </div>
        ) : null}

        {/* Grup 1: Identitas */}
        <div className="mb-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">
            Identitas Karyawan
          </p>
          <div className="flex flex-col gap-3">
            {/* Nama */}
            <div>
              <label
                htmlFor="emp-nama"
                className="mb-1 block text-xs font-semibold text-slate-300"
              >
                Nama Lengkap <span className="text-rose-400">*</span>
              </label>
              <input
                id="emp-nama"
                type="text"
                value={formData.nama}
                onChange={(e) => set("nama", e.target.value)}
                placeholder="Nama lengkap karyawan"
                className={inputClass("nama")}
                maxLength={100}
              />
              {fieldError("nama")}
            </div>

            {/* Kode Karyawan (readonly di edit mode) */}
            <div>
              <label
                htmlFor="emp-kode"
                className="mb-1 block text-xs font-semibold text-slate-300"
              >
                Kode Karyawan <span className="text-rose-400">*</span>
              </label>
              <input
                id="emp-kode"
                type="text"
                value={formData.kode_karyawan}
                onChange={(e) => set("kode_karyawan", e.target.value)}
                placeholder="Kode unik karyawan"
                readOnly={mode === "edit"}
                className={`${inputClass("kode_karyawan")} ${mode === "edit" ? "opacity-60 cursor-not-allowed" : ""}`}
                maxLength={50}
              />
              {fieldError("kode_karyawan")}
            </div>

            {/* Jenis Kelamin */}
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-300">
                Jenis Kelamin <span className="text-rose-400">*</span>
              </p>
              <div className="flex gap-2">
                {(["L", "P"] as const).map((lp) => (
                  <button
                    key={lp}
                    type="button"
                    onClick={() => set("lp", lp)}
                    className={`flex-1 rounded-xl border py-2.5 text-sm font-bold transition-all active:scale-95 ${
                      formData.lp === lp
                        ? "border-sky-500 bg-sky-500/20 text-sky-300"
                        : "border-white/10 bg-slate-800/40 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {lp === "L" ? "Laki-laki" : "Perempuan"}
                  </button>
                ))}
              </div>
            </div>

            {/* Jenis Personil */}
            <div>
              <label
                htmlFor="emp-personil"
                className="mb-1 block text-xs font-semibold text-slate-300"
              >
                Jenis Personil
              </label>
              <select
                id="emp-personil"
                value={formData.jenis_personil ?? "Pegawai"}
                onChange={(e) => set("jenis_personil", e.target.value)}
                className={inputClass("jenis_personil")}
              >
                {JENIS_PERSONIL_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Grup 2: Penugasan */}
        <div className="mb-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">
            Penugasan
          </p>
          <div className="flex flex-col gap-3">
            {/* Divisi */}
            <div>
              <label
                htmlFor="emp-divisi"
                className="mb-1 block text-xs font-semibold text-slate-300"
              >
                Divisi <span className="text-rose-400">*</span>
              </label>
              <input
                id="emp-divisi"
                type="text"
                value={formData.divisi}
                onChange={(e) => set("divisi", e.target.value)}
                placeholder="Divisi / Unit kerja"
                className={inputClass("divisi")}
                maxLength={100}
              />
              {fieldError("divisi")}
            </div>

            {/* Jabatan */}
            <div>
              <label
                htmlFor="emp-jabatan"
                className="mb-1 block text-xs font-semibold text-slate-300"
              >
                Jabatan / Status
              </label>
              <input
                id="emp-jabatan"
                type="text"
                value={formData.jabatan_status ?? ""}
                onChange={(e) => set("jabatan_status", e.target.value)}
                placeholder="Jabatan atau status karyawan"
                className={inputClass("jabatan_status")}
                maxLength={100}
              />
            </div>

            {/* Shift Kerja */}
            <div>
              <label
                htmlFor="emp-shift"
                className="mb-1 block text-xs font-semibold text-slate-300"
              >
                Shift Kerja <span className="text-rose-400">*</span>
              </label>
              <select
                id="emp-shift"
                value={formData.id_shift}
                onChange={(e) => set("id_shift", Number(e.target.value))}
                className={inputClass("id_shift")}
              >
                {shifts.length === 0 ? (
                  <option value={0}>Belum ada shift tersedia</option>
                ) : (
                  shifts.map((s) => (
                    <option key={String(s.id_shift)} value={Number(s.id_shift)}>
                      {String(s.nama_shift ?? `Shift ${s.id_shift}`)}
                    </option>
                  ))
                )}
              </select>
              {fieldError("id_shift")}
            </div>

            {/* No HP */}
            <div>
              <label
                htmlFor="emp-nohp"
                className="mb-1 block text-xs font-semibold text-slate-300"
              >
                No. HP / WhatsApp
              </label>
              <input
                id="emp-nohp"
                type="tel"
                value={formData.no_hp ?? ""}
                onChange={(e) => set("no_hp", e.target.value)}
                placeholder="Contoh: 08123456789"
                className={inputClass("no_hp")}
                maxLength={20}
              />
            </div>
          </div>
        </div>

        {/* Grup 3: Periode */}
        <div className="mb-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">
            Periode Keaktifan
          </p>
          <div className="flex flex-col gap-3">
            <div>
              <label
                htmlFor="emp-tgl-daftar"
                className="mb-1 block text-xs font-semibold text-slate-300"
              >
                Tanggal Daftar
              </label>
              <input
                id="emp-tgl-daftar"
                type="date"
                value={formData.tanggal_daftar ?? ""}
                onChange={(e) => set("tanggal_daftar", e.target.value)}
                className={inputClass("tanggal_daftar")}
              />
            </div>
            <div>
              <label
                htmlFor="emp-mulai-aktif"
                className="mb-1 block text-xs font-semibold text-slate-300"
              >
                Mulai Aktif
              </label>
              <input
                id="emp-mulai-aktif"
                type="date"
                value={formData.tanggal_mulai_aktif ?? ""}
                onChange={(e) => set("tanggal_mulai_aktif", e.target.value)}
                className={inputClass("tanggal_mulai_aktif")}
              />
            </div>
            <div>
              <label
                htmlFor="emp-selesai-aktif"
                className="mb-1 block text-xs font-semibold text-slate-300"
              >
                Selesai Aktif{" "}
                <span className="text-slate-500 font-normal">(opsional)</span>
              </label>
              <input
                id="emp-selesai-aktif"
                type="date"
                value={formData.tanggal_selesai_aktif ?? ""}
                onChange={(e) => set("tanggal_selesai_aktif", e.target.value)}
                className={inputClass("tanggal_selesai_aktif")}
              />
            </div>
          </div>
        </div>

        {/* Grup 4: Catatan */}
        <div className="mb-6">
          <label
            htmlFor="emp-catatan"
            className="mb-1 block text-xs font-semibold text-slate-300"
          >
            Catatan{" "}
            <span className="text-slate-500 font-normal">(opsional)</span>
          </label>
          <textarea
            id="emp-catatan"
            value={formData.catatan ?? ""}
            onChange={(e) => set("catatan", e.target.value)}
            placeholder="Catatan operasional karyawan..."
            rows={3}
            className={`${inputClass("catatan")} resize-none`}
            maxLength={500}
          />
        </div>

        {/* Tombol Aksi Form */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-bold text-slate-300 hover:bg-white/10 active:scale-95 transition disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={isSubmitting || shifts.length === 0}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 py-3 text-sm font-black text-white shadow-lg shadow-sky-500/20 hover:brightness-110 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Icon name="sync" className="size-4 animate-spin" />
                Menyimpan...
              </>
            ) : mode === "add" ? (
              <>
                <Icon name="check" className="size-4" />
                Tambah Karyawan
              </>
            ) : (
              <>
                <Icon name="check" className="size-4" />
                Simpan Perubahan
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
