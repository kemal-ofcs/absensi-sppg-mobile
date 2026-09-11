"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HolidayWhitelistPanel } from "@/components/HolidayWhitelistPanel";
import { MobileAppShell } from "@/components/MobileAppShell";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { canAccessArea, hasPermission } from "@/lib/auth/access";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import {
  getDaftarHariLibur,
  type HariLiburInput,
  type HariLiburRecord,
  hapusHariLibur,
  tambahHariLibur,
  updateHariLibur,
} from "@/lib/gateways/holiday";
import { useDebounce } from "@/lib/hooks/useDebounce";

/*
 * Cerminan Mobile dari `web-desktop/src/app/holidays/page.tsx`. Logikanya
 * identik — gateway, izin `holidays.view`/`holidays.manage`, dan panel
 * whitelist — hanya tabelnya diganti daftar kartu. Biner Mobile sudah
 * mendaftarkan seluruh command `desktop_*_holiday*` yang dipanggil gateway.
 */

const JENIS_OPTIONS = ["Libur Nasional", "Cuti Bersama", "Libur Khusus"];

const INPUT_CLASS =
  "min-h-11 w-full rounded-xl border border-white/15 bg-slate-950 px-3 text-xs text-white placeholder-slate-500 outline-none transition focus:border-sky-400";

function todayLocal() {
  // Tanggal lokal perangkat, bukan UTC: `toISOString()` menggeser tanggal
  // pada dini hari WIB.
  return new Date().toLocaleDateString("en-CA");
}

function formatDisplayDate(dateStr: string) {
  if (!dateStr) return "-";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(y, m - 1, d));
}

function jenisTone(jenis: string) {
  if (jenis === "Libur Nasional")
    return "border-emerald-500/40 bg-emerald-500/15 text-emerald-300";
  if (jenis === "Cuti Bersama")
    return "border-amber-500/40 bg-amber-500/15 text-amber-300";
  return "border-purple-500/40 bg-purple-500/15 text-purple-300";
}

export default function MobileHolidaysPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const canView = canAccessArea(user, "holidays");
  const canManage = hasPermission(user, "holidays.manage");

  const [holidays, setHolidays] = useState<HariLiburRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const isSubmittingRef = useRef(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [filterJenis, setFilterJenis] = useState("all");
  const [filterYear, setFilterYear] = useState("all");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<HariLiburInput>({
    tanggal: "",
    nama_libur: "",
    jenis_libur: "Libur Nasional",
    keterangan: "",
    status_aktif: 1,
  });
  const [deleteTarget, setDeleteTarget] = useState<HariLiburRecord | null>(
    null,
  );
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/login");
      return;
    }
    // Mobile memakai static export dan tidak punya rute `/forbidden`.
    if (!authLoading && isAuthenticated && !canView) {
      router.replace("/settings");
    }
  }, [authLoading, isAuthenticated, canView, router]);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setHolidays(await getDaftarHariLibur());
    } catch (err) {
      if (!silent) {
        setFeedback({
          type: "error",
          message:
            err instanceof Error
              ? err.message
              : "Gagal memuat daftar hari libur.",
        });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && canView) void loadData();
  }, [isAuthenticated, canView, loadData]);

  useEffect(() => {
    const onSyncCompleted = () => {
      void loadData(true);
    };
    window.addEventListener("sppg:sync-completed", onSyncCompleted);
    return () => {
      window.removeEventListener("sppg:sync-completed", onSyncCompleted);
    };
  }, [loadData]);

  const availableYears = useMemo(
    () =>
      Array.from(
        new Set(holidays.map((h) => h.tanggal.split("-")[0]).filter(Boolean)),
      ).sort((a, b) => Number(b) - Number(a)),
    [holidays],
  );

  const filteredHolidays = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    return holidays.filter((h) => {
      const matchSearch =
        !term ||
        h.nama_libur.toLowerCase().includes(term) ||
        (h.keterangan || "").toLowerCase().includes(term) ||
        h.tanggal.includes(term);
      const matchJenis = filterJenis === "all" || h.jenis_libur === filterJenis;
      const matchYear =
        filterYear === "all" || h.tanggal.startsWith(`${filterYear}-`);
      return matchSearch && matchJenis && matchYear;
    });
  }, [holidays, debouncedSearch, filterJenis, filterYear]);

  const activeCount = holidays.filter((h) => h.status_aktif === 1).length;

  const handleOpenAdd = () => {
    triggerHaptic("light");
    setEditingId(null);
    setDraft({
      tanggal: todayLocal(),
      nama_libur: "",
      jenis_libur: "Libur Nasional",
      keterangan: "",
      status_aktif: 1,
    });
    setModalOpen(true);
  };

  const handleOpenEdit = (item: HariLiburRecord) => {
    triggerHaptic("light");
    setEditingId(item.id_libur);
    setDraft({
      tanggal: item.tanggal,
      nama_libur: item.nama_libur,
      jenis_libur: item.jenis_libur,
      keterangan: item.keterangan || "",
      status_aktif: item.status_aktif,
    });
    setModalOpen(true);
  };

  const handleToggleStatus = async (item: HariLiburRecord) => {
    if (!canManage || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSaving(true);
    const nextStatus = item.status_aktif === 1 ? 0 : 1;
    try {
      await updateHariLibur(item.id_libur, { status_aktif: nextStatus });
      triggerHaptic("light");
      setHolidays((prev) =>
        prev.map((h) =>
          h.id_libur === item.id_libur ? { ...h, status_aktif: nextStatus } : h,
        ),
      );
      setFeedback({
        type: "success",
        message: `Status libur "${item.nama_libur}" diubah menjadi ${nextStatus === 1 ? "Aktif" : "Nonaktif"}.`,
      });
    } catch (err) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal mengubah status hari libur.",
      });
    } finally {
      isSubmittingRef.current = false;
      setSaving(false);
    }
  };

  const handleFormSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    if (!draft.tanggal || !draft.nama_libur.trim()) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        message: "Tanggal dan nama hari libur wajib diisi.",
      });
      return;
    }

    isSubmittingRef.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      if (editingId) {
        await updateHariLibur(editingId, draft);
        setFeedback({
          type: "success",
          message: "Data hari libur berhasil diperbarui.",
        });
      } else {
        await tambahHariLibur(draft);
        setFeedback({
          type: "success",
          message: "Hari libur baru berhasil ditambahkan.",
        });
      }
      triggerHaptic("success");
      setModalOpen(false);
      await loadData();
    } catch (err) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Gagal menyimpan data hari libur.",
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
      await hapusHariLibur(deleteTarget.id_libur);
      triggerHaptic("success");
      setFeedback({
        type: "success",
        message: `Hari libur "${deleteTarget.nama_libur}" berhasil dihapus.`,
      });
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Gagal menghapus hari libur.",
      });
    } finally {
      isSubmittingRef.current = false;
      setSaving(false);
    }
  };

  if (authLoading || !isAuthenticated || !canView) {
    return <div className="min-h-dvh bg-slate-950" />;
  }

  return (
    <MobileAppShell>
      <div className="flex flex-col gap-4 text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("light");
                router.push("/settings");
              }}
              aria-label="Kembali ke Pengaturan"
              className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/5 text-slate-300 transition hover:bg-white/10 active:scale-95"
            >
              <Icon name="arrow-left" className="size-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-black tracking-tight text-white">
                  Hari Libur
                </h1>
                <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-bold text-sky-300">
                  {activeCount} aktif
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Kalender libur, cuti bersama &amp; whitelist scan
              </p>
            </div>
          </div>
        </div>

        <p className="rounded-2xl border border-sky-500/20 bg-sky-950/30 p-3 text-[11px] leading-4 text-slate-300">
          Pada tanggal libur <strong className="text-white">aktif</strong>, QR
          Scanner hanya melayani Shift/Divisi yang terdaftar di Whitelist, dan
          Generate Alfa dilewati sehingga yang libur tidak kena Alfa.
        </p>

        {feedback ? (
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            onClose={() => setFeedback(null)}
          />
        ) : null}

        {/* Filter & Aksi */}
        <div className="flex flex-col gap-3 rounded-3xl border border-white/15 bg-slate-900/90 p-3 shadow-xl">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cari nama, keterangan, atau tanggal..."
            aria-label="Cari hari libur"
            className={INPUT_CLASS}
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={filterJenis}
              onChange={(event) => setFilterJenis(event.target.value)}
              aria-label="Filter jenis hari libur"
              className={INPUT_CLASS}
            >
              <option value="all">Semua Jenis</option>
              {JENIS_OPTIONS.map((jenis) => (
                <option key={jenis} value={jenis}>
                  {jenis}
                </option>
              ))}
            </select>
            <select
              value={filterYear}
              onChange={(event) => setFilterYear(event.target.value)}
              aria-label="Filter tahun hari libur"
              className={INPUT_CLASS}
            >
              <option value="all">Semua Tahun</option>
              {availableYears.map((year) => (
                <option key={year} value={year}>
                  Tahun {year}
                </option>
              ))}
            </select>
          </div>
          {canManage ? (
            <button
              type="button"
              onClick={handleOpenAdd}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-500 text-xs font-black text-slate-950 shadow-md transition hover:bg-sky-400 active:scale-95"
            >
              <Icon name="plus" className="size-4" />
              Tambah Hari Libur
            </button>
          ) : null}
        </div>

        {/* Daftar Hari Libur */}
        <div className="flex flex-col gap-2">
          <span className="px-1 text-xs font-bold uppercase tracking-wider text-slate-400">
            Daftar Hari Libur ({filteredHolidays.length})
          </span>
          {loading ? (
            [1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-2xl border border-white/5 bg-slate-900/40"
              />
            ))
          ) : filteredHolidays.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/40 p-8 text-center text-xs text-slate-500">
              <Icon name="calendar" className="size-7 text-slate-600" />
              {holidays.length === 0
                ? "Belum ada hari libur yang terdaftar."
                : "Tidak ada hari libur yang sesuai filter."}
            </div>
          ) : (
            filteredHolidays.map((item) => {
              const isAktif = item.status_aktif === 1;
              return (
                <article
                  key={item.id_libur}
                  className={`flex flex-col gap-2.5 rounded-2xl border bg-slate-900/80 p-3.5 ${
                    isAktif ? "border-white/10" : "border-white/5 opacity-75"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sky-500/10 text-sky-400">
                        <Icon name="calendar" className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-white">
                          {item.nama_libur}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {formatDisplayDate(item.tanggal)}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${jenisTone(item.jenis_libur)}`}
                    >
                      {item.jenis_libur}
                    </span>
                  </div>

                  {item.keterangan ? (
                    <p className="rounded-xl bg-white/5 p-2 text-[11px] text-slate-300">
                      {item.keterangan}
                    </p>
                  ) : null}

                  <div className="flex items-center gap-2">
                    {canManage ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleToggleStatus(item)}
                          disabled={saving}
                          aria-label={`Ubah status ${item.nama_libur}, saat ini ${isAktif ? "Aktif" : "Nonaktif"}`}
                          className={`min-h-11 flex-1 rounded-xl border text-[11px] font-bold transition active:scale-95 disabled:opacity-50 ${
                            isAktif
                              ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                              : "border-white/10 bg-slate-800 text-slate-400"
                          }`}
                        >
                          {isAktif ? "● Aktif" : "○ Nonaktif"}
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
                      </>
                    ) : (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                          isAktif
                            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                            : "border-rose-500/40 bg-rose-500/15 text-rose-300"
                        }`}
                      >
                        {isAktif ? "Aktif" : "Nonaktif"}
                      </span>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>

        <HolidayWhitelistPanel canManage={canManage} />
      </div>

      {/* Modal Form Tambah / Edit */}
      <Modal
        isOpen={modalOpen}
        onClose={() => {
          if (!saving) setModalOpen(false);
        }}
        title={editingId ? "Edit Hari Libur" : "Tambah Hari Libur"}
        titleId="holiday-form-modal-title"
        maxWidth="max-w-md"
        hideFooter
      >
        <form onSubmit={handleFormSubmit} className="space-y-3.5 text-xs">
          <div>
            <label
              htmlFor="holiday-date"
              className="mb-1 block text-[11px] font-semibold text-slate-400"
            >
              Tanggal Libur *
            </label>
            <input
              id="holiday-date"
              type="date"
              required
              value={draft.tanggal}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, tanggal: event.target.value }))
              }
              className={`${INPUT_CLASS} font-mono`}
            />
          </div>

          <div>
            <label
              htmlFor="holiday-name"
              className="mb-1 block text-[11px] font-semibold text-slate-400"
            >
              Nama Hari Libur *
            </label>
            <input
              id="holiday-name"
              type="text"
              required
              placeholder="Contoh: Hari Kemerdekaan RI"
              value={draft.nama_libur}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  nama_libur: event.target.value,
                }))
              }
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label
              htmlFor="holiday-type"
              className="mb-1 block text-[11px] font-semibold text-slate-400"
            >
              Jenis Hari Libur
            </label>
            <select
              id="holiday-type"
              value={draft.jenis_libur}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  jenis_libur: event.target.value,
                }))
              }
              className={INPUT_CLASS}
            >
              <option value="Libur Nasional">Libur Nasional</option>
              <option value="Cuti Bersama">Cuti Bersama</option>
              <option value="Libur Khusus">Libur Khusus / Perusahaan</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="holiday-notes"
              className="mb-1 block text-[11px] font-semibold text-slate-400"
            >
              Keterangan (opsional)
            </label>
            <textarea
              id="holiday-notes"
              rows={2}
              placeholder="Keterangan tambahan..."
              value={draft.keterangan || ""}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  keterangan: event.target.value,
                }))
              }
              className={`${INPUT_CLASS} py-2.5`}
            />
          </div>

          <label
            htmlFor="holiday-active"
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/50 p-3"
          >
            <input
              id="holiday-active"
              type="checkbox"
              checked={draft.status_aktif === 1 || draft.status_aktif === true}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  status_aktif: event.target.checked ? 1 : 0,
                }))
              }
              className="mt-0.5 size-4 shrink-0 accent-sky-400"
            />
            <span className="text-[11px] leading-4 text-slate-300">
              <strong className="text-white">Status Aktif</strong>
              <br />
              Hanya hari libur berstatus Aktif yang membatasi scanner dan
              melewati Generate Alfa.
            </span>
          </label>

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
              className="min-h-11 flex-1 rounded-xl bg-sky-500 text-xs font-black text-slate-950 shadow-lg transition hover:bg-sky-400 active:scale-95 disabled:opacity-50"
            >
              {saving ? "Menyimpan..." : "Simpan Hari Libur"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Konfirmasi Hapus */}
      <Modal
        isOpen={Boolean(deleteTarget)}
        onClose={() => {
          if (!saving) setDeleteTarget(null);
        }}
        title="Hapus Hari Libur"
        titleId="holiday-delete-modal-title"
        maxWidth="max-w-sm"
        hideFooter
      >
        {deleteTarget ? (
          <div className="flex flex-col gap-4 text-xs">
            <div className="rounded-2xl border border-rose-500/20 bg-rose-950/30 p-3.5">
              <p className="text-sm leading-6 text-slate-300">
                Hapus hari libur{" "}
                <strong className="text-white">
                  &quot;{deleteTarget.nama_libur}&quot;
                </strong>{" "}
                pada{" "}
                <strong className="text-white">
                  {formatDisplayDate(deleteTarget.tanggal)}
                </strong>
                ?
              </p>
              <p className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-2 text-[11px] leading-4 text-amber-100">
                Setelah dihapus, scanner dan Generate Alfa pada tanggal itu
                kembali berjalan normal.
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
                {saving ? "Menghapus..." : "Hapus"}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </MobileAppShell>
  );
}
