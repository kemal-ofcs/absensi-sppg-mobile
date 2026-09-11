"use client";

import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { MobileAppShell } from "@/components/MobileAppShell";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import {
  hitungJamKerjaNormalMenit,
  isShiftFleksibel,
  jendelaScanMasuk,
} from "@/lib/attendance/time-policy";
import { canAccessArea, hasPermission } from "@/lib/auth/access";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import {
  getDaftarShift,
  hapusShift,
  type ShiftInput,
  tambahShift,
  updateShift,
} from "@/lib/gateways/shift";
import { useDebounce } from "@/lib/hooks/useDebounce";
import {
  firstValidationMessage,
  validateShiftDraft,
} from "@/lib/validations/stabilization";

function parseTimeToMinutes(t: string): number | null {
  if (!t) return null;
  const match = /^(\d{2}):(\d{2})/.exec(t.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Kalkulasi jam kerja normal dalam satuan MENIT.
 * Rumus: (jamPulang - jamMasuk) - istirahat — lihat `hitungJamKerjaNormalMenit`.
 */
function hitungJamKerjaNormalOtomatis(
  jamMasuk: string,
  jamPulang: string,
  istirahatMenit: number,
): number {
  return hitungJamKerjaNormalMenit(jamMasuk, jamPulang, istirahatMenit);
}

/** "HH:mm" dari menit-dalam-hari; nilai di luar 0..1439 digulung ke hari itu. */
function formatMenitJam(menit: number): string {
  const normal = ((menit % 1440) + 1440) % 1440;
  return `${String(Math.floor(normal / 60)).padStart(2, "0")}:${String(normal % 60).padStart(2, "0")}`;
}

/**
 * Pratinjau jendela absen masuk sebuah shift, dalam jam dinding:
 * absen dibuka → mulai tepat waktu → jam masuk → batas terlambat.
 */
function pratinjauJendelaMasuk(
  jamMasuk: string,
  aturan: {
    awal_absen_menit?: number;
    batas_masuk_menit?: number;
    toleransi_masuk_menit?: number;
  },
): { buka: string; tepatWaktu: string; masuk: string; tutup: string } | null {
  const masuk = parseTimeToMinutes(jamMasuk);
  if (masuk === null) return null;
  const jendela = jendelaScanMasuk({
    awalAbsenMenit: Number(aturan.awal_absen_menit ?? 120),
    batasMasukMenit: Number(aturan.batas_masuk_menit ?? 60),
    toleransiMasukMenit: Number(aturan.toleransi_masuk_menit ?? 0),
  });
  return {
    buka: formatMenitJam(masuk + jendela.bukaMenit),
    tepatWaktu: formatMenitJam(masuk + jendela.tepatWaktuMenit),
    masuk: formatMenitJam(masuk),
    tutup: formatMenitJam(masuk + jendela.tutupMenit),
  };
}

function formatMinutesToHours(min: unknown): string {
  const num = Number(min || 0);
  if (num <= 0) return "0 mnt";
  const hours = (num / 60).toFixed(1).replace(/\.0$/, "");
  return `${num} mnt (${hours} jam)`;
}

export default function MobileShiftPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const canView = canAccessArea(user, "shift");
  const canManage = hasPermission(user, "shifts.manage");

  const [shiftList, setShiftList] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  // Modal State
  const [showModal, setShowModal] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<ShiftInput>({
    kode_shift: 1,
    nama_shift: "",
    jam_masuk: "07:00",
    jam_pulang: "15:00",
    awal_absen_menit: 120,
    batas_masuk_menit: 60,
    toleransi_masuk_menit: 0,
    jam_kerja_normal_menit: 480,
    istirahat_menit: 60,
    batas_pulang_menit: 240,
    offset_istirahat_mulai: 240,
    offset_generate_alfa: 180,
    buffer_shift_malam_menit: 120,
    izinkan_multi_sesi: 0,
  });
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Delete Confirmation State
  const [deleteConfirmShift, setDeleteConfirmShift] = useState<{
    id: number;
    nama: string;
    kode: number;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [authLoading, isAuthenticated, router]);

  const loadShifts = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await getDaftarShift();
      setShiftList(data || []);
      setErrorMsg(null);
    } catch (err: unknown) {
      if (!silent) {
        setErrorMsg(
          err instanceof Error ? err.message : "Data shift belum dapat dimuat.",
        );
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && canView) {
      void loadShifts();
    }
  }, [isAuthenticated, canView, loadShifts]);

  useEffect(() => {
    const onSyncCompleted = () => {
      void loadShifts(true);
    };
    window.addEventListener("sppg:sync-completed", onSyncCompleted);
    return () => {
      window.removeEventListener("sppg:sync-completed", onSyncCompleted);
    };
  }, [loadShifts]);

  const updateFormField = <K extends keyof ShiftInput>(
    field: K,
    value: ShiftInput[K],
  ) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: value };
      if (
        field === "jam_masuk" ||
        field === "jam_pulang" ||
        field === "istirahat_menit"
      ) {
        next.jam_kerja_normal_menit = hitungJamKerjaNormalOtomatis(
          next.jam_masuk,
          next.jam_pulang,
          next.istirahat_menit ?? 60,
        );
      }
      return next;
    });
    if (formErrors[field]) {
      setFormErrors((prev) => {
        const updated = { ...prev };
        delete updated[field];
        return updated;
      });
    }
  };

  // Fleksibel BUKAN kolom tersendiri: shift 00:00-23:59 memang tidak punya jam
  // masuk/pulang efektif, dan itulah yang dibaca `isShiftFleksibel` di seluruh
  // aplikasi (scanner, Generate Alfa, Audit Kualitas Absensi). Toggle ini hanya
  // menuliskan bentuk yang sudah dikenali itu, sehingga tidak ada skema baru
  // yang harus disinkronkan ke empat lapisan.
  const modeFleksibel = isShiftFleksibel(
    formData.jam_masuk,
    formData.jam_pulang,
    formData.jam_kerja_normal_menit ?? 0,
  );

  const setModeFleksibel = (aktif: boolean) => {
    setFormData((prev) => {
      if (aktif) {
        return {
          ...prev,
          jam_masuk: "00:00",
          jam_pulang: "23:59",
          awal_absen_menit: 0,
          batas_masuk_menit: 0,
          toleransi_masuk_menit: 0,
          istirahat_menit: 0,
          offset_istirahat_mulai: 0,
          batas_pulang_menit: 0,
          buffer_shift_malam_menit: 0,
          jam_kerja_normal_menit: hitungJamKerjaNormalOtomatis(
            "00:00",
            "23:59",
            0,
          ),
        };
      }
      const masuk = "07:00";
      const pulang = "15:00";
      const istirahat = 60;
      const batasMasuk = 60;
      return {
        ...prev,
        jam_masuk: masuk,
        jam_pulang: pulang,
        awal_absen_menit: 120,
        batas_masuk_menit: batasMasuk,
        toleransi_masuk_menit: 0,
        istirahat_menit: istirahat,
        offset_istirahat_mulai: 240,
        batas_pulang_menit: 240,
        buffer_shift_malam_menit: 120,
        jam_kerja_normal_menit: hitungJamKerjaNormalOtomatis(
          masuk,
          pulang,
          istirahat,
        ),
      };
    });
  };

  const openAddModal = () => {
    if (!canManage) return;
    triggerHaptic("light");
    setIsEditing(false);
    setEditId(null);
    const usedCodes = new Set(
      shiftList.map((shift) => Number(shift.kode_shift)),
    );
    let nextKode = 1;
    while (usedCodes.has(nextKode)) nextKode += 1;

    const defaultMasuk = "07:00";
    const defaultPulang = "15:00";
    const defaultIstirahat = 60;
    const defaultBatasMasuk = 60;
    const defaultAwalAbsen = 120;
    const calcNormalWork = hitungJamKerjaNormalOtomatis(
      defaultMasuk,
      defaultPulang,
      defaultIstirahat,
    );

    setFormData({
      kode_shift: nextKode,
      nama_shift: `Shift ${nextKode} - Regular`,
      jam_masuk: defaultMasuk,
      jam_pulang: defaultPulang,
      awal_absen_menit: defaultAwalAbsen,
      batas_masuk_menit: defaultBatasMasuk,
      toleransi_masuk_menit: 0,
      jam_kerja_normal_menit: calcNormalWork,
      istirahat_menit: defaultIstirahat,
      batas_pulang_menit: 240,
      offset_istirahat_mulai: 240,
      offset_generate_alfa: 180,
      buffer_shift_malam_menit: 120,
      izinkan_multi_sesi: 0,
      shift_lanjutan_id: 0,
    });
    setFormErrors({});
    setErrorMsg(null);
    setShowModal(true);
  };

  const openEditModal = (row: Record<string, unknown>) => {
    if (!canManage) return;
    triggerHaptic("light");
    setIsEditing(true);
    const id = Number(row.id_shift);
    setEditId(id);

    const masuk = String(row.jam_masuk || "07:00");
    const pulang = String(row.jam_pulang || "15:00");
    const istirahat = Number(row.istirahat_menit ?? 60);
    const batasMasuk = Number(row.batas_masuk_menit ?? 60);
    const awalAbsen = Number(row.awal_absen_menit ?? 120);

    setFormData({
      kode_shift: Number(row.kode_shift || 1),
      nama_shift: String(row.nama_shift || ""),
      jam_masuk: masuk,
      jam_pulang: pulang,
      awal_absen_menit: awalAbsen,
      batas_masuk_menit: batasMasuk,
      toleransi_masuk_menit: Number(row.toleransi_masuk_menit || 0),
      jam_kerja_normal_menit: hitungJamKerjaNormalOtomatis(
        masuk,
        pulang,
        istirahat,
      ),
      istirahat_menit: istirahat,
      batas_pulang_menit: Number(row.batas_pulang_menit ?? 240),
      offset_istirahat_mulai: Number(row.offset_istirahat_mulai ?? 240),
      offset_generate_alfa: Number(row.offset_generate_alfa ?? 180),
      buffer_shift_malam_menit: Number(row.buffer_shift_malam_menit ?? 120),
      izinkan_multi_sesi:
        Number(row.izinkan_multi_sesi || 0) === 1 ||
        row.izinkan_multi_sesi === true
          ? 1
          : 0,
      shift_lanjutan_id: Number(row.shift_lanjutan_id || 0),
    });
    setFormErrors({});
    setErrorMsg(null);
    setShowModal(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationErrors = validateShiftDraft(formData);
    if (Object.keys(validationErrors).length > 0) {
      triggerHaptic("error");
      setFormErrors(validationErrors);
      setErrorMsg(firstValidationMessage(validationErrors));
      return;
    }

    setSaving(true);
    triggerHaptic("light");
    try {
      if (isEditing && editId) {
        await updateShift(editId, formData);
        triggerHaptic("success");
        setAlertMsg(`Shift ${formData.nama_shift} berhasil diperbarui.`);
      } else {
        await tambahShift(formData);
        triggerHaptic("success");
        setAlertMsg(`Shift baru ${formData.nama_shift} berhasil ditambahkan.`);
      }
      setShowModal(false);
      await loadShifts();
      setFormErrors({});
      setTimeout(() => setAlertMsg(null), 3000);
    } catch (err: unknown) {
      triggerHaptic("error");
      const msg = err instanceof Error ? err.message : "Gagal menyimpan shift.";
      setErrorMsg(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteShift = async () => {
    if (!deleteConfirmShift) return;
    setIsDeleting(true);
    setErrorMsg(null);
    triggerHaptic("warning");
    try {
      const res = await hapusShift(deleteConfirmShift.id);
      if (res.sukses) {
        triggerHaptic("success");
        setAlertMsg(`Shift ${deleteConfirmShift.nama} berhasil dihapus.`);
        setDeleteConfirmShift(null);
        if (showModal && editId === deleteConfirmShift.id) {
          setShowModal(false);
        }
        await loadShifts();
        setTimeout(() => setAlertMsg(null), 3000);
      } else {
        triggerHaptic("error");
        setErrorMsg(res.pesan || "Gagal menghapus shift.");
        setDeleteConfirmShift(null);
      }
    } catch (err: unknown) {
      triggerHaptic("error");
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menghapus shift.",
      );
      setDeleteConfirmShift(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredShifts = shiftList.filter((shift) => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return true;
    const name = String(shift.nama_shift || "").toLowerCase();
    const code = String(shift.kode_shift || "").toLowerCase();
    return name.includes(q) || code.includes(q);
  });

  return (
    <MobileAppShell>
      <div className="flex flex-col gap-4 text-slate-100">
        {/* Header Title & Actions */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("light");
                router.push("/settings");
              }}
              aria-label="Kembali ke Pengaturan"
              className="grid size-9 place-items-center rounded-2xl bg-white/5 text-slate-300 hover:bg-white/10 active:scale-95 transition"
            >
              <svg
                className="size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black tracking-tight text-white">
                  Shift Kerja
                </h1>
                <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-bold text-sky-300">
                  {shiftList.length}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Kelola jadwal jam kerja &amp; toleransi absensi
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {canManage && (
              <button
                type="button"
                onClick={openAddModal}
                className="flex items-center gap-1.5 rounded-2xl bg-sky-500 px-3.5 py-2 text-xs font-black text-slate-950 shadow-md hover:bg-sky-400 active:scale-95 transition"
              >
                <svg
                  className="size-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 12h14M12 5v14" />
                </svg>
                <span>Tambah</span>
              </button>
            )}
          </div>
        </div>

        {/* Feedback Alert Banners */}
        {alertMsg && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/60 p-3 text-xs font-bold text-emerald-200 shadow-lg animate-fadeIn">
            {alertMsg}
          </div>
        )}

        {errorMsg && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-950/60 p-3 text-xs font-bold text-rose-200 shadow-lg animate-fadeIn">
            {errorMsg}
          </div>
        )}

        {/* Search Bar */}
        <div className="relative">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-slate-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari shift atau kode..."
            className="w-full rounded-2xl border border-white/10 bg-slate-900/90 py-2.5 pl-10 pr-4 text-xs text-white placeholder-slate-500 outline-none backdrop-blur-md focus:border-sky-500/50"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              &times;
            </button>
          )}
        </div>

        {/* Shift Cards List */}
        {loading && shiftList.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-xs text-slate-500">
            <div className="size-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
            <p>Memuat daftar shift...</p>
          </div>
        ) : filteredShifts.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-8 text-center text-xs text-slate-500">
            {search
              ? "Tidak ada shift yang cocok dengan kata kunci."
              : "Belum ada data shift kerja. Tambahkan shift baru untuk memulai."}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filteredShifts.map((shift, idx) => {
              const idShift = Number(shift.id_shift || idx);
              const kodeShift = Number(shift.kode_shift || 1);
              const namaShift = String(
                shift.nama_shift || `Shift ${kodeShift}`,
              );
              const jamMasuk = String(shift.jam_masuk || "07:00");
              const jamPulang = String(shift.jam_pulang || "15:00");
              const isMultiSesi =
                Number(shift.izinkan_multi_sesi || 0) === 1 ||
                shift.izinkan_multi_sesi === true;
              const awalAbsen = Number(shift.awal_absen_menit ?? 120);
              const batasMasuk = Number(shift.batas_masuk_menit ?? 60);
              const toleransi = Number(shift.toleransi_masuk_menit ?? 0);
              const istirahat = Number(shift.istirahat_menit ?? 60);
              const jamKerjaNormal = Number(
                shift.jam_kerja_normal_menit ?? 480,
              );
              const batasPulang = Number(shift.batas_pulang_menit ?? 240);
              const autoAlfa = Number(shift.offset_generate_alfa ?? 180);

              return (
                <div
                  key={idShift}
                  className="group relative flex flex-col gap-3 rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/90 via-slate-900/80 to-slate-950 p-4 shadow-xl backdrop-blur-md transition-all hover:border-sky-500/30"
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-sky-500/20 text-xs font-black text-sky-300 border border-sky-500/30">
                        #{kodeShift}
                      </span>
                      <div className="min-w-0">
                        <h2 className="text-sm font-bold text-white truncate">
                          {namaShift}
                        </h2>
                        <span className="text-[10px] text-slate-400 font-mono">
                          ID: {idShift}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isMultiSesi && (
                        <span className="rounded-md bg-purple-500/20 px-2 py-0.5 text-[9px] font-bold text-purple-300 border border-purple-500/30">
                          Multi-Sesi
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Operational Schedule Highlight */}
                  <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-950/70 p-3 border border-white/5 text-xs">
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                        Jam Masuk
                      </span>
                      <p className="text-base font-black font-mono text-white mt-0.5">
                        {jamMasuk}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-sky-400">
                        Jam Pulang
                      </span>
                      <p className="text-base font-black font-mono text-white mt-0.5">
                        {jamPulang}
                      </p>
                    </div>
                  </div>

                  {/* Parameters Grid */}
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
                    <div className="rounded-xl bg-slate-950/40 p-2 border border-white/5">
                      <span className="text-slate-500 text-[10px] block">
                        Awal Absen:
                      </span>
                      <span className="font-semibold text-slate-200">
                        {awalAbsen} mnt sblm tepat waktu
                      </span>
                    </div>

                    <div className="rounded-xl bg-slate-950/40 p-2 border border-white/5">
                      <span className="text-slate-500 text-[10px] block">
                        Batas Tepat Waktu:
                      </span>
                      <span className="font-semibold text-emerald-300">
                        {batasMasuk} mnt sblm masuk
                      </span>
                    </div>

                    <div className="rounded-xl bg-slate-950/40 p-2 border border-white/5">
                      <span className="text-slate-500 text-[10px] block">
                        Toleransi Terlambat:
                      </span>
                      <span className="font-semibold text-amber-300">
                        +{toleransi} mnt stlh masuk
                      </span>
                    </div>

                    {(() => {
                      if (
                        isShiftFleksibel(jamMasuk, jamPulang, jamKerjaNormal)
                      ) {
                        return null;
                      }
                      const jendela = pratinjauJendelaMasuk(jamMasuk, {
                        awal_absen_menit: awalAbsen,
                        batas_masuk_menit: batasMasuk,
                        toleransi_masuk_menit: toleransi,
                      });
                      return jendela ? (
                        <div className="rounded-xl bg-slate-950/40 p-2 border border-white/5 col-span-2">
                          <span className="text-slate-500 text-[10px] block">
                            Jendela Absen Masuk (awal → tepat → masuk → tutup):
                          </span>
                          <span className="font-semibold font-mono text-slate-200">
                            {jendela.buka} → {jendela.tepatWaktu} →{" "}
                            {jendela.masuk} → {jendela.tutup}
                          </span>
                        </div>
                      ) : null;
                    })()}

                    <div className="rounded-xl bg-slate-950/40 p-2 border border-white/5">
                      <span className="text-slate-500 text-[10px] block">
                        Istirahat:
                      </span>
                      <span className="font-semibold text-slate-200">
                        {istirahat} mnt
                      </span>
                    </div>

                    <div className="rounded-xl bg-slate-950/40 p-2 border border-white/5 col-span-2">
                      <span className="text-slate-500 text-[10px] block">
                        Jam Kerja Normal:
                      </span>
                      <span className="font-bold text-white">
                        {formatMinutesToHours(jamKerjaNormal)}
                      </span>
                    </div>

                    <div className="rounded-xl bg-slate-950/40 p-2 border border-white/5">
                      <span className="text-slate-500 text-[10px] block">
                        Batas Pulang:
                      </span>
                      <span className="font-semibold text-slate-200">
                        +{batasPulang} mnt
                      </span>
                    </div>

                    <div className="rounded-xl bg-slate-950/40 p-2 border border-white/5">
                      <span className="text-slate-500 text-[10px] block">
                        Cutoff Auto Alfa:
                      </span>
                      <span className="font-semibold text-rose-300">
                        +{autoAlfa} mnt
                      </span>
                    </div>
                  </div>

                  {/* Actions Footer */}
                  {canManage && (
                    <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                      <button
                        type="button"
                        onClick={() => openEditModal(shift)}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-sky-500/30 bg-sky-500/10 py-2 text-xs font-bold text-sky-300 hover:bg-sky-500/20 active:scale-95 transition"
                      >
                        <Icon name="tools" className="size-3.5" />
                        <span>Edit Shift</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          triggerHaptic("warning");
                          setDeleteConfirmShift({
                            id: idShift,
                            nama: namaShift,
                            kode: kodeShift,
                          });
                        }}
                        className="flex items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/20 active:scale-95 transition"
                      >
                        <Icon name="trash" className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal Form Tambah / Edit Shift */}
      {showModal && (
        <Modal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          title={isEditing ? "Edit Shift Kerja" : "Tambah Shift Kerja"}
          titleId="shift-form-modal-title"
          maxWidth="max-w-lg"
        >
          <form
            onSubmit={handleFormSubmit}
            className="flex flex-col gap-4 text-xs"
          >
            {/* Bagian 1: Identitas Shift */}
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3.5 space-y-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-sky-400">
                1. Identitas Shift
              </span>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label
                    htmlFor="kode-shift-input"
                    className="block text-slate-400 mb-1 font-semibold text-[11px]"
                  >
                    Kode Shift
                  </label>
                  <input
                    id="kode-shift-input"
                    type="number"
                    min="1"
                    value={formData.kode_shift}
                    onChange={(e) =>
                      updateFormField("kode_shift", Number(e.target.value))
                    }
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white font-mono outline-none focus:border-sky-500"
                    required
                  />
                  {formErrors.kode_shift && (
                    <p className="text-[10px] text-rose-400 mt-1">
                      {formErrors.kode_shift}
                    </p>
                  )}
                </div>

                <div className="col-span-2">
                  <label
                    htmlFor="nama-shift-input"
                    className="block text-slate-400 mb-1 font-semibold text-[11px]"
                  >
                    Nama Shift
                  </label>
                  <input
                    id="nama-shift-input"
                    type="text"
                    value={formData.nama_shift}
                    onChange={(e) =>
                      updateFormField("nama_shift", e.target.value)
                    }
                    placeholder="Contoh: Shift 1 - Pagi"
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-sky-500"
                    required
                  />
                  {formErrors.nama_shift && (
                    <p className="text-[10px] text-rose-400 mt-1">
                      {formErrors.nama_shift}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Bagian 2: Jam Operasional & Istirahat */}
            <div className="rounded-2xl border border-violet-500/25 bg-violet-500/5 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="block text-[13px] font-bold text-violet-300">
                    Shift Fleksibel
                  </span>
                  <span className="mt-1 block text-[10px] leading-4 text-slate-400">
                    Bebas absen jam berapa saja sepanjang hari (00:00-23:59),
                    tanpa keterlambatan dan tanpa batas jam pulang.
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={modeFleksibel}
                  aria-label="Jadikan shift ini fleksibel"
                  onClick={() => {
                    triggerHaptic("light");
                    setModeFleksibel(!modeFleksibel);
                  }}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                    modeFleksibel ? "bg-violet-500" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${
                      modeFleksibel ? "left-[22px]" : "left-0.5"
                    }`}
                  />
                </button>
              </div>
              {modeFleksibel ? (
                <p className="mt-2 rounded-xl bg-slate-950/60 p-2 text-[10px] leading-4 text-violet-200">
                  Karyawan tetap wajib hadir. Kalau harinya bukan hari libur dan
                  ia lupa scan masuk, lupa scan pulang, atau tidak absen sama
                  sekali, keterangannya tetap muncul seperti shift biasa
                  (&quot;Belum Scan Pulang&quot;, &quot;Alfa&quot;, dan
                  seterusnya) &mdash; hanya saja baru dinilai setelah harinya
                  habis, bukan di tengah hari.
                </p>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3.5 space-y-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                2. Jam Operasional &amp; Kerja
              </span>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="jam-masuk-input"
                    className="block text-slate-400 mb-1 font-semibold text-[11px]"
                  >
                    Jam Masuk (HH:MM)
                  </label>
                  <input
                    id="jam-masuk-input"
                    disabled={modeFleksibel}
                    type="time"
                    value={formData.jam_masuk}
                    onChange={(e) =>
                      updateFormField("jam_masuk", e.target.value)
                    }
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white font-mono outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                    required
                  />
                  {formErrors.jam_masuk && (
                    <p className="text-[10px] text-rose-400 mt-1">
                      {formErrors.jam_masuk}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="jam-pulang-input"
                    className="block text-slate-400 mb-1 font-semibold text-[11px]"
                  >
                    Jam Pulang (HH:MM)
                  </label>
                  <input
                    id="jam-pulang-input"
                    disabled={modeFleksibel}
                    type="time"
                    value={formData.jam_pulang}
                    onChange={(e) =>
                      updateFormField("jam_pulang", e.target.value)
                    }
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white font-mono outline-none focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                    required
                  />
                  {formErrors.jam_pulang && (
                    <p className="text-[10px] text-rose-400 mt-1">
                      {formErrors.jam_pulang}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="istirahat-input"
                    className="block text-slate-400 mb-1 font-semibold text-[11px]"
                  >
                    Istirahat (Menit)
                  </label>
                  <input
                    id="istirahat-input"
                    disabled={modeFleksibel}
                    type="number"
                    min="0"
                    value={formData.istirahat_menit ?? 60}
                    onChange={(e) =>
                      updateFormField("istirahat_menit", Number(e.target.value))
                    }
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white font-mono outline-none focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </div>

                <div>
                  <label
                    htmlFor="durasi-normal-preview"
                    className="block text-slate-400 mb-1 font-semibold text-[11px]"
                  >
                    Kalkulasi Jam Normal
                  </label>
                  <div
                    id="durasi-normal-preview"
                    className="w-full rounded-xl border border-white/5 bg-slate-900/50 px-3 py-2 text-emerald-300 font-bold font-mono"
                  >
                    {formatMinutesToHours(formData.jam_kerja_normal_menit)}
                  </div>
                </div>
              </div>
            </div>

            {/* Bagian 3: Toleransi Masuk & Pulang */}
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3.5 space-y-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
                3. Jendela Waktu &amp; Toleransi
              </span>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label
                    htmlFor="awal-absen-input"
                    className="block text-slate-400 mb-1 font-semibold text-[10px]"
                  >
                    Awal Absen (Mnt)
                  </label>
                  <input
                    id="awal-absen-input"
                    disabled={modeFleksibel}
                    type="number"
                    min="0"
                    value={formData.awal_absen_menit ?? 120}
                    onChange={(e) =>
                      updateFormField(
                        "awal_absen_menit",
                        Number(e.target.value),
                      )
                    }
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-2 py-2 text-white font-mono text-xs outline-none focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </div>

                <div>
                  <label
                    htmlFor="batas-masuk-input"
                    className="block text-slate-400 mb-1 font-semibold text-[10px]"
                  >
                    Batas Masuk (Mnt)
                  </label>
                  <input
                    id="batas-masuk-input"
                    disabled={modeFleksibel}
                    type="number"
                    min="0"
                    value={formData.batas_masuk_menit ?? 60}
                    onChange={(e) =>
                      updateFormField(
                        "batas_masuk_menit",
                        Number(e.target.value),
                      )
                    }
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-2 py-2 text-white font-mono text-xs outline-none focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </div>

                <div>
                  <label
                    htmlFor="toleransi-telat-input"
                    className="block text-slate-400 mb-1 font-semibold text-[10px]"
                  >
                    Toleransi Telat
                  </label>
                  <input
                    id="toleransi-telat-input"
                    disabled={modeFleksibel}
                    type="number"
                    min="0"
                    value={formData.toleransi_masuk_menit ?? 0}
                    onChange={(e) =>
                      updateFormField(
                        "toleransi_masuk_menit",
                        Number(e.target.value),
                      )
                    }
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-2 py-2 text-white font-mono text-xs outline-none focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </div>
              </div>

              <p className="text-[10px] leading-4 text-slate-500">
                Tepat Waktu = (Jam Masuk − Batas Masuk) s/d Jam Masuk. Awal
                Absen dihitung mundur dari awal Tepat Waktu. Terlambat = Jam
                Masuk s/d (Jam Masuk + Toleransi); lewat dari itu scan ditolak
                dan karyawan menghubungi Admin/Operator.
              </p>

              {(() => {
                const jendela = modeFleksibel
                  ? null
                  : pratinjauJendelaMasuk(formData.jam_masuk, formData);
                if (!jendela) return null;
                return (
                  <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/5 bg-slate-900/50 p-2 text-[10px] font-mono">
                    <div>
                      <span className="block text-slate-500">Lebih Awal</span>
                      <span className="font-bold text-slate-200">
                        {jendela.buka}–{jendela.tepatWaktu}
                      </span>
                    </div>
                    <div>
                      <span className="block text-slate-500">Tepat Waktu</span>
                      <span className="font-bold text-emerald-300">
                        {jendela.tepatWaktu}–{jendela.masuk}
                      </span>
                    </div>
                    <div>
                      <span className="block text-slate-500">Terlambat</span>
                      <span className="font-bold text-amber-300">
                        {jendela.masuk}–{jendela.tutup}
                      </span>
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <label
                    htmlFor="batas-pulang-input"
                    className="block text-slate-400 mb-1 font-semibold text-[10px]"
                  >
                    Batas Pulang (Mnt)
                  </label>
                  <input
                    id="batas-pulang-input"
                    disabled={modeFleksibel}
                    type="number"
                    min="0"
                    value={formData.batas_pulang_menit ?? 240}
                    onChange={(e) =>
                      updateFormField(
                        "batas_pulang_menit",
                        Number(e.target.value),
                      )
                    }
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white font-mono text-xs outline-none focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </div>

                <div>
                  <label
                    htmlFor="offset-alfa-input"
                    className="block text-slate-400 mb-1 font-semibold text-[10px]"
                  >
                    Cutoff Auto Alfa (Mnt)
                  </label>
                  <input
                    id="offset-alfa-input"
                    type="number"
                    min="0"
                    value={formData.offset_generate_alfa ?? 180}
                    onChange={(e) =>
                      updateFormField(
                        "offset_generate_alfa",
                        Number(e.target.value),
                      )
                    }
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white font-mono text-xs outline-none focus:border-rose-500"
                  />
                </div>
              </div>
            </div>

            {/* Bagian 4: Opsi Lanjutan (Multi-Sesi) */}
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3.5 space-y-2">
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <div>
                  <span className="text-xs font-bold text-white block">
                    Izinkan Auto Multi-Sesi (Turun Shift)
                  </span>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Karyawan yang selesai bekerja pada shift ini boleh langsung
                    scan masuk ke shift lanjutan
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={Number(formData.izinkan_multi_sesi || 0) === 1}
                  onChange={(e) =>
                    updateFormField(
                      "izinkan_multi_sesi",
                      e.target.checked ? 1 : 0,
                    )
                  }
                  className="size-5 rounded-lg border-white/20 bg-slate-900 text-sky-500 accent-sky-500"
                />
              </label>

              {Number(formData.izinkan_multi_sesi || 0) === 1 ? (
                <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-2.5">
                  <label
                    htmlFor="shift-lanjutan-input"
                    className="block text-[11px] font-semibold text-slate-300 mb-1"
                  >
                    Lanjut ke Shift
                  </label>
                  <select
                    id="shift-lanjutan-input"
                    value={formData.shift_lanjutan_id ?? 0}
                    onChange={(e) =>
                      updateFormField(
                        "shift_lanjutan_id",
                        Number(e.target.value),
                      )
                    }
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white font-mono text-xs outline-none focus:border-sky-500"
                  >
                    <option value={0}>
                      Cocokkan otomatis dengan jam shift
                    </option>
                    {shiftList
                      .filter((row) => Number(row.id_shift) !== editId)
                      .map((row) => (
                        <option
                          key={String(row.id_shift)}
                          value={Number(row.id_shift)}
                        >
                          {String(row.nama_shift)} ({String(row.jam_masuk)} -{" "}
                          {String(row.jam_pulang)})
                        </option>
                      ))}
                  </select>
                  <p className="mt-1 text-[10px] leading-4 text-slate-400">
                    Kolom shift karyawan ikut dipindahkan ke shift tujuan saat
                    sesi lanjutan dimulai.
                  </p>
                </div>
              ) : null}
            </div>

            {/* Sticky Action Buttons */}
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="flex-1 rounded-xl border border-white/10 bg-white/5 py-3 text-xs font-bold text-slate-300 hover:bg-white/10 active:scale-95 transition"
              >
                Batal
              </button>

              <button
                type="submit"
                disabled={saving}
                className="flex-1 rounded-xl bg-sky-500 py-3 text-xs font-black text-slate-950 shadow-lg hover:bg-sky-400 active:scale-95 transition disabled:opacity-50"
              >
                {saving
                  ? "Menyimpan..."
                  : isEditing
                    ? "Simpan Perubahan"
                    : "Tambah Shift"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal Konfirmasi Hapus Shift */}
      {deleteConfirmShift && (
        <Modal
          isOpen={Boolean(deleteConfirmShift)}
          onClose={() => setDeleteConfirmShift(null)}
          title="Hapus Shift Kerja"
          titleId="delete-shift-modal-title"
          maxWidth="max-w-sm"
        >
          <div className="flex flex-col gap-4 text-xs">
            <div className="rounded-2xl border border-rose-500/20 bg-rose-950/30 p-3.5 text-rose-200">
              <p className="font-bold text-sm text-white mb-1">
                Apakah Anda yakin ingin menghapus {deleteConfirmShift.nama}?
              </p>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Tindakan ini tidak dapat dibatalkan. Pastikan tidak ada karyawan
                aktif yang sedang ditugaskan pada shift ini.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeleteConfirmShift(null)}
                className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-bold text-slate-300 hover:bg-white/10 active:scale-95 transition"
              >
                Batal
              </button>

              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void handleDeleteShift()}
                className="flex-1 rounded-xl bg-rose-500 py-2.5 text-xs font-black text-on-accent shadow-lg hover:bg-rose-600 active:scale-95 transition disabled:opacity-50"
              >
                {isDeleting ? "Menghapus..." : "Hapus Shift"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </MobileAppShell>
  );
}
