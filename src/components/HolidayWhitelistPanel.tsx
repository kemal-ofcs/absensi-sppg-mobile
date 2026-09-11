"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { triggerHaptic } from "@/lib/client/haptics";
import { getDaftarKaryawan } from "@/lib/gateways/employee";
import {
  getHolidayWhitelist,
  type HolidayWhitelistEntry,
  type HolidayWhitelistInput,
  hapusHolidayWhitelist,
  tambahHolidayWhitelist,
  updateHolidayWhitelist,
} from "@/lib/gateways/holiday-whitelist";
import { getDaftarShift } from "@/lib/gateways/shift";

/*
 * Cerminan Mobile dari `web-desktop/src/components/HolidayWhitelistPanel.tsx`.
 * Komponen Web tidak ikut disalin `sync-frontend-lib.ts`, jadi versi ini
 * dipelihara sendiri — logikanya sengaja identik, hanya tata letaknya kartu.
 *
 * Cakupan disimpan sebagai KODE shift dan NAMA divisi — bukan id_shift — karena
 * id itu AUTOINCREMENT yang berbeda di tiap perangkat, sehingga whitelist yang
 * dibuat di satu perangkat akan menunjuk shift lain begitu tersinkronisasi.
 */

const EMPTY_DRAFT: HolidayWhitelistInput = {
  scope_type: "DIVISI",
  scope_value: "",
  tanggal_libur: null,
  keterangan: "",
  status_aktif: 1,
};

const INPUT_CLASS =
  "min-h-11 w-full rounded-xl border border-white/15 bg-slate-950 px-3 text-xs text-white placeholder-slate-500 outline-none transition focus:border-emerald-400";

interface ShiftOption {
  kode: number;
  nama: string;
}

export function HolidayWhitelistPanel({ canManage }: { canManage: boolean }) {
  const [entries, setEntries] = useState<HolidayWhitelistEntry[]>([]);
  const [shifts, setShifts] = useState<ShiftOption[]>([]);
  const [divisiOptions, setDivisiOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const isSubmittingRef = useRef(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<HolidayWhitelistInput>(EMPTY_DRAFT);
  const [deleteTarget, setDeleteTarget] =
    useState<HolidayWhitelistEntry | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [list, shiftRows, employeeRows] = await Promise.all([
        getHolidayWhitelist(),
        // Daftar shift & karyawan hanya pengisi pilihan. Gagal memuatnya
        // (mis. operator tanpa izin employees.view) TIDAK boleh menghalangi
        // pengelolaan whitelist — nama divisi tetap bisa diketik manual.
        getDaftarShift().catch(() => [] as Record<string, unknown>[]),
        getDaftarKaryawan().catch(() => [] as Record<string, unknown>[]),
      ]);
      setEntries(list);
      setDivisiOptions(
        Array.from(
          new Set(
            employeeRows
              .map((row) => String(row.divisi ?? "").trim())
              .filter((value) => value !== ""),
          ),
        ).sort((a, b) => a.localeCompare(b, "id-ID")),
      );
      setShifts(
        shiftRows
          .map((row) => ({
            kode: Number(row.kode_shift ?? 0),
            nama: String(row.nama_shift ?? ""),
          }))
          .filter((row) => Number.isFinite(row.kode) && row.kode > 0),
      );
    } catch (err) {
      if (!silent) {
        setFeedback({
          type: "error",
          message:
            err instanceof Error
              ? err.message
              : "Gagal memuat whitelist hari libur.",
        });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Tarik-untuk-segarkan memancarkan event ini; muat ulang tanpa spinner.
  useEffect(() => {
    const onSyncCompleted = () => {
      void loadData(true);
    };
    window.addEventListener("sppg:sync-completed", onSyncCompleted);
    return () => {
      window.removeEventListener("sppg:sync-completed", onSyncCompleted);
    };
  }, [loadData]);

  const shiftLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const shift of shifts) map.set(String(shift.kode), shift.nama);
    return map;
  }, [shifts]);

  const describeScope = (item: HolidayWhitelistEntry) => {
    if (item.scope_type === "SHIFT") {
      const nama = shiftLabel.get(item.scope_value.trim());
      return nama
        ? `Shift ${item.scope_value} - ${nama}`
        : `Shift kode ${item.scope_value}`;
    }
    return `Divisi ${item.scope_value}`;
  };

  const handleOpenAdd = () => {
    triggerHaptic("light");
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setModalOpen(true);
  };

  const handleOpenEdit = (item: HolidayWhitelistEntry) => {
    triggerHaptic("light");
    setEditingId(item.id);
    setDraft({
      scope_type: item.scope_type,
      scope_value: item.scope_value,
      tanggal_libur: item.tanggal_libur,
      keterangan: item.keterangan ?? "",
      status_aktif: item.status_aktif,
    });
    setModalOpen(true);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    if (!draft.scope_value.trim()) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        message:
          draft.scope_type === "SHIFT"
            ? "Pilih Shift yang boleh scan saat hari libur."
            : "Isi nama Divisi yang boleh scan saat hari libur.",
      });
      return;
    }

    isSubmittingRef.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      if (editingId) {
        await updateHolidayWhitelist(editingId, draft);
        setFeedback({ type: "success", message: "Whitelist diperbarui." });
      } else {
        await tambahHolidayWhitelist(draft);
        setFeedback({ type: "success", message: "Whitelist ditambahkan." });
      }
      triggerHaptic("success");
      setModalOpen(false);
      await loadData();
    } catch (err) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Gagal menyimpan whitelist.",
      });
    } finally {
      isSubmittingRef.current = false;
      setSaving(false);
    }
  };

  const handleToggle = async (item: HolidayWhitelistEntry) => {
    if (!canManage || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSaving(true);
    const nextStatus = item.status_aktif === 1 ? 0 : 1;
    try {
      await updateHolidayWhitelist(item.id, {
        scope_type: item.scope_type,
        scope_value: item.scope_value,
        tanggal_libur: item.tanggal_libur,
        keterangan: item.keterangan,
        status_aktif: nextStatus,
      });
      triggerHaptic("light");
      setEntries((prev) =>
        prev.map((row) =>
          row.id === item.id ? { ...row, status_aktif: nextStatus } : row,
        ),
      );
    } catch (err) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Gagal mengubah status.",
      });
    } finally {
      isSubmittingRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      await hapusHolidayWhitelist(deleteTarget.id);
      triggerHaptic("success");
      setFeedback({ type: "success", message: "Whitelist dihapus." });
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Gagal menghapus whitelist.",
      });
    } finally {
      isSubmittingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-3xl border border-emerald-500/20 bg-slate-900/80 p-4">
      <header className="space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-xl bg-emerald-500/15 text-emerald-300">
            <Icon name="lock" className="size-4" />
          </div>
          <h2 className="text-sm font-black text-white">
            Whitelist Scan Hari Libur
          </h2>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          Hanya karyawan dengan Shift atau Divisi di daftar ini yang boleh scan
          QR pada tanggal hari libur aktif — misalnya Shift Satpam, Divisi
          Keamanan, Maintenance, atau Teknisi. Karyawan lain ditolak dan{" "}
          <strong className="text-slate-300">tidak</strong> kena Alfa. Jam kerja
          pada tanggal libur dihitung memakai Aturan Jenjang Lembur{" "}
          <strong className="text-slate-300">HARI_LIBUR</strong>.
        </p>
      </header>

      {canManage ? (
        <button
          type="button"
          onClick={handleOpenAdd}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-xs font-black text-slate-950 shadow-md transition hover:bg-emerald-400 active:scale-95"
        >
          <Icon name="plus" className="size-4" />
          Tambah Whitelist
        </button>
      ) : null}

      {feedback ? (
        <FeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onClose={() => setFeedback(null)}
        />
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-2xl border border-white/5 bg-slate-950/40"
            />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-5 text-center">
          <p className="text-xs font-semibold text-slate-300">
            Belum ada Shift atau Divisi yang di-whitelist.
          </p>
          <p className="mt-1 text-[11px] leading-4 text-slate-500">
            Selama daftar ini kosong, seluruh scan pada hari libur ditolak —
            sama seperti perilaku aplikasi sebelumnya.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((item) => {
            const isAktif = item.status_aktif === 1;
            return (
              <li
                key={item.id}
                className="flex flex-col gap-2.5 rounded-2xl border border-white/10 bg-slate-950/50 p-3"
              >
                <div className="min-w-0 space-y-1.5">
                  <p className="text-sm font-bold text-white">
                    {describeScope(item)}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                        isAktif
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                          : "border-white/15 bg-slate-500/15 text-slate-300"
                      }`}
                    >
                      {isAktif ? "Aktif" : "Nonaktif"}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                        item.tanggal_libur
                          ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                          : "border-sky-500/40 bg-sky-500/15 text-sky-300"
                      }`}
                    >
                      {item.tanggal_libur
                        ? `Khusus ${item.tanggal_libur}`
                        : "Semua hari libur"}
                    </span>
                  </div>
                  {item.keterangan ? (
                    <p className="text-[11px] text-slate-400">
                      {item.keterangan}
                    </p>
                  ) : null}
                </div>
                {canManage ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleToggle(item)}
                      disabled={saving}
                      className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/5 text-[11px] font-bold text-slate-300 transition active:scale-95 disabled:opacity-50"
                    >
                      {isAktif ? "Nonaktifkan" : "Aktifkan"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(item)}
                      className="min-h-11 flex-1 rounded-xl border border-sky-300/20 bg-sky-300/10 text-[11px] font-bold text-sky-200 transition active:scale-95"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic("warning");
                        setDeleteTarget(item);
                      }}
                      className="min-h-11 flex-1 rounded-xl border border-rose-300/20 bg-rose-300/10 text-[11px] font-bold text-rose-200 transition active:scale-95"
                    >
                      Hapus
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        isOpen={modalOpen}
        onClose={() => {
          if (!saving) setModalOpen(false);
        }}
        title={editingId ? "Edit Whitelist" : "Tambah Whitelist"}
        titleId="whitelist-modal-title"
        maxWidth="max-w-md"
        hideFooter
      >
        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          <div>
            <label
              htmlFor="whitelist-scope-type"
              className="mb-1 block text-[11px] font-semibold text-slate-400"
            >
              Cakupan
            </label>
            <select
              id="whitelist-scope-type"
              value={draft.scope_type}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  scope_type: event.target.value,
                  scope_value: "",
                }))
              }
              className={INPUT_CLASS}
            >
              <option value="DIVISI">Divisi</option>
              <option value="SHIFT">Shift</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="whitelist-scope-value"
              className="mb-1 block text-[11px] font-semibold text-slate-400"
            >
              {draft.scope_type === "SHIFT" ? "Shift" : "Nama Divisi"}
            </label>
            {draft.scope_type === "SHIFT" ? (
              <select
                id="whitelist-scope-value"
                value={draft.scope_value}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    scope_value: event.target.value,
                  }))
                }
                className={INPUT_CLASS}
              >
                <option value="">— Pilih Shift —</option>
                {shifts.map((shift) => (
                  <option key={shift.kode} value={String(shift.kode)}>
                    {shift.kode} - {shift.nama}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  id="whitelist-scope-value"
                  list="whitelist-divisi-options"
                  value={draft.scope_value}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      scope_value: event.target.value,
                    }))
                  }
                  placeholder="Contoh: Keamanan"
                  className={INPUT_CLASS}
                />
                <datalist id="whitelist-divisi-options">
                  {divisiOptions.map((divisi) => (
                    <option key={divisi} value={divisi} />
                  ))}
                </datalist>
              </>
            )}
          </div>

          <div>
            <label
              htmlFor="whitelist-tanggal"
              className="mb-1 block text-[11px] font-semibold text-slate-400"
            >
              Berlaku pada tanggal (opsional)
            </label>
            <input
              id="whitelist-tanggal"
              type="date"
              value={draft.tanggal_libur ?? ""}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  tanggal_libur: event.target.value || null,
                }))
              }
              className={`${INPUT_CLASS} font-mono`}
            />
            <p className="mt-1 text-[10px] leading-4 text-slate-500">
              Kosongkan agar berlaku untuk SEMUA hari libur. Isi hanya bila
              pengecualian ini khusus satu tanggal.
            </p>
          </div>

          <div>
            <label
              htmlFor="whitelist-keterangan"
              className="mb-1 block text-[11px] font-semibold text-slate-400"
            >
              Keterangan (opsional)
            </label>
            <input
              id="whitelist-keterangan"
              value={draft.keterangan ?? ""}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  keterangan: event.target.value,
                }))
              }
              placeholder="Contoh: Piket jaga gedung"
              className={INPUT_CLASS}
            />
          </div>

          <div className="flex items-center gap-2 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              disabled={saving}
              className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/5 text-xs font-bold text-slate-300 transition hover:bg-white/10 active:scale-95 disabled:opacity-50"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-11 flex-1 rounded-xl bg-emerald-500 text-xs font-black text-slate-950 shadow-lg transition hover:bg-emerald-400 active:scale-95 disabled:opacity-50"
            >
              {saving ? "Menyimpan…" : "Simpan"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(deleteTarget)}
        onClose={() => {
          if (!saving) setDeleteTarget(null);
        }}
        title="Hapus Whitelist"
        titleId="whitelist-delete-title"
        maxWidth="max-w-sm"
        hideFooter
      >
        {deleteTarget ? (
          <div className="flex flex-col gap-4 text-xs">
            <div className="rounded-2xl border border-rose-500/20 bg-rose-950/30 p-3.5">
              <p className="text-sm leading-6 text-slate-300">
                Hapus{" "}
                <strong className="text-white">
                  {describeScope(deleteTarget)}
                </strong>{" "}
                dari whitelist?
              </p>
              <p className="mt-1 text-[11px] leading-4 text-slate-400">
                Setelah dihapus, karyawan pada cakupan itu tidak lagi bisa scan
                pada hari libur.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={saving}
                className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/5 text-xs font-bold text-slate-300 transition hover:bg-white/10 active:scale-95 disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={saving}
                className="min-h-11 flex-1 rounded-xl bg-rose-500 text-xs font-black text-on-accent shadow-lg transition hover:bg-rose-600 active:scale-95 disabled:opacity-50"
              >
                {saving ? "Menghapus…" : "Hapus"}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
