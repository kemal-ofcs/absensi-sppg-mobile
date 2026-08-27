"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
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
  "Kontrak",
  "Magang",
  "Harian",
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
 * Modal form Tambah / Edit karyawan (14 Parameter Lengkap).
 * Sesuai dengan format 14-parameter identitas kerja, kontak, shift, dan masa aktif dari versi Desktop.
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
  const isEditing = mode === "edit";
  const prevOpenRef = useRef(false);

  // Inisialisasi form HANYA saat modal pertama kali dibuka (rising edge)
  useEffect(() => {
    if (!prevOpenRef.current && isOpen) {
      setFormErrors({});
      setErrorMsg(null);
      isSubmittingRef.current = false;

      if (mode === "edit" && initialData) {
        const merged = { ...DEFAULT_FORM, ...initialData };
        // Baris lama bisa punya tanggal_daftar null/kosong; jatuhkan ke hari ini
        // supaya input date tidak tampil kosong dan tetap bisa dikoreksi manual.
        if (!merged.tanggal_daftar) {
          merged.tanggal_daftar = new Date().toLocaleDateString("en-CA");
        }
        setFormData(merged);
      } else {
        // Mode 'add': auto-generate identifiers baru
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
    }
    prevOpenRef.current = isOpen;
  }, [isOpen, mode, initialData, shifts]);

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

  const inputClass = (hasErr?: boolean) =>
    `min-h-10 w-full rounded-xl border bg-slate-950 px-3 text-xs text-white outline-none transition focus:border-sky-500 disabled:opacity-50 ${
      hasErr ? "border-rose-500/60 ring-2 ring-rose-500/20" : "border-slate-800"
    }`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        isEditing ? `Edit Karyawan: ${formData.nama}` : "Tambah Karyawan Baru"
      }
      titleId="employee-modal-title"
      maxWidth="max-w-md"
    >
      <p
        id="employee-modal-description"
        className="mb-4 text-xs leading-5 text-slate-400"
      >
        Lengkapi 14 parameter identitas kerja, kontak, shift, dan masa aktif
        karyawan.
      </p>

      {errorMsg ? (
        <FeedbackBanner
          type="error"
          message={errorMsg}
          onClose={() => setErrorMsg(null)}
          className="mb-3.5"
        />
      ) : null}

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="space-y-3.5 text-xs"
        noValidate
      >
        {/* 1 & 2. ID Unik & Kode Karyawan */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="employee-id"
              className="text-slate-400 block mb-1 font-semibold"
            >
              ID Unik / NIK:
            </label>
            <input
              id="employee-id"
              type="text"
              disabled={isEditing}
              value={formData.id_unik}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, id_unik: e.target.value }))
              }
              aria-invalid={!!formErrors.id_unik}
              className={inputClass(!!formErrors.id_unik)}
            />
          </div>
          <div>
            <label
              htmlFor="employee-code"
              className="text-slate-400 block mb-1 font-semibold"
            >
              Kode Karyawan:
            </label>
            <input
              id="employee-code"
              type="text"
              value={formData.kode_karyawan}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  kode_karyawan: e.target.value,
                }))
              }
              aria-invalid={!!formErrors.kode_karyawan}
              className={inputClass(!!formErrors.kode_karyawan)}
            />
          </div>
        </div>

        {/* 3. Nama Lengkap */}
        <div>
          <label
            htmlFor="employee-name"
            className="text-slate-400 block mb-1 font-semibold"
          >
            Nama Lengkap Karyawan:
          </label>
          <input
            id="employee-name"
            type="text"
            value={formData.nama}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, nama: e.target.value }))
            }
            placeholder="Masukkan nama lengkap..."
            aria-invalid={!!formErrors.nama}
            className={inputClass(!!formErrors.nama)}
          />
        </div>

        {/* 4 & 5. Divisi & Jabatan */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="employee-division"
              className="text-slate-400 block mb-1 font-semibold"
            >
              Divisi:
            </label>
            <input
              id="employee-division"
              type="text"
              value={formData.divisi}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, divisi: e.target.value }))
              }
              aria-invalid={!!formErrors.divisi}
              className={inputClass(!!formErrors.divisi)}
            />
          </div>
          <div>
            <label
              htmlFor="employee-position"
              className="text-slate-400 block mb-1 font-semibold"
            >
              Jabatan:
            </label>
            <input
              id="employee-position"
              type="text"
              value={formData.jabatan_status ?? ""}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  jabatan_status: e.target.value,
                }))
              }
              className={inputClass()}
            />
          </div>
        </div>

        {/* 6, 7, 8. Gender, Shift & Personil */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label
              htmlFor="employee-gender"
              className="text-slate-400 block mb-1 font-semibold"
            >
              Jenis Kelamin:
            </label>
            <select
              id="employee-gender"
              value={formData.lp}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  lp: e.target.value as "L" | "P",
                }))
              }
              className={inputClass()}
            >
              <option value="L">Laki-laki (L)</option>
              <option value="P">Perempuan (P)</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="employee-shift"
              className="text-slate-400 block mb-1 font-semibold"
            >
              Shift Kerja:
            </label>
            <select
              id="employee-shift"
              value={formData.id_shift}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  id_shift: Number(e.target.value),
                }))
              }
              aria-invalid={!!formErrors.id_shift}
              className={inputClass(!!formErrors.id_shift)}
            >
              {shifts.map((s) => (
                <option key={String(s.id_shift)} value={Number(s.id_shift)}>
                  {String(s.nama_shift ?? `Shift ${s.id_shift}`)} (
                  {String(s.jam_masuk ?? "07:00")} -{" "}
                  {String(s.jam_pulang ?? "15:00")})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="employee-personnel"
              className="text-slate-400 block mb-1 font-semibold"
            >
              Jenis Personil:
            </label>
            <select
              id="employee-personnel"
              value={formData.jenis_personil || "Pegawai"}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  jenis_personil: e.target.value,
                }))
              }
              className={inputClass()}
            >
              {JENIS_PERSONIL_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 9 & 10. No HP & Status Aktif */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="employee-phone"
              className="mb-1 block text-slate-400 font-semibold"
            >
              Nomor HP:
            </label>
            <input
              id="employee-phone"
              type="tel"
              value={formData.no_hp ?? ""}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, no_hp: e.target.value }))
              }
              placeholder="08xxxxxxxxxx"
              className={inputClass()}
            />
          </div>
          <div>
            <label
              htmlFor="employee-status"
              className="mb-1 block text-slate-400 font-semibold"
            >
              Status Keaktifan:
            </label>
            <select
              id="employee-status"
              value={formData.status_aktif || "Aktif"}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  status_aktif: e.target.value as "Aktif" | "Nonaktif",
                }))
              }
              className={inputClass()}
            >
              <option value="Aktif">Aktif</option>
              <option value="Nonaktif">Nonaktif</option>
            </select>
          </div>
        </div>

        {/* 11. Tanggal Mulai Masuk (tanggal_daftar) — default hari ini, bisa diubah manual */}
        <div>
          <label
            htmlFor="employee-join-date"
            className="mb-1 block text-slate-400 font-semibold"
          >
            Tanggal Mulai Masuk:
          </label>
          <input
            id="employee-join-date"
            type="date"
            value={formData.tanggal_daftar || ""}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                tanggal_daftar: e.target.value,
              }))
            }
            className={inputClass()}
          />
          <p className="mt-1 text-[11px] text-slate-500">
            Tanggal karyawan mulai bekerja. Default hari ini.
          </p>
        </div>

        {/* 12 & 13. Tanggal Mulai & Selesai Aktif */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="employee-start-date"
              className="mb-1 block text-slate-400 font-semibold"
            >
              Tanggal Mulai Aktif:
            </label>
            <input
              id="employee-start-date"
              type="date"
              value={formData.tanggal_mulai_aktif || ""}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  tanggal_mulai_aktif: e.target.value,
                }))
              }
              className={inputClass()}
            />
          </div>
          <div>
            <label
              htmlFor="employee-end-date"
              className="mb-1 block text-slate-400 font-semibold"
            >
              Tanggal Selesai Aktif (Opsional):
            </label>
            <input
              id="employee-end-date"
              type="date"
              value={formData.tanggal_selesai_aktif || ""}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  tanggal_selesai_aktif: e.target.value,
                }))
              }
              className={inputClass()}
            />
          </div>
        </div>

        {/* 14. Catatan */}
        <div>
          <label
            htmlFor="employee-notes"
            className="mb-1 block text-slate-400 font-semibold"
          >
            Catatan:
          </label>
          <textarea
            id="employee-notes"
            value={formData.catatan ?? ""}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, catatan: e.target.value }))
            }
            rows={2}
            placeholder="Catatan tambahan karyawan..."
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-sky-500 resize-none"
          />
        </div>

        {/* 14. Tombol Aksi */}
        <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl font-semibold hover:bg-slate-700 active:scale-95 transition disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={isSubmitting || shifts.length === 0}
            className="px-5 py-2 bg-sky-600 text-on-accent rounded-xl font-bold hover:bg-sky-500 shadow-md shadow-sky-950 active:scale-95 transition disabled:opacity-50"
          >
            {isSubmitting
              ? "Menyimpan..."
              : isEditing
                ? "Simpan Perubahan"
                : "Tambah Karyawan"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
