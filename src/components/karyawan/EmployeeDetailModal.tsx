"use client";

import { useState } from "react";
import { DigitalIdCardPreview } from "@/components/karyawan/DigitalIdCardPreview";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { openExternalLink } from "@/lib/client/external-link";
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
 * Menghasilkan warna HSL yang konsisten dari nama karyawan.
 */
function getAvatarHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
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
function InfoRow({
  label,
  value,
  onCopy,
  copyTooltip,
}: {
  label: string;
  value: string;
  onCopy?: () => void;
  copyTooltip?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-white/[0.06] last:border-0">
      <span className="text-[11px] font-medium text-slate-400 shrink-0 max-w-[120px]">
        {label}
      </span>
      <div className="flex items-center gap-1.5 min-w-0 justify-end">
        <span className="text-[12px] font-semibold text-slate-200 text-right break-words min-w-0">
          {value || "-"}
        </span>
        {onCopy && value && value !== "-" ? (
          <button
            type="button"
            onClick={onCopy}
            title={copyTooltip || "Salin"}
            aria-label={copyTooltip || `Salin ${label}`}
            className="grid size-6 shrink-0 place-items-center rounded-lg bg-white/5 hover:bg-white/15 text-slate-400 hover:text-slate-200 active:scale-90 transition"
          >
            <Icon name="document" className="size-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Modal lembar detail karyawan dengan navigasi tab terpadu.
 * - Hero Header: Identitas ringkas, avatar dinamis, dan status badge.
 * - Tab 1 (ID Card & QR): Menampilkan DigitalIdCardPreview dengan canvas HD dan quick QR.
 * - Tab 2 (Info Lengkap): 16 kolom data lengkap terkelompok rapi.
 * - Tab 3 (Aksi): Manajemen status (dengan konfirmasi inline) dan edit data (khusus canManage).
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
  const [confirmToggleOpen, setConfirmToggleOpen] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);

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

  const avatarHue = getAvatarHue(nama);
  const inisial = nama
    .split(" ")
    .map((n) => n.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const isAktif = statusAktif === "Aktif";
  const isBackup = statusBackup === "BACKUP";

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

  // WebView Android Intent Native untuk WA & Telp
  const handleOpenContact = (url: string, label: string) => {
    triggerHaptic("light");
    const res = openExternalLink(url);
    if (!res.sukses) {
      setContactError(
        res.error || `Tidak ada aplikasi ${label} yang bisa membuka nomor ini.`,
      );
      triggerHaptic("error");
      window.setTimeout(() => setContactError(null), 4000);
    }
  };

  const showCopyToast = (text: string) => {
    triggerHaptic("success");
    setCopyToast(text);
    setTimeout(() => setCopyToast(null), 2500);
  };

  const handleCopyText = async (text: string, label: string) => {
    if (!text || text === "-") return;
    try {
      await navigator.clipboard.writeText(text);
      showCopyToast(`${label} disalin`);
    } catch {
      triggerHaptic("error");
    }
  };

  const handleConfirmToggle = async () => {
    if (busyToggle) return;
    setBusyToggle(true);
    setToggleError(null);
    triggerHaptic("warning");
    try {
      await onToggleStatus(idUnik, statusAktif);
      setConfirmToggleOpen(false);
      triggerHaptic("success");
    } catch (err: unknown) {
      setToggleError(
        err instanceof Error ? err.message : "Gagal mengubah status.",
      );
      triggerHaptic("error");
    } finally {
      setBusyToggle(false);
    }
  };

  const tabs: Array<{
    key: DetailTab;
    label: string;
  }> = [
    { key: "idcard", label: "ID Card" },
    { key: "info", label: "Info" },
    ...(canManage ? ([{ key: "aksi", label: "Aksi" }] as const) : []),
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={nama}
      subtitle={`${kodeKaryawan} • ${divisi}`}
      titleId="employee-detail-modal-title"
      maxWidth="max-w-md"
    >
      {/* Toast Feedback Salin */}
      {copyToast ? (
        <div className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-sky-500/20 border border-sky-500/40 p-2 text-xs font-bold text-sky-300 animate-in fade-in zoom-in-95 duration-150">
          <Icon name="check" className="size-3.5" />
          <span>{copyToast}</span>
        </div>
      ) : null}

      {/* Hero Profile Header */}
      <div className="mb-4 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-800/80 to-slate-900/80 p-3.5 shadow-lg backdrop-blur-md">
        <div className="flex items-center gap-3">
          {/* Avatar Inisial */}
          <div className="relative shrink-0">
            <div
              className="grid size-12 place-items-center rounded-2xl text-base font-black text-white shadow-md border border-white/20"
              style={{
                background: `linear-gradient(135deg, hsl(${avatarHue},70%,35%) 0%, hsl(${avatarHue},50%,22%) 100%)`,
              }}
            >
              {inisial || "??"}
            </div>
            {/* Status Dot */}
            <span
              className={`absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-slate-900 ${
                isAktif
                  ? "bg-emerald-400 shadow-sm shadow-emerald-500/50"
                  : "bg-slate-500"
              }`}
            />
          </div>

          {/* Info Identitas Utama */}
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-black text-white truncate leading-tight">
                {nama}
              </span>
              {isBackup ? (
                <span className="rounded-md border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">
                  Backup
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1 mt-0.5 text-[11px] font-mono text-sky-400">
              <span className="truncate">{idUnik}</span>
              <button
                type="button"
                onClick={() => void handleCopyText(idUnik, "ID Unik")}
                title="Salin ID Unik"
                aria-label="Salin ID Unik"
                className="p-0.5 text-slate-400 hover:text-sky-300 transition"
              >
                <Icon name="document" className="size-3" />
              </button>
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-[10px] text-slate-300 font-medium">
                {divisi} &bull; {jabatan}
              </span>
              <StatusBadge status={statusAktif} />
            </div>
          </div>
        </div>
      </div>

      {/* Tab Segmented Control */}
      <div className="flex gap-1.5 rounded-2xl bg-slate-950/70 p-1 mb-4 border border-white/10">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                triggerHaptic("light");
                setActiveTab(tab.key);
              }}
              className={`min-w-0 flex-1 rounded-xl py-2 px-2 text-center text-xs font-bold transition-all truncate ${
                isActive
                  ? "bg-gradient-to-r from-sky-500 to-blue-600 text-slate-950 shadow-md shadow-sky-500/25"
                  : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
              }`}
            >
              <span className="truncate block">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab 1: ID Card & QR Code */}
      {activeTab === "idcard" ? (
        <DigitalIdCardPreview employee={employee} />
      ) : null}

      {/* Tab 2: Informasi Lengkap (16 Kolom) */}
      {activeTab === "info" ? (
        <div className="flex flex-col gap-3">
          {/* Grup 1: Identitas Pegawai */}
          <div className="rounded-2xl border border-white/10 bg-slate-800/40 p-3.5 shadow-sm">
            <div className="flex items-center gap-1.5 mb-2">
              <Icon name="user" className="size-3.5 text-sky-400" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Identitas Pegawai
              </p>
            </div>
            <InfoRow
              label="ID Unik / NIK"
              value={idUnik}
              onCopy={() => void handleCopyText(idUnik, "ID Unik")}
              copyTooltip="Salin ID Unik"
            />
            <InfoRow
              label="Kode Karyawan"
              value={kodeKaryawan}
              onCopy={() => void handleCopyText(kodeKaryawan, "Kode Karyawan")}
              copyTooltip="Salin Kode"
            />
            <InfoRow label="Nama Lengkap" value={nama} />
            <InfoRow
              label="Jenis Kelamin"
              value={lp === "L" ? "Laki-laki" : lp === "P" ? "Perempuan" : lp}
            />
            <InfoRow label="Jenis Personil" value={jenisPersonil} />
          </div>

          {/* Grup 2: Penugasan & Shift */}
          <div className="rounded-2xl border border-white/10 bg-slate-800/40 p-3.5 shadow-sm">
            <div className="flex items-center gap-1.5 mb-2">
              <Icon name="clock" className="size-3.5 text-sky-400" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Penugasan &amp; Shift
              </p>
            </div>
            <InfoRow label="Divisi" value={divisi} />
            <InfoRow label="Jabatan / Status" value={jabatan} />
            <InfoRow label="Shift Kerja" value={namaShift} />
            <div className="py-2 border-b border-white/[0.06] last:border-0">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[11px] font-medium text-slate-400">
                  Status Penugasan
                </span>
                {isBackup ? (
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
          <div className="rounded-2xl border border-white/10 bg-slate-800/40 p-3.5 shadow-sm">
            <div className="flex items-center gap-1.5 mb-2">
              <Icon name="calendar" className="size-3.5 text-sky-400" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Periode Keaktifan
              </p>
            </div>
            <InfoRow label="Tanggal Masuk" value={tglDaftar} />
            <InfoRow label="Mulai Aktif" value={mulaiAktif} />
            <InfoRow
              label="Selesai Aktif"
              value={selesaiAktif === "-" ? "Tidak Terbatas" : selesaiAktif}
            />
            <div className="py-2">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[11px] font-medium text-slate-400">
                  Status Keaktifan
                </span>
                <StatusBadge status={statusAktif} />
              </div>
            </div>
          </div>

          {/* Grup 4: Kontak & Catatan */}
          <div className="rounded-2xl border border-white/10 bg-slate-800/40 p-3.5 shadow-sm">
            <div className="flex items-center gap-1.5 mb-2">
              <Icon name="phone" className="size-3.5 text-sky-400" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Kontak &amp; Catatan
              </p>
            </div>
            {/* No. HP dengan aksi cepat WhatsApp & Telepon */}
            <div className="flex items-center justify-between gap-2 py-2 border-b border-white/[0.06]">
              <span className="text-[11px] font-medium text-slate-400 shrink-0">
                No. HP
              </span>
              {isValidPhone ? (
                <div className="flex items-center gap-2 min-w-0 justify-end">
                  <span
                    className="text-[12px] font-semibold text-slate-200 truncate max-w-[110px] xs:max-w-[140px]"
                    title={rawNoHp}
                  >
                    {rawNoHp}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {waHref ? (
                      <button
                        type="button"
                        onClick={() => handleOpenContact(waHref, "WhatsApp")}
                        title="Chat WhatsApp"
                        aria-label={`Chat WhatsApp ${nama}`}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/30 active:scale-95 transition-all shadow-sm"
                      >
                        <Icon name="whatsapp" className="size-3.5 shrink-0" />
                        <span className="text-[10px] font-bold tracking-tight">
                          WA
                        </span>
                      </button>
                    ) : null}
                    {telHref ? (
                      <button
                        type="button"
                        onClick={() => handleOpenContact(telHref, "Telepon")}
                        title="Panggil Telepon"
                        aria-label={`Panggil Telepon ${nama}`}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-500/15 text-sky-400 hover:bg-sky-500/25 border border-sky-500/30 active:scale-95 transition-all shadow-sm"
                      >
                        <Icon name="phone" className="size-3.5 shrink-0" />
                        <span className="text-[10px] font-bold tracking-tight">
                          Telp
                        </span>
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <span className="text-[12px] font-semibold text-slate-500">
                  -
                </span>
              )}
            </div>
            {contactError ? (
              <p
                role="alert"
                className="mt-1 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-300"
              >
                {contactError}
              </p>
            ) : null}
            {/* Status QR */}
            <div className="flex items-center justify-between gap-4 py-2 border-b border-white/[0.06]">
              <span className="text-[11px] font-medium text-slate-400">
                Status Token QR
              </span>
              <StatusBadge status={statusQr} />
            </div>
            {/* Catatan */}
            <div className="pt-2">
              <p className="text-[11px] font-medium text-slate-400 mb-1">
                Catatan
              </p>
              <p className="text-[12px] text-slate-300 leading-relaxed bg-slate-900/60 rounded-xl p-2.5 border border-white/5">
                {catatan || "(Tidak ada catatan khusus)"}
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
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5">
              <p className="text-xs text-rose-300 font-semibold">
                {toggleError}
              </p>
            </div>
          ) : null}

          {/* Tombol Edit Data */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic("light");
              onEditRequest(employee);
            }}
            className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-slate-800/60 p-4 text-left hover:bg-slate-800/90 active:scale-[0.99] transition-all shadow-sm"
          >
            <div>
              <p className="text-sm font-bold text-white">Edit Data Karyawan</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Ubah identitas, divisi, jabatan, shift, dan masa aktif
              </p>
            </div>
            <Icon
              name="chevron-right"
              className="size-5 text-slate-400 shrink-0"
            />
          </button>

          {/* Inline Confirmation Card untuk Toggle Status */}
          {confirmToggleOpen ? (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-start gap-3">
                <div className="grid size-9 place-items-center rounded-xl bg-amber-500/20 text-amber-300 shrink-0">
                  <Icon name="alert" className="size-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-white">
                    {isAktif
                      ? "Nonaktifkan Karyawan?"
                      : "Aktifkan Kembali Karyawan?"}
                  </p>
                  <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                    {isAktif
                      ? `Karyawan ${nama} tidak akan dapat melakukan absensi setelah dinonaktifkan.`
                      : `Karyawan ${nama} akan dapat kembali melakukan absensi harian.`}
                  </p>
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      type="button"
                      disabled={busyToggle}
                      onClick={() => setConfirmToggleOpen(false)}
                      className="px-3 py-1.5 rounded-xl bg-white/10 text-slate-300 text-xs font-bold hover:bg-white/20 active:scale-95 transition"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      disabled={busyToggle}
                      onClick={() => void handleConfirmToggle()}
                      className={`px-4 py-1.5 rounded-xl text-xs font-bold text-slate-950 active:scale-95 transition shadow-sm ${
                        isAktif
                          ? "bg-rose-400 hover:bg-rose-300"
                          : "bg-emerald-400 hover:bg-emerald-300"
                      }`}
                    >
                      {busyToggle
                        ? "Menyimpan..."
                        : isAktif
                          ? "Ya, Nonaktifkan"
                          : "Ya, Aktifkan"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Tombol Buka Konfirmasi Toggle Status */
            <button
              type="button"
              onClick={() => {
                triggerHaptic("light");
                setConfirmToggleOpen(true);
              }}
              className={`flex w-full items-center justify-between rounded-2xl border p-4 text-left active:scale-[0.99] transition-all shadow-sm ${
                isAktif
                  ? "border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/15"
                  : "border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/15"
              }`}
            >
              <div>
                <p
                  className={`text-sm font-bold ${isAktif ? "text-rose-300" : "text-emerald-300"}`}
                >
                  {isAktif
                    ? "Nonaktifkan Karyawan"
                    : "Aktifkan Kembali Karyawan"}
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
          )}

          {/* Informasi Sinkronisasi Real-Time */}
          <div className="rounded-2xl border border-white/5 bg-slate-950/60 p-3.5 mt-1">
            <div className="flex items-center gap-2">
              <Icon name="sync" className="size-3.5 text-sky-400" />
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Sinkronisasi Dua Arah
              </p>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mt-1">
              Setiap perubahan data karyawan dari perangkat ini otomatis
              terdaftar di outbox lokal dan disinkronkan ke Cloud Turso /
              Desktop.
            </p>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
