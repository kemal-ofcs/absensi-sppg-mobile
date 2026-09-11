/**
 * Susunan kolom ekspor Riwayat — salinan setia `getExportData` di
 * `web-desktop/src/app/history/page.tsx`, supaya berkas dari Android dan dari
 * Desktop/Web bisa digabung tanpa menata ulang kolom.
 */

type Row = Record<string, unknown>;
type Cell = string | number;

function formatDisplayDate(value: unknown): string {
  if (!value || typeof value !== "string") return "-";
  if (/^\d{2}\/\d{2}\/\d{4}/.test(value)) return value;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

/**
 * Stempel waktu ditulis apa adanya dari database (bentuk SQLite tanpa zona),
 * hanya disusun ulang ke DD/MM/YYYY — tidak lewat `new Date()`, yang akan
 * menggesernya ke zona perangkat.
 */
function formatDisplayDateTime(value: unknown): string {
  if (!value || typeof value !== "string") return "-";
  const s = value.trim();
  if (!s || s === "-") return "-";
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) return s;
  const m =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return s;
  const sec = (m[6] || "00").slice(0, 2);
  return `${m[3]}/${m[2]}/${m[1]} ${m[4] || "00"}:${m[5] || "00"}:${sec}`;
}

function formatTimeOnly(value: unknown): string {
  if (!value || typeof value !== "string") return "-";
  const s = value.trim();
  if (!s || s === "-") return "-";
  const clean = s.includes(" ")
    ? s.split(" ")[1]
    : s.includes("T")
      ? s.split("T")[1]?.split(".")[0]?.split("Z")[0] || ""
      : s;
  if (!clean) return "-";
  const parts = clean.split(":");
  if (parts.length < 2) return clean;
  const sec = parts[2] ? parts[2].slice(0, 2).padStart(2, "0") : "00";
  return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}:${sec}`;
}

function sumberLabel(value: unknown): string {
  const sumber = String(value || "");
  return sumber === "Import Offline" ? "Import Manual" : sumber;
}

export interface HistoryExport {
  filename: string;
  sheetName: string;
  headers: string[];
  rows: Cell[][];
}

export function buildScanLogExport(rows: Row[], date: string): HistoryExport {
  return {
    filename: `Riwayat_Log_Scan_${date}`,
    sheetName: "Log Scan",
    headers: [
      "Timestamp_Scan",
      "Tanggal",
      "Jam",
      "ID_Unik",
      "Nama",
      "Divisi",
      "Jenis_Scan",
      "Status_Proses",
      "Sumber_Data",
      "Catatan_Sistem",
      "Keterangan",
      "Waktu_Telat",
      "Menit_Datang_Awal",
      "ID_Referensi",
      "Kode_Operator",
    ],
    rows: rows.map((r) => [
      formatDisplayDateTime(r.timestamp_scan),
      formatDisplayDate(r.tanggal_kerja),
      formatTimeOnly(r.jam_scan),
      String(r.id_karyawan || ""),
      String(r.nama || ""),
      String(r.divisi || ""),
      String(r.jenis_scan || ""),
      String(r.status_proses || ""),
      sumberLabel(r.sumber_data),
      String(r.catatan_sistem || ""),
      String(r.keterangan || ""),
      String(r.menit_terlambat || 0),
      String(r.menit_datang_awal || 0),
      String(r.id_referensi || ""),
      String(r.kode_operator || ""),
    ]),
  };
}

export function buildDailyExport(rows: Row[], date: string): HistoryExport {
  return {
    filename: `Riwayat_Absensi_Harian_${date}`,
    sheetName: "Absensi Harian",
    headers: [
      "Tanggal",
      "ID_Unik",
      "Nama",
      "Divisi",
      "Jam_Masuk",
      "Jam_Pulang",
      "Status_Kehadiran",
      "Status_Absen",
      "Keterangan_Admin",
      "Sumber_Data",
      "Update_Terakhir",
      "Menit_Terlambat",
      "Menit_Datang_Awal",
      "Jam_Kerja",
      "Lembur",
      "Shift",
      "Bulan",
      "Tahun",
      "Jam_Kerja_Kurang",
      "ID_sesi",
      "Mode_Tugas",
      "ID_Backup",
      "ID_Karyawan_Asal",
      "Tanggal_Tugas",
    ],
    rows: rows.map((r) => [
      formatDisplayDate(r.tanggal),
      String(r.id_karyawan || ""),
      String(r.nama || ""),
      String(r.kelas_divisi || r.divisi || ""),
      formatTimeOnly(r.jam_masuk),
      formatTimeOnly(r.jam_pulang),
      String(r.status_kehadiran || ""),
      String(r.status_absen || ""),
      String(r.keterangan || ""),
      sumberLabel(r.sumber),
      formatDisplayDateTime(r.update_terakhir),
      Number(r.menit_terlambat || 0),
      Number(r.menit_datang_awal || 0),
      Number(r.jam_kerja || 0),
      Number(r.lembur || 0),
      String(r.nama_shift || r.kode_shift || r.id_shift || ""),
      String(r.bulan || ""),
      Number(r.tahun || 0),
      Number(r.jam_kerja_kurang || 0),
      String(r.id_sesi || ""),
      String(r.mode_tugas || "NORMAL"),
      String(r.id_backup || ""),
      String(r.id_karyawan_asal || ""),
      formatDisplayDate(r.tanggal_tugas),
    ]),
  };
}
