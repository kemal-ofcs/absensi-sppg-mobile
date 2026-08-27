"use client";

import { useState } from "react";
import { DigitalIdCardPreview } from "@/components/karyawan/DigitalIdCardPreview";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { triggerHaptic } from "@/lib/client/haptics";

type DetailTab = "idcard" | "info" | "aksi";

interface EmployeeDetailModalProps {
  /** Data lengkap karyawan yang sedang dilihat. Null jika modal tertutup. */
  employee: Record<string, unknown> | null;
  /** Daftar shift untuk keperluan form edit. */
  shifts: Record<string, unknown>[];
  /** True jika operator memiliki izin employees.manage. */
  canManage: boolean;
  /** True jika modal harus ditampilkan. */
  isOpen: boolean;
  /** Callback menutup modal. */
  onClose: () => void;
  /** Callback saat tombol Edit ditekan — membuka EmployeeFormModal. */
  onEditRequest: (emp: Record<string, unknown>) => void;
  /** Callback untuk toggle status Aktif/Nonaktif. */
  onToggleStatus: (idUnik: string, currentStatus: string) => Promise<void>;
}

/**
 * Format tanggal dari 'YYYY-MM-DD' ke 'DD/MM/YYYY' untuk tampilan.
 * Field null/undefined/kosong ditampilkan sebagai '-'.
 */
function fmtDate(val: unknown): string {
  if (!val || typeof val !== "string" || val.trim() === "") return "-";
  if (/^\d{2}\/\d{2}\/\d{4}/.test(val)) return val;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(val);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return val;
}

/** Render satu baris info (label: nilai) di dalam grup detail. */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-white/[0.05] last:border-0">
      <span className="text-[11px] font-medium text-slate-500 shrink-0 max-w-[120px]">
        {label}
      </span>
      <span className="text-[12px] font-semibold text-slate-200 text-right break-words min-w-0">
        {value || "-"}
      </span>
    </div>
  );
}

/**
 * Modal lembar detail karyawan dengan navigasi tab.
 * - Tab 1 (ID Card): Menampilkan DigitalIdCardPreview dengan QR on-demand.
 * - Tab 2 (Info): Semua 16 kolom data karyawan dalam grup-grup info.
 * - Tab 3 (Aksi): Tombol manajemen, hanya muncul jika canManage === true.
 */
export function EmployeeDetailModal({
  employee,
  canManage,
  isOpen,
  onClose,
  onEditRequest,
  onToggleStatus,
}: EmployeeDetailModalProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>("idcard");
  const [busyToggle, setBusyToggle] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  if (!employee) return null;

  const nama = String(employee.nama ?? "-");
  const kodeKaryawan = String(employee.kode_karyawan ?? "-");
  const idUnik = String(employee.id_unik ?? "-");
  const divisi = String(employee.divisi ?? "-");
  const jabatan = String(employee.jabatan_status ?? "-");
  const noHp = String(employee.no_hp ?? "");
  const lp = String(employee.lp ?? "-");
  const namaShift = String(employee.nama_shift ?? "-");
  const statusAktif = String(employee.status_aktif ?? "Aktif");
  const tglDaftar = fmtDate(employee.tanggal_daftar);
  const catatan = String(employee.catatan ?? "");
  const jenisPersonil = String(employee.jenis_personil ?? "-");
  const mulaiAktif = fmtDate(employee.tanggal_mulai_aktif);
  const selesaiAktif = fmtDate(employee.tanggal_selesai_aktif);
  const statusQr = String(employee.status_qr ?? "Belum");
  const statusBackup = String(employee.status_backup ?? "NORMAL");

  // Validasi & normalisasi nomor telepon dan WhatsApp
  const rawNoHp = noHp.trim();
  const phoneDigits = rawNoHp.replace(/\D/g, "");
  const isValidPhone = Boolean(
    rawNoHp &&
      rawNoHp !== "-" &&
      rawNoHp.toLowerCase() !== "null" &&
      rawNoHp.toLowerCase() !== "undefined" &&
      rawNoHp.toLowerCase() !== "tidak ada" &&
      phoneDigits.length >= 5,
  );

  const telHref = isValidPhone
    ? `tel:${rawNoHp.startsWith("+") ? `+${phoneDigits}` : phoneDigits}`
    : null;

  let waDigits = phoneDigits;
  if (waDigits.startsWith("0")) {
    waDigits = `62${waDigits.slice(1)}`;
  } else if (waDigits.startsWith("8")) {
    waDigits = `62${waDigits}`;
  }
  const waHref =
    isValidPhone && waDigits.length >= 8 ? `https://wa.me/${waDigits}` : null;

  const isAktif = statusAktif === "Aktif";

  const handleToggle = async () => {
    if (busyToggle) return;
    const action = isAktif ? "Nonaktifkan" : "Aktifkan kembali";
    const confirmed = window.confirm(
      `${action} karyawan ${nama}? Tindakan ini akan segera tersinkronisasi.`,
    );
    if (!confirmed) return;
    setBusyToggle(true);
    setToggleError(null);
    triggerHaptic("warning");
    try {
      await onToggleStatus(idUnik, statusAktif);
    } catch (err: unknown) {
      setToggleError(
        err instanceof Error ? err.message : "Gagal mengubah status.",
      );
    } finally {
      setBusyToggle(false);
    }
  };

  const tabs: Array<{ key: DetailTab; label: string }> = [
    { key: "idcard", label: "ID Card & QR" },
    { key: "info", label: "Info Lengkap" },
    ...(canManage ? ([{ key: "aksi", label: "Aksi" }] as const) : []),
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={nama}
      titleId="employee-detail-modal-title"
      maxWidth="max-w-md"
    >
      {/* Tab Navigation */}
      <div className="flex gap-1 rounded-xl bg-slate-800/60 p-1 mb-4">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key as DetailTab)}
            className={`flex-1 rounded-lg py-2 text-[11px] font-bold transition-all ${
              activeTab === tab.key
                ? "bg-sky-500 text-slate-950 shadow-md"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: ID Card & QR Code */}
      {activeTab === "idcard" ? (
        <DigitalIdCardPreview employee={employee} />
      ) : null}

      {/* Tab 2: Informasi Lengkap (16 Kolom) */}
      {activeTab === "info" ? (
        <div className="flex flex-col gap-3">
          {/* Grup 1: Identitas Pegawai */}
          <div className="rounded-2xl border border-white/10 bg-slate-800/40 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
              Identitas Pegawai
            </p>
            <InfoRow label="ID Unik / NIK" value={idUnik} />
            <InfoRow label="Kode Karyawan" value={kodeKaryawan} />
            <InfoRow label="Nama Lengkap" value={nama} />
            <InfoRow
              label="Jenis Kelamin"
              value={lp === "L" ? "Laki-laki" : lp === "P" ? "Perempuan" : lp}
            />
            <InfoRow label="Jenis Personil" value={jenisPersonil} />
          </div>

          {/* Grup 2: Penugasan & Shift */}
          <div className="rounded-2xl border border-white/10 bg-slate-800/40 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
              Penugasan &amp; Shift
            </p>
            <InfoRow label="Divisi" value={divisi} />
            <InfoRow label="Jabatan / Status" value={jabatan} />
            <InfoRow label="Shift Kerja" value={namaShift} />
            <div className="py-2 border-b border-white/[0.05]">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[11px] font-medium text-slate-500">
                  Status Backup
                </span>
                {statusBackup === "BACKUP" ? (
                  <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-amber-300">
                    Backup Pengganti
                  </span>
                ) : (
                  <span className="text-[12px] font-semibold text-slate-200">
                    Karyawan Utama
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Grup 3: Periode Keaktifan */}
          <div className="rounded-2xl border border-white/10 bg-slate-800/40 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
              Periode Keaktifan
            </p>
            <InfoRow label="Tanggal Daftar" value={tglDaftar} />
            <InfoRow label="Mulai Aktif" value={mulaiAktif} />
            <InfoRow
              label="Selesai Aktif"
              value={selesaiAktif === "-" ? "Tidak Terbatas" : selesaiAktif}
            />
            <div className="py-2">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[11px] font-medium text-slate-500">
                  Status
                </span>
                <StatusBadge status={statusAktif} />
              </div>
            </div>
          </div>

          {/* Grup 4: Kontak & Catatan */}
          <div className="rounded-2xl border border-white/10 bg-slate-800/40 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
              Kontak &amp; Catatan
            </p>
            {/* No. HP dengan aksi cepat WhatsApp & Telepon */}
            <div className="flex items-center justify-between gap-2 py-2 border-b border-white/[0.05]">
              <span className="text-[11px] font-medium text-slate-500 shrink-0">
                No. HP
              </span>
              {isValidPhone ? (
                <div className="flex items-center gap-2 min-w-0 justify-end">
                  <span
                    className="text-[12px] font-semibold text-slate-200 truncate max-w-[120px] xs:max-w-[150px]"
                    title={rawNoHp}
                  >
                    {rawNoHp}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {waHref ? (
                      <a
                        href={waHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => triggerHaptic("light")}
                        title="Chat WhatsApp"
                        aria-label={`Chat WhatsApp ${nama}`}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/30 active:scale-95 transition-all shadow-sm"
                      >
                        <Icon name="whatsapp" className="size-3.5 shrink-0" />
                        <span className="text-[10px] font-bold tracking-tight">
                          WA
                        </span>
                      </a>
                    ) : null}
                    {telHref ? (
                      <a
                        href={telHref}
                        onClick={() => triggerHaptic("light")}
                        title="Panggil Telepon"
                        aria-label={`Panggil Telepon ${nama}`}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-500/15 text-sky-400 hover:bg-sky-500/25 border border-sky-500/30 active:scale-95 transition-all shadow-sm"
                      >
                        <Icon name="phone" className="size-3.5 shrink-0" />
                        <span className="text-[10px] font-bold tracking-tight">
                          Telp
                        </span>
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : (
                <span className="text-[12px] font-semibold text-slate-500">
                  -
                </span>
              )}
            </div>
            {/* Status QR */}
            <div className="flex items-center justify-between gap-4 py-2 border-b border-white/[0.05]">
              <span className="text-[11px] font-medium text-slate-500">
                Status QR
              </span>
              <StatusBadge status={statusQr} />
            </div>
            {/* Catatan */}
            <div className="pt-2">
              <p className="text-[11px] font-medium text-slate-500 mb-1">
                Catatan
              </p>
              <p className="text-[12px] text-slate-300 leading-relaxed">
                {catatan || "(Tidak ada catatan)"}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* Tab 3: Aksi Manajemen (Hanya canManage) */}
      {activeTab === "aksi" && canManage ? (
        <div className="flex flex-col gap-3">
          {/* Indikator error toggle */}
          {toggleError ? (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
              <p className="text-xs text-rose-300">{toggleError}</p>
            </div>
          ) : null}

          {/* Tombol Edit Data */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic("light");
              onEditRequest(employee);
            }}
            className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-slate-800/60 px-5 py-4 text-left hover:bg-slate-800/90 active:scale-[0.99] transition-all"
          >
            <div>
              <p className="text-sm font-bold text-white">Edit Data Karyawan</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Ubah nama, divisi, jabatan, shift, dan informasi lainnya
              </p>
            </div>
            <Icon
              name="chevron-right"
              className="size-5 text-slate-400 shrink-0"
            />
          </button>

          {/* Tombol Toggle Status */}
          <button
            type="button"
            disabled={busyToggle}
            onClick={() => void handleToggle()}
            className={`flex w-full items-center justify-between rounded-2xl border px-5 py-4 text-left active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
              isAktif
                ? "border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/15"
                : "border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/15"
            }`}
          >
            <div>
              <p
                className={`text-sm font-bold ${isAktif ? "text-rose-300" : "text-emerald-300"}`}
              >
                {busyToggle
                  ? "Menyimpan..."
                  : isAktif
                    ? "Nonaktifkan Karyawan"
                    : "Aktifkan Kembali"}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {isAktif
                  ? "Karyawan tidak akan bisa absensi setelah dinonaktifkan"
                  : "Karyawan dapat kembali melakukan absensi"}
              </p>
            </div>
            <Icon
              name={isAktif ? "alert" : "check"}
              className={`size-5 shrink-0 ${isAktif ? "text-rose-400" : "text-emerald-400"}`}
            />
          </button>

          {/* Informasi Hak Akses */}
          <div className="rounded-xl border border-white/5 bg-slate-900/40 p-3 mt-1">
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Setiap perubahan data karyawan dari perangkat ini akan otomatis
              tersinkronisasi ke Desktop dan Cloud setelah berhasil disimpan.
            </p>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
