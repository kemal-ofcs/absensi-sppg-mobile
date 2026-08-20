"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MobileAppShell } from "@/components/MobileAppShell";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { canAccessArea } from "@/lib/auth/access";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import { getRekapHarian, getRiwayatScan } from "@/lib/gateways/report";
import { useDebounce } from "@/lib/hooks/useDebounce";

type HistoryTab = "daily" | "scan-logs";

export default function HistoryPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const canViewHistory = canAccessArea(user, "history");

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

  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [authLoading, isAuthenticated, router]);

  const loadData = useCallback(async (targetDate: string, tab: HistoryTab) => {
    setIsLoading(true);
    try {
      if (tab === "daily") {
        const data = await getRekapHarian({ tanggal: targetDate });
        setDailyRecords(data || []);
      } else {
        const data = await getRiwayatScan({ tanggal: targetDate });
        setScanLogs(data || []);
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
              value={date}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-full rounded-2xl border border-white/15 bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white focus:border-sky-400 focus:outline-none font-mono"
            />
          </div>

          {/* Search Input */}
          <div className="mt-3 relative">
            <input
              type="text"
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
        </div>

        {/* Record List */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {activeTab === "daily"
                ? `Daftar Rekap Harian (${filteredDaily.length})`
                : `Daftar Log Scan (${filteredScanLogs.length})`}
            </span>
            <span className="text-[11px] text-slate-500">
              Klik card untuk detail
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
                  const jamMasuk = String(rec.jam_masuk || "--:--");
                  const jamPulang = String(rec.jam_pulang || "--:--");
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
                const jamScan = String(log.jam_scan || "--:--");
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
                    {String(selectedDaily.jam_masuk || "--:--")}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Jam Pulang:</span>
                  <p className="font-mono font-semibold text-sky-400">
                    {String(selectedDaily.jam_pulang || "--:--")}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Terlambat:</span>
                  <p className="font-semibold text-amber-300">
                    {Number(selectedDaily.menit_terlambat || 0)} menit
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Datang Lebih Awal:</span>
                  <p className="font-semibold text-slate-300">
                    {Number(selectedDaily.menit_datang_awal || 0)} menit
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Total Jam Kerja:</span>
                  <p className="font-semibold text-slate-200">
                    {Number(selectedDaily.jam_kerja || 0)} menit
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Lembur:</span>
                  <p className="font-semibold text-purple-300">
                    {Number(selectedDaily.lembur || 0)} menit
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Jam Kerja Kurang:</span>
                  <p className="font-semibold text-rose-300">
                    {Number(selectedDaily.jam_kerja_kurang || 0)} menit
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
          </div>
        )}
      </Modal>
    </MobileAppShell>
  );
}
