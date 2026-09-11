"use client";

import type { ChangeEvent } from "react";
import { useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import {
  downloadEmployeeTemplate,
  exportEmployees,
  readEmployeeWorkbook,
} from "@/lib/client/employee-workbook";
import { triggerHaptic } from "@/lib/client/haptics";
import {
  generateTokenMassal,
  importKaryawanMassal,
  type KaryawanInput,
} from "@/lib/gateways/employee";

/*
 * Aksi massal Master Karyawan untuk Mobile — padanan tombol "Import Excel"
 * dan "Generate QR Massal" di halaman Karyawan Web/Desktop.
 *
 * Berbeda dari Web, keduanya MENAHAN di dialog konfirmasi sebelum menulis:
 * impor menampilkan pratinjau hasil pembacaan berkas lebih dulu, karena satu
 * ketukan di layar sempit terlalu mudah terjadi tanpa sengaja.
 *
 * Pemanggil wajib menjaga komponen ini dengan izin `employees.manage` — izin
 * yang juga dituntut `desktop_import_employees` dan
 * `desktop_generate_employee_tokens` di backend.
 *
 * Unduh template & ekspor Excel menyimpan lewat `downloadDataUrl`, yang di
 * Android membuka dialog "Simpan ke…" (`mobile_save_file_to_device`). Menutup
 * dialog itu adalah pembatalan, bukan kegagalan.
 */

const PREVIEW_ROWS = 5;
const REQUIRED_COLUMNS = [
  "id_unik",
  "kode_karyawan",
  "nama",
  "divisi",
  "id_shift",
];

interface Props {
  /** Baris karyawan yang sedang tampil — isi berkas Ekspor Excel. */
  exportRows: Record<string, unknown>[];
  /** Dipanggil setelah data berubah — pesan sukses untuk banner halaman. */
  onCompleted: (message: string) => void;
  /** Pesan untuk banner halaman yang tidak mengubah data (ekspor/template). */
  onInfo: (message: string) => void;
  /** Pesan kegagalan untuk banner halaman. */
  onError: (message: string) => void;
}

export function EmployeeBulkActions({
  exportRows,
  onCompleted,
  onInfo,
  onError,
}: Props) {
  const isSubmittingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    fileName: string;
    drafts: KaryawanInput[];
  } | null>(null);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const handleFilePick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setParsing(true);
    try {
      // Validasi penuh (kolom wajib, format tiap baris, duplikat di dalam
      // berkas, batas 500) terjadi di sini, SEBELUM apa pun ditulis.
      const drafts = await readEmployeeWorkbook(file);
      triggerHaptic("light");
      setImportPreview({ fileName: file.name, drafts });
    } catch (err) {
      triggerHaptic("error");
      onError(
        err instanceof Error ? err.message : "Berkas Excel tidak dapat dibaca.",
      );
    } finally {
      setParsing(false);
    }
  };

  const runImport = async () => {
    if (!importPreview || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setBusy(true);
    try {
      const result = await importKaryawanMassal(importPreview.drafts);
      triggerHaptic("success");
      setImportPreview(null);
      onCompleted(
        `Import selesai: ${result.berhasil} berhasil, ${result.dilewati} dilewati karena sudah ada/gagal.`,
      );
    } catch (err) {
      triggerHaptic("error");
      setImportPreview(null);
      onError(err instanceof Error ? err.message : "Import Excel gagal.");
    } finally {
      isSubmittingRef.current = false;
      setBusy(false);
    }
  };

  /** Unduh template atau ekspor daftar — hanya menyimpan berkas, tanpa mutasi. */
  const saveWorkbookFile = async (kind: "template" | "export") => {
    if (saving) return;
    if (kind === "export" && exportRows.length === 0) return;
    setSaving(true);
    triggerHaptic("light");
    try {
      const res =
        kind === "template"
          ? await downloadEmployeeTemplate()
          : await exportEmployees(exportRows);
      if (res.cancelled) return;
      triggerHaptic("success");
      onInfo(
        kind === "template"
          ? "Template Excel karyawan tersimpan."
          : `${exportRows.length} data karyawan diekspor ke Excel.`,
      );
    } catch (err) {
      triggerHaptic("error");
      onError(
        err instanceof Error ? err.message : "Berkas Excel gagal disimpan.",
      );
    } finally {
      setSaving(false);
    }
  };

  const runGenerate = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setBusy(true);
    try {
      const result = await generateTokenMassal();
      triggerHaptic("success");
      setConfirmGenerate(false);
      onCompleted(
        result.total_generated > 0
          ? `Berhasil me-generate ${result.total_generated} token QR karyawan.`
          : "Semua karyawan sudah memiliki token QR. Tidak ada yang dibuat.",
      );
    } catch (err) {
      triggerHaptic("error");
      setConfirmGenerate(false);
      onError(
        err instanceof Error ? err.message : "Gagal membuat token QR massal.",
      );
    } finally {
      isSubmittingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-2xl border border-white/10 bg-slate-900/60 p-3">
      <div className="grid grid-cols-2 gap-2">
        <label
          htmlFor="employee-import-file"
          className={`flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-2 text-[11px] font-bold text-emerald-300 transition active:scale-95 ${
            parsing || busy ? "pointer-events-none opacity-50" : ""
          }`}
        >
          <Icon name="upload" className="size-4" />
          {parsing ? "Membaca berkas..." : "Impor Excel/CSV"}
          <input
            id="employee-import-file"
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            disabled={parsing || busy}
            onChange={(event) => void handleFilePick(event)}
            className="sr-only"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            triggerHaptic("light");
            setConfirmGenerate(true);
          }}
          disabled={busy}
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-2 text-[11px] font-bold text-amber-300 transition active:scale-95 disabled:opacity-50"
        >
          <Icon name="scanner" className="size-4" />
          Generate QR Massal
        </button>
        <button
          type="button"
          onClick={() => void saveWorkbookFile("template")}
          disabled={saving}
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2 text-[11px] font-bold text-slate-300 transition active:scale-95 disabled:opacity-50"
        >
          <Icon name="document" className="size-4" />
          Unduh template
        </button>
        <button
          type="button"
          onClick={() => void saveWorkbookFile("export")}
          disabled={saving || exportRows.length === 0}
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-sky-500/40 bg-sky-500/10 px-2 text-[11px] font-bold text-sky-300 transition active:scale-95 disabled:opacity-50"
        >
          <Icon name="download" className="size-4" />
          {saving ? "Menyimpan..." : `Ekspor Excel (${exportRows.length})`}
        </button>
      </div>

      <button
        type="button"
        onClick={() => setShowHint((current) => !current)}
        aria-expanded={showHint}
        className="mt-2 min-h-9 w-full text-left text-[11px] font-semibold text-sky-300"
      >
        {showHint ? "▾" : "▸"} Format berkas impor
      </button>
      {showHint ? (
        <div className="space-y-1.5 rounded-xl border border-white/10 bg-slate-950/60 p-2.5 text-[11px] leading-4 text-slate-400">
          <p>
            Baris pertama berisi judul kolom. Kolom wajib:{" "}
            <span className="font-mono text-slate-200">
              {REQUIRED_COLUMNS.join(", ")}
            </span>
            .
          </p>
          <p>
            Kolom opsional: jabatan_status, no_hp, lp, status_aktif,
            tanggal_daftar, catatan, jenis_personil, tanggal_mulai_aktif,
            tanggal_selesai_aktif.
          </p>
          <p>
            Paling mudah: tekan &quot;Unduh template&quot;, isi di aplikasi
            spreadsheet, lalu impor kembali.
          </p>
        </div>
      ) : null}

      {/* Pratinjau impor */}
      <Modal
        isOpen={Boolean(importPreview)}
        onClose={() => {
          if (!busy) setImportPreview(null);
        }}
        title="Impor karyawan"
        titleId="employee-import-title"
        subtitle={importPreview?.fileName}
        maxWidth="max-w-md"
        hideFooter
      >
        {importPreview ? (
          <div className="flex flex-col gap-3 text-xs">
            <p className="text-sm font-bold text-white">
              {importPreview.drafts.length} baris siap diimpor.
            </p>
            <ul className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-slate-950/60">
              {importPreview.drafts.slice(0, PREVIEW_ROWS).map((draft) => (
                <li
                  key={draft.id_unik}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <span className="truncate font-semibold text-slate-200">
                    {draft.nama}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-slate-500">
                    {draft.kode_karyawan} · {draft.divisi}
                  </span>
                </li>
              ))}
              {importPreview.drafts.length > PREVIEW_ROWS ? (
                <li className="px-3 py-2 text-[11px] text-slate-500">
                  …dan {importPreview.drafts.length - PREVIEW_ROWS} baris
                  lainnya
                </li>
              ) : null}
            </ul>
            <p className="rounded-xl border border-sky-500/20 bg-sky-500/10 p-2.5 text-[11px] leading-4 text-sky-200">
              Karyawan yang ID unik atau kode karyawannya sudah terdaftar
              DILEWATI, tidak ditimpa. Karyawan baru langsung dibuatkan token QR
              dan ikut tersinkron ke perangkat lain.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setImportPreview(null)}
                disabled={busy}
                className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/5 text-xs font-bold text-slate-300 transition active:scale-95 disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void runImport()}
                disabled={busy}
                className="min-h-11 flex-1 rounded-xl bg-emerald-500 text-xs font-black text-slate-950 shadow-lg transition active:scale-95 disabled:opacity-50"
              >
                {busy ? "Mengimpor..." : "Impor sekarang"}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Konfirmasi generate QR massal */}
      <Modal
        isOpen={confirmGenerate}
        onClose={() => {
          if (!busy) setConfirmGenerate(false);
        }}
        title="Generate QR Massal"
        titleId="employee-generate-title"
        maxWidth="max-w-sm"
        hideFooter
      >
        <div className="flex flex-col gap-3 text-xs">
          <p className="text-sm leading-6 text-slate-300">
            Buat token QR untuk semua karyawan yang belum memilikinya?
          </p>
          <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-[11px] leading-4 text-emerald-200">
            Karyawan yang SUDAH punya token tidak berubah — kartu QR yang sudah
            dicetak tetap berlaku.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmGenerate(false)}
              disabled={busy}
              className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/5 text-xs font-bold text-slate-300 transition active:scale-95 disabled:opacity-50"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={() => void runGenerate()}
              disabled={busy}
              className="min-h-11 flex-1 rounded-xl bg-amber-400 text-xs font-black text-slate-950 shadow-lg transition active:scale-95 disabled:opacity-50"
            >
              {busy ? "Membuat..." : "Generate"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
