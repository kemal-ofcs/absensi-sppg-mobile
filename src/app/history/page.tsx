"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MobileAppShell } from "@/components/MobileAppShell";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { canAccessArea, hasPermission } from "@/lib/auth/access";
import { exportToCsv, exportToExcel } from "@/lib/client/excel-export";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import {
  editAbsensiHarian,
  getRekapHarian,
  getRiwayatScan,
  hapusLogScan,
} from "@/lib/gateways/report";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { buildDailyExport, buildScanLogExport } from "./history-export";

type HistoryTab = "daily" | "scan-logs";

interface EditAbsensiDraft {
  id_sesi: string;
  nama: string;
  id_karyawan: string;
  tanggal: string;
  jam_masuk: string;
  jam_pulang: string;
  status_kehadiran: string;
  status_absen: string;
  keterangan: string;
}

interface DeleteScanTarget {
  id_log: number;
  nama: string;
  id_karyawan: string;
  jenis_scan: string;
  jam_scan: string;
}

/**
 * Backend membatasi log scan per permintaan (bawaan 200, maksimal 500). Satu
 * hari di instansi besar bisa melebihi itu — 800 orang x 2 scan — jadi halaman
 * diambil sampai habis. Tanpa ini daftar DAN ekspor terpotong diam-diam.
 */
const SCAN_PAGE_SIZE = 500;
/** Pagar pengaman: bug di sisi lain tidak boleh jadi perulangan tanpa akhir. */
const MAX_SCAN_PAGES = 40;

async function fetchAllScanLogs(tanggal: string) {
  const all: Record<string, unknown>[] = [];
  for (let page = 0; page < MAX_SCAN_PAGES; page++) {
    const batch =
      (await getRiwayatScan({
        tanggal,
        limit: SCAN_PAGE_SIZE,
        offset: page * SCAN_PAGE_SIZE,
      })) ?? [];
    all.push(...batch);
    if (batch.length < SCAN_PAGE_SIZE) break;
  }
  return all;
}

const EDIT_INPUT_CLASS =
  "min-h-11 w-full rounded-xl border border-white/15 bg-slate-950 px-3 text-xs text-white outline-none focus:border-sky-400";

function formatTimeOnly(timeStr: unknown): string {
  if (!timeStr || typeof timeStr !== "string") return "--:--";
  const s = timeStr.trim();
  if (!s || s === "-" || s === "--:--") return "--:--";
  const clean = s.includes(" ")
    ? s.split(" ")[1]
    : s.includes("T")
      ? s.split("T")[1]?.split(".")[0]?.split("Z")[0] || ""
      : s;
  if (!clean) return "--:--";
  const parts = clean.split(":");
  if (parts.length < 2) return clean;
  const h = parts[0].padStart(2, "0");
  const m = parts[1].padStart(2, "0");
  const sec = parts[2] ? parts[2].slice(0, 2).padStart(2, "0") : "00";
  return `${h}:${m}:${sec}`;
}

function formatMinutesToHours(min: unknown): string {
  const num = Number(min || 0);
  if (num <= 0) return "0 mnt";
  const hours = (num / 60).toFixed(1).replace(/\.0$/, "");
  return `${num} mnt (${hours} jam)`;
}

/** Nilai untuk input jam bertipe time (HH:mm), atau kosong bila belum ada. */
function toTimeInput(value: unknown): string {
  const time = formatTimeOnly(value);
  return time === "--:--" ? "" : time.slice(0, 5);
}

/**
 * Bentuk jam yang dikirim ke backend, identik dengan halaman Riwayat
 * Web/Desktop: `YYYY-MM-DD HH:mm:00` pada tanggal kerja. Backend sendiri yang
 * memindahkan jam pulang shift malam ke hari berikutnya.
 */
function toPatchTime(time: string, date: string): string {
  const clean = time.trim();
  if (!clean) return "";
  if (clean.includes(" ") || clean.includes("T")) return clean;
  return `${date} ${clean.slice(0, 5)}:00`;
}

export default function HistoryPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const canViewHistory = canAccessArea(user, "history");
  // Keduanya masuk SENSITIVE_MUTATION_PERMISSIONS: absensi historis adalah
  // sumber perhitungan payroll. Backend Rust tetap memeriksa ulang izinnya.
  const canEditHistory = hasPermission(user, "history.edit");
  const canDeleteHistory = hasPermission(user, "history.delete");

  const [activeTab, setActiveTab] = useState<HistoryTab>("daily");
  const [date, setDate] = useState<string>(
    () => new Date().toISOString().split("T")[0],
  );
  const [dailyRecords, setDailyRecords] = useState<Record<string, unknown>[]>(
    [],
  );
  const [scanLogs, setScanLogs] = useState<Record<string, unknown>[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("Semua");

  // Modal State
  const [selectedDaily, setSelectedDaily] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [selectedScanLog, setSelectedScanLog] = useState<Record<
    string,
    unknown
  > | null>(null);

  // CRUD State
  const [editData, setEditData] = useState<EditAbsensiDraft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteScanTarget | null>(
    null,
  );
  const [actionBusy, setActionBusy] = useState(false);
  const isSubmittingRef = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/login");
      return;
    }
    // Ditolak izin area: dipulangkan, sama seperti Project Meksa. Mobile
    // memakai static export dan tidak punya rute `/forbidden`.
    if (!authLoading && isAuthenticated && !canViewHistory) {
      router.replace("/dashboard");
    }
  }, [authLoading, isAuthenticated, canViewHistory, router]);

  const loadData = useCallback(async (targetDate: string, tab: HistoryTab) => {
    setIsLoading(true);
    try {
      if (tab === "daily") {
        const data = await getRekapHarian({ tanggal: targetDate });
        setDailyRecords(data || []);
      } else {
        setScanLogs(await fetchAllScanLogs(targetDate));
      }
    } catch {
      if (tab === "daily") setDailyRecords([]);
      else setScanLogs([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && canViewHistory) {
      void loadData(date, activeTab);
    }
  }, [date, activeTab, isAuthenticated, canViewHistory, loadData]);

  useEffect(() => {
    const onSyncCompleted = () => {
      if (isAuthenticated && canViewHistory) {
        void loadData(date, activeTab);
      }
    };
    window.addEventListener("sppg:sync-completed", onSyncCompleted);
    return () => {
      window.removeEventListener("sppg:sync-completed", onSyncCompleted);
    };
  }, [date, activeTab, isAuthenticated, canViewHistory, loadData]);

  const handleTabChange = (tab: HistoryTab) => {
    triggerHaptic("light");
    setActiveTab(tab);
    setStatusFilter("Semua");
  };

  const handleDateChange = (newDate: string) => {
    triggerHaptic("light");
    setDate(newDate);
  };

  const openEditDaily = (rec: Record<string, unknown>) => {
    triggerHaptic("light");
    setSelectedDaily(null);
    setEditData({
      id_sesi: String(rec.id_sesi || ""),
      nama: String(rec.nama || ""),
      id_karyawan: String(rec.id_karyawan || ""),
      tanggal: String(rec.tanggal || date),
      jam_masuk: toTimeInput(rec.jam_masuk),
      jam_pulang: toTimeInput(rec.jam_pulang),
      status_kehadiran: String(rec.status_kehadiran || "Hadir"),
      status_absen: String(rec.status_absen || "Lengkap"),
      keterangan: String(rec.keterangan || ""),
    });
  };

  const openDeleteScanLog = (log: Record<string, unknown>) => {
    triggerHaptic("warning");
    setSelectedScanLog(null);
    setDeleteTarget({
      id_log: Number(log.id_log),
      nama: String(log.nama || "-"),
      id_karyawan: String(log.id_karyawan || "-"),
      jenis_scan: String(log.jenis_scan || "-"),
      jam_scan: formatTimeOnly(log.jam_scan),
    });
  };

  const handleSaveEdit = async () => {
    if (!editData || isSubmittingRef.current) return;
    if (!editData.id_sesi) {
      setFeedback({
        type: "error",
        message: "ID sesi absensi tidak ditemukan, data tidak dapat diedit.",
      });
      return;
    }
    isSubmittingRef.current = true;
    setActionBusy(true);
    setFeedback(null);
    try {
      const result = await editAbsensiHarian(editData.id_sesi, {
        jam_masuk: toPatchTime(editData.jam_masuk, editData.tanggal),
        jam_pulang: toPatchTime(editData.jam_pulang, editData.tanggal),
        status_kehadiran: editData.status_kehadiran || undefined,
        status_absen: editData.status_absen || undefined,
        keterangan: editData.keterangan || undefined,
      });
      if (result.sukses) {
        triggerHaptic("success");
        setFeedback({ type: "success", message: result.pesan });
        setEditData(null);
        void loadData(date, activeTab);
      } else {
        triggerHaptic("error");
        setFeedback({ type: "error", message: result.pesan });
      }
    } catch (err: unknown) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Gagal mengedit absensi.",
      });
    } finally {
      setActionBusy(false);
      isSubmittingRef.current = false;
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setActionBusy(true);
    setFeedback(null);
    try {
      const result = await hapusLogScan(deleteTarget.id_log);
      if (result.sukses) {
        triggerHaptic("success");
        setFeedback({ type: "success", message: result.pesan });
        setDeleteTarget(null);
        void loadData(date, activeTab);
      } else {
        triggerHaptic("error");
        setFeedback({ type: "error", message: result.pesan });
      }
    } catch (err: unknown) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Gagal menghapus data.",
      });
    } finally {
      setActionBusy(false);
      isSubmittingRef.current = false;
    }
  };

  // Filtered Daily Records
  const filteredDaily = useMemo(() => {
    return dailyRecords.filter((r) => {
      const nama = String(r.nama || "");
      const idKaryawan = String(r.id_karyawan || "");
      const divisi = String(r.kelas_divisi || r.divisi || "");
      const statusKehadiran = String(r.status_kehadiran || "");
      const statusAbsen = String(r.status_absen || "");

      const matchSearch =
        !debouncedSearch ||
        nama.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        idKaryawan.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        divisi.toLowerCase().includes(debouncedSearch.toLowerCase());

      const matchStatus =
        statusFilter === "Semua" ||
        statusKehadiran === statusFilter ||
        statusAbsen === statusFilter;

      return matchSearch && matchStatus;
    });
  }, [dailyRecords, debouncedSearch, statusFilter]);

  // Filtered Scan Logs
  const filteredScanLogs = useMemo(() => {
    return scanLogs.filter((r) => {
      const nama = String(r.nama || "");
      const idKaryawan = String(r.id_karyawan || "");
      const divisi = String(r.divisi || "");
      const jenisScan = String(r.jenis_scan || "");
      const statusProses = String(r.status_proses || "");
      const keterangan = String(r.keterangan || "");
      const catatanSistem = String(r.catatan_sistem || "");

      const matchSearch =
        !debouncedSearch ||
        nama.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        idKaryawan.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        divisi.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        keterangan.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        catatanSistem.toLowerCase().includes(debouncedSearch.toLowerCase());

      const matchStatus =
        statusFilter === "Semua" ||
        statusProses === statusFilter ||
        jenisScan === statusFilter;

      return matchSearch && matchStatus;
    });
  }, [scanLogs, debouncedSearch, statusFilter]);

  /**
   * Ekspor baris tab aktif sesuai filter yang sedang tampil. Di Android berkas
   * diserahkan ke dialog "Simpan ke…" (`mobile_save_file_to_device`).
   */
  const handleExport = async (format: "csv" | "excel") => {
    const rows = activeTab === "daily" ? filteredDaily : filteredScanLogs;
    if (exporting || rows.length === 0) return;
    setExporting(true);
    triggerHaptic("light");
    try {
      const data =
        activeTab === "daily"
          ? buildDailyExport(rows, date)
          : buildScanLogExport(rows, date);
      const res =
        format === "csv"
          ? await exportToCsv(data.filename, data.headers, data.rows)
          : await exportToExcel(
              data.filename,
              data.sheetName,
              data.headers,
              data.rows,
            );
      // Menutup dialog "Simpan ke…" adalah pembatalan, bukan kegagalan.
      if (res.cancelled) return;
      triggerHaptic("success");
      setFeedback({
        type: "success",
        message: `${rows.length} baris diekspor ke ${format === "csv" ? "CSV" : "Excel"}${res.path ? ` (${res.path})` : ""}.`,
      });
    } catch (err) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Ekspor gagal.",
      });
    } finally {
      setExporting(false);
    }
  };

  const exportRowCount =
    activeTab === "daily" ? filteredDaily.length : filteredScanLogs.length;

  if (!authLoading && isAuthenticated && !canViewHistory) {
    return (
      <MobileAppShell>
        <div className="flex min-h-[65vh] flex-col items-center justify-center p-6 text-center">
          <div className="mb-4 grid size-16 place-items-center rounded-3xl border border-amber-500/30 bg-amber-500/10 text-amber-400 shadow-inner">
            <Icon name="clock" className="size-8 stroke-[2.2]" />
          </div>
          <h2 className="text-lg font-black text-white">Akses Dibatasi</h2>
          <p className="mt-2 max-w-xs text-xs leading-relaxed text-slate-400">
            Akun operator Anda ({user?.role || "Scanner"}) tidak memiliki hak
            akses untuk melihat rekap riwayat absensi. Hubungi administrator
            jika membutuhkan akses ini.
          </p>
          <button
            type="button"
            onClick={() => {
              triggerHaptic("light");
              router.replace("/dashboard");
            }}
            className="mt-6 rounded-2xl bg-sky-400 px-6 py-2.5 text-xs font-black text-slate-950 shadow-lg transition active:scale-95 hover:bg-sky-300"
          >
            Kembali ke Beranda
          </button>
        </div>
      </MobileAppShell>
    );
  }

  return (
    <MobileAppShell>
      <div className="flex flex-col gap-4">
        {/* Header & Date Controls */}
        <div className="rounded-3xl border border-white/15 bg-slate-900/90 p-4 shadow-xl backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-base font-black text-white">
              Riwayat Kehadiran
            </h2>
            <button
              type="button"
              onClick={() => loadData(date, activeTab)}
              aria-label="Muat ulang data"
              className="grid size-9 place-items-center rounded-xl bg-white/10 text-slate-300 hover:bg-white/20 active:scale-95 transition"
            >
              <Icon
                name="reset"
                className={`size-4 ${isLoading ? "animate-spin" : ""}`}
              />
            </button>
          </div>

          {/* Segmented Tab Switcher */}
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-950/80 p-1 border border-white/10 mb-3">
            <button
              type="button"
              onClick={() => handleTabChange("daily")}
              className={`flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-bold transition active:scale-95 ${
                activeTab === "daily"
                  ? "bg-sky-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Icon name="calendar" className="size-4" />
              <span>Absensi Harian</span>
            </button>
            <button
              type="button"
              onClick={() => handleTabChange("scan-logs")}
              className={`flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-bold transition active:scale-95 ${
                activeTab === "scan-logs"
                  ? "bg-sky-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Icon name="scanner" className="size-4" />
              <span>Log Scan Mentah</span>
            </button>
          </div>

          {/* Date Picker */}
          <div className="flex flex-col gap-2">
            <input
              type="date"
              aria-label="Tanggal riwayat"
              value={date}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-full rounded-2xl border border-white/15 bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white focus:border-sky-400 focus:outline-none font-mono"
            />
          </div>

          {/* Search Input */}
          <div className="mt-3 relative">
            <input
              type="text"
              aria-label="Cari riwayat absensi"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama, ID, divisi, catatan..."
              className="w-full rounded-xl border border-white/10 bg-slate-950/80 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
            />
          </div>

          {/* Status Filter Chips */}
          <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {(activeTab === "daily"
              ? [
                  "Semua",
                  "Hadir",
                  "Terlambat",
                  "Datang Lebih Awal",
                  "Alfa",
                  "Izin",
                  "Sakit",
                ]
              : ["Semua", "Berhasil", "Gagal", "Ditolak", "Masuk", "Pulang"]
            ).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setStatusFilter(s);
                  triggerHaptic("light");
                }}
                className={`shrink-0 rounded-xl px-3 py-1 text-xs font-semibold transition ${
                  statusFilter === s
                    ? "bg-sky-500 text-slate-950 font-bold"
                    : "bg-white/5 text-slate-400 hover:bg-white/10"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Ekspor tab aktif */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void handleExport("csv")}
              disabled={isLoading || exporting || exportRowCount === 0}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 text-[11px] font-bold text-sky-300 transition active:scale-95 disabled:opacity-40"
            >
              <Icon name="download" className="size-4" />
              Ekspor CSV
            </button>
            <button
              type="button"
              onClick={() => void handleExport("excel")}
              disabled={isLoading || exporting || exportRowCount === 0}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-[11px] font-bold text-emerald-300 transition active:scale-95 disabled:opacity-40"
            >
              <Icon name="document" className="size-4" />
              {exporting ? "Menyiapkan..." : "Ekspor Excel"}
            </button>
          </div>
        </div>

        {feedback ? (
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            onClose={() => setFeedback(null)}
          />
        ) : null}

        {/* Record List */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {activeTab === "daily"
                ? `Daftar Rekap Harian (${filteredDaily.length})`
                : `Daftar Log Scan (${filteredScanLogs.length})`}
            </span>
            <span className="text-[11px] text-slate-500">
              {(activeTab === "daily" && canEditHistory) ||
              (activeTab === "scan-logs" && canDeleteHistory)
                ? "Klik card untuk detail & aksi"
                : "Klik card untuk detail"}
            </span>
          </div>

          {isLoading ? (
            <div className="flex flex-col gap-2">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-20 rounded-2xl border border-white/5 bg-slate-900/40 animate-pulse"
                />
              ))}
            </div>
          ) : activeTab === "daily" ? (
            filteredDaily.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-8 text-center text-xs text-slate-500">
                Tidak ada data absensi untuk filter ini.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {filteredDaily.map((rec, idx) => {
                  const nama = String(rec.nama || "Tanpa Nama");
                  const idKaryawan = String(rec.id_karyawan || "-");
                  const divisi = String(rec.kelas_divisi || rec.divisi || "-");
                  const statusStr = String(
                    rec.status_absen || rec.status_kehadiran || "Hadir",
                  );
                  const jamMasuk = formatTimeOnly(rec.jam_masuk);
                  const jamPulang = formatTimeOnly(rec.jam_pulang);
                  const modeTugas = String(rec.mode_tugas || "NORMAL");
                  const idKey = String(rec.id_sesi || rec.id_absensi || idx);

                  return (
                    <button
                      key={idKey}
                      type="button"
                      onClick={() => {
                        triggerHaptic("light");
                        setSelectedDaily(rec);
                      }}
                      className="group flex flex-col gap-2 rounded-2xl border border-white/10 bg-slate-900/80 p-3.5 text-left backdrop-blur-md transition-all active:scale-[0.98] hover:border-sky-500/30"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-bold text-white truncate">
                              {nama}
                            </span>
                            {modeTugas === "BACKUP" && (
                              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">
                                BACKUP
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-slate-400">
                            {divisi} • ID: {idKaryawan}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <StatusBadge status={statusStr} />
                          <Icon
                            name="chevron-right"
                            className="size-4 text-slate-500 group-hover:text-sky-300 transition-colors"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-950/60 p-2 text-xs border border-white/5">
                        <div>
                          <span className="text-slate-500 text-[10px] uppercase">
                            Jam Masuk:
                          </span>
                          <p className="font-semibold text-slate-200 font-mono">
                            {jamMasuk}
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-500 text-[10px] uppercase">
                            Jam Pulang:
                          </span>
                          <p className="font-semibold text-slate-200 font-mono">
                            {jamPulang}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          ) : filteredScanLogs.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-8 text-center text-xs text-slate-500">
              Tidak ada log scan untuk filter ini.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredScanLogs.map((log, idx) => {
                const nama = String(log.nama || "Tanpa Nama");
                const idKaryawan = String(log.id_karyawan || "-");
                const divisi = String(log.divisi || "-");
                const jamScan = formatTimeOnly(log.jam_scan);
                const jenisScan = String(log.jenis_scan || "Scan");
                const statusProses = String(log.status_proses || "Berhasil");
                const sumberData = String(log.sumber_data || "Scanner");
                const idLog = String(log.id_log || idx);

                return (
                  <button
                    key={idLog}
                    type="button"
                    onClick={() => {
                      triggerHaptic("light");
                      setSelectedScanLog(log);
                    }}
                    className="group flex flex-col gap-2 rounded-2xl border border-white/10 bg-slate-900/80 p-3.5 text-left backdrop-blur-md transition-all active:scale-[0.98] hover:border-sky-500/30"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-bold text-white truncate">
                          {nama}
                        </span>
                        <span className="text-xs text-slate-400">
                          {divisi} • ID: {idKaryawan}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={statusProses} />
                        <Icon
                          name="chevron-right"
                          className="size-4 text-slate-500 group-hover:text-sky-300 transition-colors"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-xl bg-slate-950/60 px-3 py-2 text-xs border border-white/5">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold text-sky-300">
                          {jenisScan}
                        </span>
                        <span className="font-mono text-slate-200">
                          {jamScan}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400">
                        {sumberData}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modal Detail Absensi Harian (24 Kolom) */}
      <Modal
        isOpen={Boolean(selectedDaily)}
        onClose={() => setSelectedDaily(null)}
        title="Detail Absensi Harian"
        maxWidth="max-w-lg"
      >
        {selectedDaily && (
          <div className="space-y-4 text-xs">
            {/* Bagian 1: Identitas Karyawan */}
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3.5 space-y-2">
              <span className="text-[11px] font-bold text-sky-300 uppercase tracking-wider">
                👤 Identitas Karyawan
              </span>
              <div className="grid grid-cols-2 gap-2 text-slate-300">
                <div>
                  <span className="text-slate-500">Nama:</span>
                  <p className="font-bold text-white text-sm">
                    {String(selectedDaily.nama || "-")}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">ID / Kode:</span>
                  <p className="font-mono font-semibold text-white">
                    {String(selectedDaily.id_karyawan || "-")}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Divisi / Kelas:</span>
                  <p className="font-semibold text-slate-200">
                    {String(
                      selectedDaily.kelas_divisi || selectedDaily.divisi || "-",
                    )}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Tanggal Kerja:</span>
                  <p className="font-mono font-semibold text-slate-200">
                    {String(selectedDaily.tanggal || "-")}
                  </p>
                </div>
              </div>
            </div>

            {/* Bagian 2: Waktu & Jam Kerja */}
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3.5 space-y-2">
              <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wider">
                ⏰ Jam Kerja & Keterlambatan
              </span>
              <div className="grid grid-cols-2 gap-2 text-slate-300">
                <div>
                  <span className="text-slate-500">Jam Masuk:</span>
                  <p className="font-mono font-semibold text-emerald-400">
                    {formatTimeOnly(selectedDaily.jam_masuk)}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Jam Pulang:</span>
                  <p className="font-mono font-semibold text-sky-400">
                    {formatTimeOnly(selectedDaily.jam_pulang)}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Terlambat:</span>
                  <p className="font-semibold text-amber-300">
                    {formatMinutesToHours(selectedDaily.menit_terlambat)}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Datang Lebih Awal:</span>
                  <p className="font-semibold text-slate-300">
                    {formatMinutesToHours(selectedDaily.menit_datang_awal)}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Total Jam Kerja:</span>
                  <p className="font-semibold text-slate-200">
                    {formatMinutesToHours(selectedDaily.jam_kerja)}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Lembur:</span>
                  <p className="font-semibold text-purple-300">
                    {formatMinutesToHours(selectedDaily.lembur)}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Jam Kerja Kurang:</span>
                  <p className="font-semibold text-rose-300">
                    {formatMinutesToHours(selectedDaily.jam_kerja_kurang)}
                  </p>
                </div>
              </div>
            </div>

            {/* Bagian 3: Status, Shift, & Sesi */}
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3.5 space-y-2">
              <span className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider">
                📌 Status & Sesi Kerja
              </span>
              <div className="grid grid-cols-2 gap-2 text-slate-300">
                <div>
                  <span className="text-slate-500">Status Kehadiran:</span>
                  <p className="font-bold text-white">
                    {String(selectedDaily.status_kehadiran || "-")}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Status Absen:</span>
                  <p className="font-bold text-white">
                    {String(selectedDaily.status_absen || "-")}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">ID Shift:</span>
                  <p className="font-semibold text-slate-200">
                    Shift #{String(selectedDaily.id_shift || 1)}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Periode:</span>
                  <p className="font-semibold text-slate-200">
                    {String(selectedDaily.bulan || "-")}{" "}
                    {String(selectedDaily.tahun || "-")}
                  </p>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500">ID Sesi:</span>
                  <p className="font-mono text-[11px] text-slate-300 break-all">
                    {String(selectedDaily.id_sesi || "-")}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Mode Tugas:</span>
                  <p className="font-bold text-sky-300">
                    {String(selectedDaily.mode_tugas || "NORMAL")}
                  </p>
                </div>
              </div>
            </div>

            {/* Bagian 4: Penugasan Backup (Jika ada) */}
            {selectedDaily.mode_tugas === "BACKUP" ||
            Boolean(selectedDaily.id_backup) ? (
              <div className="rounded-2xl border border-amber-400/20 bg-amber-950/20 p-3.5 space-y-2">
                <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wider">
                  🔄 Detail Penugasan Backup
                </span>
                <div className="grid grid-cols-2 gap-2 text-slate-300">
                  <div>
                    <span className="text-slate-500">ID Backup:</span>
                    <p className="font-mono font-semibold text-amber-200">
                      {String(selectedDaily.id_backup || "-")}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Karyawan Asal:</span>
                    <p className="font-semibold text-slate-200">
                      {String(selectedDaily.id_karyawan_asal || "-")}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-500">Tanggal Tugas:</span>
                    <p className="font-mono text-slate-200">
                      {String(selectedDaily.tanggal_tugas || "-")}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Bagian 5: Audit Sistem & Catatan */}
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3.5 space-y-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                🛡️ Audit & Keterangan
              </span>
              <div className="space-y-1.5 text-slate-300">
                <div className="flex justify-between">
                  <span className="text-slate-500">Sumber Data:</span>
                  <span className="font-semibold text-white">
                    {String(selectedDaily.sumber || "Scanner")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Update Terakhir:</span>
                  <span className="font-mono text-[11px] text-slate-300">
                    {String(selectedDaily.update_terakhir || "-")}
                  </span>
                </div>
                {selectedDaily.keterangan ? (
                  <div className="mt-2 rounded-xl bg-white/5 p-2 text-slate-300 italic">
                    {String(selectedDaily.keterangan)}
                  </div>
                ) : null}
              </div>
            </div>

            {canEditHistory ? (
              <button
                type="button"
                onClick={() => openEditDaily(selectedDaily)}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/15 text-xs font-black text-amber-200 transition hover:bg-amber-500/25 active:scale-95"
              >
                <span aria-hidden="true">✏️</span>
                <span>Edit Data Absensi</span>
              </button>
            ) : null}
          </div>
        )}
      </Modal>

      {/* Modal Detail Log Scan */}
      <Modal
        isOpen={Boolean(selectedScanLog)}
        onClose={() => setSelectedScanLog(null)}
        title="Detail Log Scan"
        maxWidth="max-w-lg"
      >
        {selectedScanLog && (
          <div className="space-y-4 text-xs">
            {/* Informasi Scan */}
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3.5 space-y-2">
              <span className="text-[11px] font-bold text-sky-300 uppercase tracking-wider">
                📷 Data Scan Kamera / Scanner
              </span>
              <div className="grid grid-cols-2 gap-2 text-slate-300">
                <div>
                  <span className="text-slate-500">Jenis Scan:</span>
                  <p className="font-bold text-sky-300 text-sm">
                    {String(selectedScanLog.jenis_scan || "-")}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Status Proses:</span>
                  <div className="mt-0.5">
                    <StatusBadge
                      status={String(
                        selectedScanLog.status_proses || "Berhasil",
                      )}
                    />
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Jam Scan:</span>
                  <p className="font-mono font-semibold text-white">
                    {String(selectedScanLog.jam_scan || "-")}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Tanggal Kerja:</span>
                  <p className="font-mono font-semibold text-white">
                    {String(selectedScanLog.tanggal_kerja || "-")}
                  </p>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500">Timestamp Lengkap:</span>
                  <p className="font-mono text-slate-300">
                    {String(selectedScanLog.timestamp_scan || "-")}
                  </p>
                </div>
              </div>
            </div>

            {/* Identitas Karyawan */}
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3.5 space-y-2">
              <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wider">
                👤 Karyawan Terkait
              </span>
              <div className="grid grid-cols-2 gap-2 text-slate-300">
                <div>
                  <span className="text-slate-500">Nama:</span>
                  <p className="font-bold text-white">
                    {String(selectedScanLog.nama || "-")}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">ID Karyawan:</span>
                  <p className="font-mono font-semibold text-white">
                    {String(selectedScanLog.id_karyawan || "-")}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Divisi:</span>
                  <p className="font-semibold text-slate-200">
                    {String(selectedScanLog.divisi || "-")}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Operator:</span>
                  <p className="font-semibold text-sky-200">
                    {String(selectedScanLog.kode_operator || "SYS")}
                  </p>
                </div>
              </div>
            </div>

            {/* Evaluasi Mesin Aturan */}
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3.5 space-y-2">
              <span className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider">
                ⚙️ Hasil Mesin Aturan & Sumber
              </span>
              <div className="grid grid-cols-2 gap-2 text-slate-300">
                <div>
                  <span className="text-slate-500">Terlambat:</span>
                  <p className="font-semibold text-amber-300">
                    {Number(selectedScanLog.menit_terlambat || 0)} menit
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Datang Lebih Awal:</span>
                  <p className="font-semibold text-slate-300">
                    {Number(selectedScanLog.menit_datang_awal || 0)} menit
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Sumber Data:</span>
                  <p className="font-semibold text-white">
                    {String(selectedScanLog.sumber_data || "Scanner")}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">ID Referensi:</span>
                  <p className="font-mono text-slate-300">
                    {String(selectedScanLog.id_referensi || "-")}
                  </p>
                </div>
              </div>
              {selectedScanLog.catatan_sistem ? (
                <div className="mt-2 rounded-xl bg-white/5 p-2 text-slate-300">
                  <span className="text-[10px] text-slate-500 uppercase block">
                    Catatan Sistem:
                  </span>
                  {String(selectedScanLog.catatan_sistem)}
                </div>
              ) : null}
              {selectedScanLog.keterangan ? (
                <div className="mt-2 rounded-xl bg-white/5 p-2 text-slate-300">
                  <span className="text-[10px] text-slate-500 uppercase block">
                    Keterangan:
                  </span>
                  {String(selectedScanLog.keterangan)}
                </div>
              ) : null}
            </div>

            {canDeleteHistory && Number(selectedScanLog.id_log) > 0 ? (
              <button
                type="button"
                onClick={() => openDeleteScanLog(selectedScanLog)}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/15 text-xs font-black text-rose-200 transition hover:bg-rose-500/25 active:scale-95"
              >
                <Icon name="trash" className="size-4" />
                <span>Hapus Log Scan Ini</span>
              </button>
            ) : null}
          </div>
        )}
      </Modal>

      {/* Modal Edit Absensi Harian */}
      <Modal
        isOpen={Boolean(editData)}
        onClose={() => {
          if (!actionBusy) setEditData(null);
        }}
        title="Edit Data Absensi"
        titleId="history-edit-modal-title"
        subtitle={
          editData
            ? `${editData.nama} (${editData.id_karyawan}) · ${editData.tanggal}`
            : undefined
        }
        maxWidth="max-w-md"
        hideFooter
      >
        {editData ? (
          <form
            className="space-y-3.5 text-xs"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSaveEdit();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="history-edit-jam-masuk"
                  className="mb-1 block font-semibold text-slate-400"
                >
                  Jam Masuk
                </label>
                <input
                  id="history-edit-jam-masuk"
                  type="time"
                  value={editData.jam_masuk}
                  onChange={(e) =>
                    setEditData({ ...editData, jam_masuk: e.target.value })
                  }
                  className={`${EDIT_INPUT_CLASS} font-mono`}
                />
              </div>
              <div>
                <label
                  htmlFor="history-edit-jam-pulang"
                  className="mb-1 block font-semibold text-slate-400"
                >
                  Jam Pulang
                </label>
                <input
                  id="history-edit-jam-pulang"
                  type="time"
                  value={editData.jam_pulang}
                  onChange={(e) =>
                    setEditData({ ...editData, jam_pulang: e.target.value })
                  }
                  className={`${EDIT_INPUT_CLASS} font-mono`}
                />
              </div>
              <div>
                <label
                  htmlFor="history-edit-status-kehadiran"
                  className="mb-1 block font-semibold text-slate-400"
                >
                  Status Kehadiran
                </label>
                <select
                  id="history-edit-status-kehadiran"
                  value={editData.status_kehadiran}
                  onChange={(e) =>
                    setEditData({
                      ...editData,
                      status_kehadiran: e.target.value,
                    })
                  }
                  className={EDIT_INPUT_CLASS}
                >
                  <option value="Hadir">Hadir</option>
                  <option value="Sakit">Sakit</option>
                  <option value="Izin">Izin</option>
                  <option value="Dispen">Dispen</option>
                  <option value="Alfa">Alfa</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="history-edit-status-absen"
                  className="mb-1 block font-semibold text-slate-400"
                >
                  Status Absen
                </label>
                <select
                  id="history-edit-status-absen"
                  value={editData.status_absen}
                  onChange={(e) =>
                    setEditData({ ...editData, status_absen: e.target.value })
                  }
                  className={EDIT_INPUT_CLASS}
                >
                  <option value="Lengkap">Lengkap</option>
                  <option value="Belum Pulang">Belum Pulang</option>
                  <option value="Tidak Hadir">Tidak Hadir</option>
                  <option value="Perlu Verifikasi">Perlu Verifikasi</option>
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor="history-edit-keterangan"
                className="mb-1 block font-semibold text-slate-400"
              >
                Keterangan
              </label>
              <input
                id="history-edit-keterangan"
                type="text"
                placeholder="Keterangan koreksi / edit..."
                value={editData.keterangan}
                onChange={(e) =>
                  setEditData({ ...editData, keterangan: e.target.value })
                }
                className={EDIT_INPUT_CLASS}
              />
            </div>

            <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-2.5 text-[11px] leading-4 text-amber-100">
              Jam kerja, keterlambatan &amp; lembur dihitung ulang otomatis dari
              jam baru sesuai aturan shift. Perubahan dicatat sebagai jejak
              audit operator dan ikut disinkronkan.
            </p>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => setEditData(null)}
                className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/5 text-xs font-bold text-slate-300 transition hover:bg-white/10 active:scale-95 disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={actionBusy}
                className="min-h-11 flex-1 rounded-xl bg-amber-400 text-xs font-black text-slate-950 shadow-lg transition hover:bg-amber-300 active:scale-95 disabled:opacity-50"
              >
                {actionBusy ? "Menyimpan..." : "Simpan Perubahan"}
              </button>
            </div>
          </form>
        ) : null}
      </Modal>

      {/* Modal Konfirmasi Hapus Log Scan */}
      <Modal
        isOpen={Boolean(deleteTarget)}
        onClose={() => {
          if (!actionBusy) setDeleteTarget(null);
        }}
        title="Hapus Log Scan"
        titleId="history-delete-modal-title"
        maxWidth="max-w-sm"
        hideFooter
      >
        {deleteTarget ? (
          <div className="flex flex-col gap-4 text-xs">
            <div className="space-y-1 rounded-2xl border border-rose-500/20 bg-rose-950/30 p-3.5">
              <p className="text-sm font-bold text-white">
                Hapus log scan #{deleteTarget.id_log}?
              </p>
              <p className="text-slate-300">
                {deleteTarget.nama} ({deleteTarget.id_karyawan}) — Scan{" "}
                {deleteTarget.jenis_scan} pukul {deleteTarget.jam_scan}
              </p>
              <p className="pt-1 text-[11px] text-amber-300">
                Tindakan ini permanen dan akan mencatat jejak audit operator.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => setDeleteTarget(null)}
                className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/5 text-xs font-bold text-slate-300 transition hover:bg-white/10 active:scale-95 disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void handleConfirmDelete()}
                className="min-h-11 flex-1 rounded-xl bg-rose-500 text-xs font-black text-on-accent shadow-lg transition hover:bg-rose-600 active:scale-95 disabled:opacity-50"
              >
                {actionBusy ? "Menghapus..." : "Ya, Hapus"}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </MobileAppShell>
  );
}
