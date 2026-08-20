"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { MobileAppShell } from "@/components/MobileAppShell";
import { Icon } from "@/components/ui/Icon";
import { canAccessArea } from "@/lib/auth/access";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import {
  batalkanPenugasanBackup,
  buatPenugasanBackup,
  getDaftarBackup,
} from "@/lib/gateways/backup";
import {
  getDaftarKoreksi,
  hapusKoreksiAdmin,
  prosesKoreksiAdmin,
} from "@/lib/gateways/correction";
import { getDaftarKaryawan } from "@/lib/gateways/employee";
import {
  getDaftarImport,
  hapusImportOffline,
  prosesImportOffline,
} from "@/lib/gateways/offline-import";
import { getDaftarShift } from "@/lib/gateways/shift";

type OperationalTab = "koreksi" | "backup" | "manual";

const JENIS_KOREKSI_OPTIONS = [
  "Sakit",
  "Izin",
  "Dispen",
  "Alfa",
  "Lupa Absen Masuk",
  "Lupa Absen Pulang",
  "Kendala Sistem - Jam Masuk",
  "Kendala Sistem - Jam Pulang",
  "Terlambat",
] as const;

const STATUS_ABSEN_MANUAL_OPTIONS = [
  { value: "", label: "✨ Otomatis (Generate Sistem Sesuai Jam)" },
  { value: "Lengkap", label: "Lengkap (Masuk & Pulang)" },
  { value: "Belum Pulang", label: "Belum Pulang (Hanya Masuk)" },
  { value: "Perlu Verifikasi", label: "Perlu Verifikasi (Hanya Pulang)" },
  { value: "Tidak Hadir", label: "Tidak Hadir (Sakit/Izin/Alfa)" },
  { value: "Tepat Waktu", label: "Tepat Waktu" },
  { value: "Terlambat", label: "Terlambat" },
  { value: "Datang Lebih Awal", label: "Datang Lebih Awal" },
] as const;

export default function OperationalPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<OperationalTab>("koreksi");
  const [date, setDate] = useState<string>(
    () => new Date().toISOString().split("T")[0],
  );

  // Data Masters
  const [employees, setEmployees] = useState<Record<string, unknown>[]>([]);
  const [shifts, setShifts] = useState<Record<string, unknown>[]>([]);
  const [loadingMaster, setLoadingMaster] = useState<boolean>(true);

  // Lists for selected date
  const [corrections, setCorrections] = useState<Record<string, unknown>[]>([]);
  const [backups, setBackups] = useState<Record<string, unknown>[]>([]);
  const [imports, setImports] = useState<Record<string, unknown>[]>([]);
  const [loadingList, setLoadingList] = useState<boolean>(false);

  // Feedback State
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  // Form State: Koreksi Admin
  const [korKaryawanId, setKorKaryawanId] = useState<string>("");
  const [korJenis, setKorJenis] =
    useState<(typeof JENIS_KOREKSI_OPTIONS)[number]>("Sakit");
  const [korJam, setKorJam] = useState<string>("08:00");
  const [korKeterangan, setKorKeterangan] = useState<string>("");

  // Form State: Backup Karyawan
  const [bckAsalId, setBckAsalId] = useState<string>("");
  const [bckPenggantiId, setBckPenggantiId] = useState<string>("");
  const [bckShiftId, setBckShiftId] = useState<number>(1);
  const [bckAlasan, setBckAlasan] = useState<string>("Sakit");
  const [bckCatatan, setBckCatatan] = useState<string>("");

  // Form State: Entri Manual
  const [manKaryawanId, setManKaryawanId] = useState<string>("");
  const [manJamMasuk, setManJamMasuk] = useState<string>("08:00");
  const [manJamPulang, setManJamPulang] = useState<string>("16:00");
  const [manStatusKehadiran, setManStatusKehadiran] = useState<string>("Hadir");
  const [manStatusAbsen, setManStatusAbsen] = useState<string>("");
  const [manKeterangan, setManKeterangan] = useState<string>("");

  const isOperational = canAccessArea(user, "operational");

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [authLoading, isAuthenticated, router]);

  // Load master data once
  useEffect(() => {
    let cancelled = false;
    async function loadMasters() {
      try {
        const [empData, shiftData] = await Promise.all([
          getDaftarKaryawan({ status_aktif: "Aktif" }),
          getDaftarShift(),
        ]);
        if (!cancelled) {
          setEmployees(empData || []);
          setShifts(shiftData || []);
          if (empData && empData.length > 0) {
            const firstId = String(
              empData[0].id_karyawan || empData[0].id_unik || "",
            );
            setKorKaryawanId(firstId);
            setBckAsalId(firstId);
            setManKaryawanId(firstId);
            if (empData.length > 1) {
              setBckPenggantiId(
                String(empData[1].id_karyawan || empData[1].id_unik || ""),
              );
            }
          }
          if (shiftData && shiftData.length > 0) {
            setBckShiftId(Number(shiftData[0].id_shift || 1));
          }
        }
      } catch {
        // Silently handled
      } finally {
        if (!cancelled) setLoadingMaster(false);
      }
    }
    if (isAuthenticated && isOperational) {
      void loadMasters();
    }
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isOperational]);

  // Load tab-specific records on date or tab change
  const loadTabRecords = useCallback(
    async (targetDate: string, tab: OperationalTab) => {
      setLoadingList(true);
      try {
        if (tab === "koreksi") {
          const data = await getDaftarKoreksi({ tanggal: targetDate });
          setCorrections(data || []);
        } else if (tab === "backup") {
          const data = await getDaftarBackup({ tanggal: targetDate });
          setBackups(data || []);
        } else if (tab === "manual") {
          const data = await getDaftarImport({ tanggal: targetDate });
          setImports(data || []);
        }
      } catch {
        // Silently handled
      } finally {
        setLoadingList(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (isAuthenticated && isOperational) {
      void loadTabRecords(date, activeTab);
    }
  }, [date, activeTab, isAuthenticated, isOperational, loadTabRecords]);

  // Check RBAC Access
  if (!authLoading && !isOperational) {
    return (
      <MobileAppShell>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
          <div className="grid size-16 place-items-center rounded-3xl bg-rose-500/10 text-rose-400 border border-rose-500/20 mb-4">
            <Icon name="lock" className="size-8" />
          </div>
          <h2 className="text-lg font-black text-white">Akses Terbatas</h2>
          <p className="text-xs text-slate-400 mt-1 max-w-xs">
            Akun Anda tidak memiliki wewenang untuk membuka Modul Operasional
            (Koreksi Admin, Backup, atau Import).
          </p>
          <Link
            href="/dashboard"
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-sky-500 px-5 py-2.5 text-xs font-bold text-slate-950 shadow-lg active:scale-95 transition"
          >
            <Icon name="home" className="size-4" />
            <span>Kembali ke Beranda</span>
          </Link>
        </div>
      </MobileAppShell>
    );
  }

  // Handle Form Submit: Koreksi Admin
  const handleSubmitKoreksi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!korKaryawanId) {
      setFeedback({
        type: "error",
        message: "Pilih karyawan terlebih dahulu.",
      });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const needsTime = [
        "Lupa Absen Masuk",
        "Lupa Absen Pulang",
        "Kendala Sistem - Jam Masuk",
        "Kendala Sistem - Jam Pulang",
        "Terlambat",
      ].includes(korJenis);

      const result = await prosesKoreksiAdmin({
        tanggal: date,
        id_karyawan: korKaryawanId,
        jenis_koreksi: korJenis,
        jam_koreksi: needsTime ? korJam : undefined,
        keterangan_admin: korKeterangan || undefined,
      });

      if (result.sukses) {
        triggerHaptic("success");
        setFeedback({
          type: "success",
          message: result.pesan || "Koreksi admin berhasil disimpan.",
        });
        setKorKeterangan("");
        void loadTabRecords(date, "koreksi");
      } else {
        triggerHaptic("error");
        setFeedback({
          type: "error",
          message: result.pesan || "Gagal menyimpan koreksi.",
        });
      }
    } catch (err: unknown) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Terjadi kesalahan sistem.",
      });
    } finally {
      setBusy(false);
    }
  };

  // Handle Form Submit: Penugasan Backup
  const handleSubmitBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bckAsalId || !bckPenggantiId) {
      setFeedback({
        type: "error",
        message: "Pilih karyawan asal dan pengganti.",
      });
      return;
    }
    if (bckAsalId === bckPenggantiId) {
      setFeedback({
        type: "error",
        message: "Karyawan asal dan pengganti tidak boleh sama.",
      });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const result = await buatPenugasanBackup({
        tanggal_tugas: date,
        id_karyawan_asal: bckAsalId,
        id_karyawan_pengganti: bckPenggantiId,
        id_shift_backup: bckShiftId,
        alasan_backup: bckAlasan,
        catatan: bckCatatan || undefined,
      });

      if (result.sukses) {
        triggerHaptic("success");
        setFeedback({
          type: "success",
          message: result.pesan || "Penugasan backup berhasil dibuat.",
        });
        setBckCatatan("");
        void loadTabRecords(date, "backup");
      } else {
        triggerHaptic("error");
        setFeedback({
          type: "error",
          message: result.pesan || "Gagal membuat penugasan backup.",
        });
      }
    } catch (err: unknown) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Terjadi kesalahan sistem.",
      });
    } finally {
      setBusy(false);
    }
  };

  // Handle Form Submit: Entri Manual
  const handleSubmitManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manKaryawanId) {
      setFeedback({
        type: "error",
        message: "Pilih karyawan terlebih dahulu.",
      });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const targetEmp = employees.find(
        (emp) =>
          emp.id_karyawan === manKaryawanId || emp.id_unik === manKaryawanId,
      );

      const result = await prosesImportOffline([
        {
          tanggal: date,
          id_unik: manKaryawanId,
          nama: String(targetEmp?.nama || ""),
          divisi: String(targetEmp?.divisi || ""),
          jam_masuk: manJamMasuk || undefined,
          jam_pulang: manJamPulang || undefined,
          status_kehadiran: manStatusKehadiran,
          status_absen: manStatusAbsen,
          keterangan: manKeterangan || undefined,
        },
      ]);

      if (result.berhasil > 0) {
        triggerHaptic("success");
        setFeedback({
          type: "success",
          message: `Entri manual berhasil disimpan (${result.berhasil} baris).`,
        });
        setManKeterangan("");
        void loadTabRecords(date, "manual");
      } else {
        triggerHaptic("error");
        setFeedback({
          type: "error",
          message: result.results[0]?.pesan || "Gagal menyimpan entri manual.",
        });
      }
    } catch (err: unknown) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Terjadi kesalahan sistem.",
      });
    } finally {
      setBusy(false);
    }
  };

  // Delete Action Handlers
  const handleDeleteKoreksi = async (idReferensi: string) => {
    if (!confirm("Batalkan dan hapus data koreksi admin ini?")) return;
    try {
      const res = await hapusKoreksiAdmin(idReferensi);
      if (res.sukses) {
        triggerHaptic("light");
        void loadTabRecords(date, "koreksi");
      }
    } catch {
      // Ignored
    }
  };

  const handleCancelBackup = async (idBackup: string) => {
    if (!confirm("Batalkan penugasan backup ini?")) return;
    try {
      const res = await batalkanPenugasanBackup(idBackup);
      if (res.sukses) {
        triggerHaptic("light");
        void loadTabRecords(date, "backup");
      }
    } catch {
      // Ignored
    }
  };

  const handleDeleteImport = async (eventKey: string) => {
    if (!confirm("Hapus entri manual ini?")) return;
    try {
      const res = await hapusImportOffline(eventKey);
      if (res.sukses) {
        triggerHaptic("light");
        void loadTabRecords(date, "manual");
      }
    } catch {
      // Ignored
    }
  };

  return (
    <MobileAppShell>
      <div className="flex flex-col gap-4">
        {/* Header Card */}
        <div className="rounded-3xl border border-white/15 bg-slate-900/90 p-4 shadow-xl backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2.5">
              <div className="grid size-9 place-items-center rounded-xl bg-sky-500/10 text-sky-300 border border-sky-400/20">
                <Icon name="tools" className="size-5" />
              </div>
              <h2 className="text-base font-black text-white">
                Operasional Lapangan
              </h2>
            </div>
            <button
              type="button"
              onClick={() => loadTabRecords(date, activeTab)}
              aria-label="Muat ulang data"
              className="grid size-9 place-items-center rounded-xl bg-white/10 text-slate-300 hover:bg-white/20 active:scale-95 transition"
            >
              <Icon
                name="reset"
                className={`size-4 ${loadingList ? "animate-spin" : ""}`}
              />
            </button>
          </div>

          {/* Date Picker */}
          <div className="mb-3">
            <input
              type="date"
              value={date}
              onChange={(e) => {
                triggerHaptic("light");
                setDate(e.target.value);
              }}
              className="w-full rounded-2xl border border-white/15 bg-slate-950 px-4 py-2 text-xs font-semibold text-white focus:border-sky-400 focus:outline-none font-mono"
            />
          </div>

          {/* 3-Tab Segmented Control */}
          <div className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-950/80 p-1 border border-white/10">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("light");
                setActiveTab("koreksi");
                setFeedback(null);
              }}
              className={`rounded-xl py-2 text-[11px] font-bold transition active:scale-95 ${
                activeTab === "koreksi"
                  ? "bg-sky-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Koreksi Admin
            </button>
            <button
              type="button"
              onClick={() => {
                triggerHaptic("light");
                setActiveTab("backup");
                setFeedback(null);
              }}
              className={`rounded-xl py-2 text-[11px] font-bold transition active:scale-95 ${
                activeTab === "backup"
                  ? "bg-sky-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Backup Karyawan
            </button>
            <button
              type="button"
              onClick={() => {
                triggerHaptic("light");
                setActiveTab("manual");
                setFeedback(null);
              }}
              className={`rounded-xl py-2 text-[11px] font-bold transition active:scale-95 ${
                activeTab === "manual"
                  ? "bg-sky-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Entri Manual
            </button>
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`rounded-2xl p-3.5 text-xs font-medium backdrop-blur-md border ${
              feedback.type === "success"
                ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-200"
                : "bg-rose-950/40 border-rose-500/30 text-rose-200"
            }`}
          >
            <div className="flex items-center gap-2">
              <Icon
                name={feedback.type === "success" ? "check" : "reset"}
                className="size-4 shrink-0"
              />
              <span>{feedback.message}</span>
            </div>
          </div>
        )}

        {/* TAB 1: KOREKSI ADMIN */}
        {activeTab === "koreksi" && (
          <div className="flex flex-col gap-4">
            <form
              onSubmit={handleSubmitKoreksi}
              className="rounded-3xl border border-white/15 bg-slate-900/90 p-4 shadow-xl backdrop-blur-xl space-y-3"
            >
              <h3 className="text-xs font-bold uppercase tracking-wider text-sky-400">
                Formulir Koreksi Absensi
              </h3>

              {/* Karyawan Dropdown */}
              <div>
                <label
                  htmlFor="kor-karyawan"
                  className="block text-[11px] font-semibold text-slate-400 mb-1"
                >
                  Pilih Karyawan
                </label>
                <select
                  id="kor-karyawan"
                  value={korKaryawanId}
                  onChange={(e) => setKorKaryawanId(e.target.value)}
                  disabled={loadingMaster}
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-sky-400"
                >
                  {employees.map((emp) => {
                    const id = String(emp.id_karyawan || emp.id_unik || "");
                    return (
                      <option key={id} value={id}>
                        {String(emp.nama)} ({String(emp.divisi || "-")}) - {id}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Jenis Koreksi */}
              <div>
                <label
                  htmlFor="kor-jenis"
                  className="block text-[11px] font-semibold text-slate-400 mb-1"
                >
                  Jenis Koreksi
                </label>
                <select
                  id="kor-jenis"
                  value={korJenis}
                  onChange={(e) =>
                    setKorJenis(
                      e.target.value as (typeof JENIS_KOREKSI_OPTIONS)[number],
                    )
                  }
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-sky-400"
                >
                  {JENIS_KOREKSI_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              {/* Jam Koreksi (Kondisional) */}
              {[
                "Lupa Absen Masuk",
                "Lupa Absen Pulang",
                "Kendala Sistem - Jam Masuk",
                "Kendala Sistem - Jam Pulang",
                "Terlambat",
              ].includes(korJenis) && (
                <div>
                  <label
                    htmlFor="kor-jam"
                    className="block text-[11px] font-semibold text-slate-400 mb-1"
                  >
                    Jam Koreksi (HH:mm)
                  </label>
                  <input
                    id="kor-jam"
                    type="time"
                    value={korJam}
                    onChange={(e) => setKorJam(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-xs text-white outline-none focus:border-sky-400"
                  />
                </div>
              )}

              {/* Keterangan */}
              <div>
                <label
                  htmlFor="kor-keterangan"
                  className="block text-[11px] font-semibold text-slate-400 mb-1"
                >
                  Keterangan / Alasan
                </label>
                <input
                  id="kor-keterangan"
                  type="text"
                  value={korKeterangan}
                  onChange={(e) => setKorKeterangan(e.target.value)}
                  placeholder="Contoh: Surat dokter terlampir..."
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-sky-400"
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl bg-sky-400 py-3 text-xs font-black text-slate-950 shadow-lg shadow-sky-950/40 hover:bg-sky-300 disabled:opacity-50 transition active:scale-[0.98]"
              >
                {busy ? "Menyimpan..." : "Simpan Koreksi Admin"}
              </button>
            </form>

            {/* Riwayat Koreksi Hari Ini */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
                Koreksi Tanggal {date} ({corrections.length})
              </span>
              {loadingList ? (
                <div className="h-16 rounded-2xl bg-slate-900/40 animate-pulse border border-white/5" />
              ) : corrections.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-6 text-center text-xs text-slate-500">
                  Belum ada koreksi admin pada tanggal ini.
                </div>
              ) : (
                corrections.map((item, idx) => {
                  const idRef = String(item.id_referensi || idx);
                  return (
                    <div
                      key={idRef}
                      className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/80 p-3.5 backdrop-blur-md"
                    >
                      <div className="flex flex-col min-w-0 pr-2">
                        <span className="text-xs font-bold text-white truncate">
                          {String(item.nama_karyawan || item.id_karyawan)}
                        </span>
                        <span className="text-[11px] text-sky-300 font-semibold">
                          {String(item.jenis_koreksi)}
                        </span>
                        {item.keterangan_admin ? (
                          <span className="text-[10px] text-slate-400 italic mt-0.5">
                            {String(item.keterangan_admin)}
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteKoreksi(idRef)}
                        className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[10px] font-bold text-rose-300 hover:bg-rose-500/20 active:scale-95 transition"
                      >
                        Hapus
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 2: BACKUP KARYAWAN */}
        {activeTab === "backup" && (
          <div className="flex flex-col gap-4">
            <form
              onSubmit={handleSubmitBackup}
              className="rounded-3xl border border-white/15 bg-slate-900/90 p-4 shadow-xl backdrop-blur-xl space-y-3"
            >
              <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300">
                Formulir Penugasan Backup
              </h3>

              {/* Karyawan Asal */}
              <div>
                <label
                  htmlFor="bck-asal"
                  className="block text-[11px] font-semibold text-slate-400 mb-1"
                >
                  Karyawan Asal (Yang Berhalangan)
                </label>
                <select
                  id="bck-asal"
                  value={bckAsalId}
                  onChange={(e) => setBckAsalId(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-sky-400"
                >
                  {employees.map((emp) => {
                    const id = String(emp.id_karyawan || emp.id_unik || "");
                    return (
                      <option key={id} value={id}>
                        {String(emp.nama)} ({String(emp.divisi || "-")})
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Karyawan Pengganti */}
              <div>
                <label
                  htmlFor="bck-pengganti"
                  className="block text-[11px] font-semibold text-slate-400 mb-1"
                >
                  Karyawan Pengganti (Backup)
                </label>
                <select
                  id="bck-pengganti"
                  value={bckPenggantiId}
                  onChange={(e) => setBckPenggantiId(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-sky-400"
                >
                  {employees.map((emp) => {
                    const id = String(emp.id_karyawan || emp.id_unik || "");
                    return (
                      <option key={id} value={id}>
                        {String(emp.nama)} ({String(emp.divisi || "-")})
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Shift Target */}
              <div>
                <label
                  htmlFor="bck-shift"
                  className="block text-[11px] font-semibold text-slate-400 mb-1"
                >
                  Shift Penugasan
                </label>
                <select
                  id="bck-shift"
                  value={bckShiftId}
                  onChange={(e) => setBckShiftId(Number(e.target.value))}
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-sky-400"
                >
                  {shifts.map((s) => (
                    <option key={Number(s.id_shift)} value={Number(s.id_shift)}>
                      {String(s.nama_shift)} ({String(s.jam_masuk)} -{" "}
                      {String(s.jam_pulang)})
                    </option>
                  ))}
                </select>
              </div>

              {/* Alasan */}
              <div>
                <label
                  htmlFor="bck-alasan"
                  className="block text-[11px] font-semibold text-slate-400 mb-1"
                >
                  Alasan Backup
                </label>
                <select
                  id="bck-alasan"
                  value={bckAlasan}
                  onChange={(e) => setBckAlasan(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-sky-400"
                >
                  {[
                    "Sakit",
                    "Cuti",
                    "Izin",
                    "Tugas Luar",
                    "Lembur Tambahan",
                    "Lainnya",
                  ].map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl bg-amber-400 py-3 text-xs font-black text-slate-950 shadow-lg shadow-amber-950/40 hover:bg-amber-300 disabled:opacity-50 transition active:scale-[0.98]"
              >
                {busy ? "Menyimpan..." : "Tugaskan Karyawan Backup"}
              </button>
            </form>

            {/* Riwayat Backup Hari Ini */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
                Penugasan Backup Tanggal {date} ({backups.length})
              </span>
              {loadingList ? (
                <div className="h-16 rounded-2xl bg-slate-900/40 animate-pulse border border-white/5" />
              ) : backups.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-6 text-center text-xs text-slate-500">
                  Belum ada penugasan backup pada tanggal ini.
                </div>
              ) : (
                backups.map((item, idx) => {
                  const idBck = String(item.id_backup || idx);
                  return (
                    <div
                      key={idBck}
                      className="flex items-center justify-between rounded-2xl border border-amber-400/20 bg-slate-900/80 p-3.5 backdrop-blur-md"
                    >
                      <div className="flex flex-col min-w-0 pr-2">
                        <div className="flex items-center gap-1 text-xs font-bold text-white">
                          <span>
                            {String(
                              item.nama_pengganti || item.id_karyawan_pengganti,
                            )}
                          </span>
                          <span className="text-slate-400">menggantikan</span>
                          <span className="text-amber-300">
                            {String(item.nama_asal || item.id_karyawan_asal)}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-400 mt-0.5">
                          Alasan: {String(item.alasan_backup || "-")} • Shift #
                          {String(item.id_shift_backup)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCancelBackup(idBck)}
                        className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[10px] font-bold text-rose-300 hover:bg-rose-500/20 active:scale-95 transition shrink-0"
                      >
                        Batalkan
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 3: ENTRI MANUAL / DARURAT */}
        {activeTab === "manual" && (
          <div className="flex flex-col gap-4">
            <form
              onSubmit={handleSubmitManual}
              className="rounded-3xl border border-white/15 bg-slate-900/90 p-4 shadow-xl backdrop-blur-xl space-y-3"
            >
              <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                Formulir Entri Absensi Darurat / Manual
              </h3>

              {/* Karyawan */}
              <div>
                <label
                  htmlFor="man-karyawan"
                  className="block text-[11px] font-semibold text-slate-400 mb-1"
                >
                  Pilih Karyawan
                </label>
                <select
                  id="man-karyawan"
                  value={manKaryawanId}
                  onChange={(e) => setManKaryawanId(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-sky-400"
                >
                  {employees.map((emp) => {
                    const id = String(emp.id_karyawan || emp.id_unik || "");
                    return (
                      <option key={id} value={id}>
                        {String(emp.nama)} ({String(emp.divisi || "-")})
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Jam Masuk & Pulang */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="man-masuk"
                    className="block text-[11px] font-semibold text-slate-400 mb-1"
                  >
                    Jam Masuk
                  </label>
                  <input
                    id="man-masuk"
                    type="time"
                    value={manJamMasuk}
                    onChange={(e) => setManJamMasuk(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-xs text-white outline-none focus:border-sky-400"
                  />
                </div>
                <div>
                  <label
                    htmlFor="man-pulang"
                    className="block text-[11px] font-semibold text-slate-400 mb-1"
                  >
                    Jam Pulang
                  </label>
                  <input
                    id="man-pulang"
                    type="time"
                    value={manJamPulang}
                    onChange={(e) => setManJamPulang(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-xs text-white outline-none focus:border-sky-400"
                  />
                </div>
              </div>

              {/* Status Kehadiran */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="man-kehadiran"
                    className="block text-[11px] font-semibold text-slate-400 mb-1"
                  >
                    Status Kehadiran
                  </label>
                  <select
                    id="man-kehadiran"
                    value={manStatusKehadiran}
                    onChange={(e) => setManStatusKehadiran(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-sky-400"
                  >
                    {["Hadir", "Izin", "Sakit", "Alfa", "Dispen"].map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="man-absen"
                    className="block text-[11px] font-semibold text-slate-400 mb-1"
                  >
                    Status Absen
                  </label>
                  <select
                    id="man-absen"
                    value={manStatusAbsen}
                    onChange={(e) => setManStatusAbsen(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-sky-400"
                  >
                    {STATUS_ABSEN_MANUAL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Keterangan */}
              <div>
                <label
                  htmlFor="man-keterangan"
                  className="block text-[11px] font-semibold text-slate-400 mb-1"
                >
                  Keterangan
                </label>
                <input
                  id="man-keterangan"
                  type="text"
                  value={manKeterangan}
                  onChange={(e) => setManKeterangan(e.target.value)}
                  placeholder="Contoh: QR rusak / kendala scanner"
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-sky-400"
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl bg-emerald-400 py-3 text-xs font-black text-slate-950 shadow-lg shadow-emerald-950/40 hover:bg-emerald-300 disabled:opacity-50 transition active:scale-[0.98]"
              >
                {busy ? "Menyimpan..." : "Simpan Entri Manual"}
              </button>
            </form>

            {/* Riwayat Import Manual Hari Ini */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
                Entri Manual Tanggal {date} ({imports.length})
              </span>
              {loadingList ? (
                <div className="h-16 rounded-2xl bg-slate-900/40 animate-pulse border border-white/5" />
              ) : imports.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-6 text-center text-xs text-slate-500">
                  Belum ada entri manual pada tanggal ini.
                </div>
              ) : (
                imports.map((item, idx) => {
                  const evKey = String(item.event_key || idx);
                  return (
                    <div
                      key={evKey}
                      className="flex items-center justify-between rounded-2xl border border-emerald-400/20 bg-slate-900/80 p-3.5 backdrop-blur-md"
                    >
                      <div className="flex flex-col min-w-0 pr-2">
                        <span className="text-xs font-bold text-white truncate">
                          {String(item.nama || item.id_karyawan)}
                        </span>
                        <span className="text-[11px] text-slate-300 mt-0.5">
                          {String(item.jam_masuk || "--:--")} -{" "}
                          {String(item.jam_pulang || "--:--")} •{" "}
                          {String(item.status_kehadiran || "Hadir")}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteImport(evKey)}
                        className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[10px] font-bold text-rose-300 hover:bg-rose-500/20 active:scale-95 transition shrink-0"
                      >
                        Hapus
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </MobileAppShell>
  );
}
