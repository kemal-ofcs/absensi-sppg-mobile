import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { triggerHaptic } from "@/lib/client/haptics";

interface EmployeeCardProps {
  employee: Record<string, unknown>;
  canManage: boolean;
  onOpenDetail: (emp: Record<string, unknown>) => void;
  onOpenIdCard?: (emp: Record<string, unknown>) => void;
}

/**
 * Menghasilkan warna HSL yang konsisten dari sebuah string (nama karyawan).
 * Digunakan untuk warna avatar inisial tanpa gambar.
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
 * Kartu ringkas karyawan untuk daftar halaman Master Karyawan.
 * Menampilkan data identitas utama, badge status, dan satu tombol aksi detail terpadu.
 */
export function EmployeeCard({ employee, onOpenDetail }: EmployeeCardProps) {
  const nama = String(employee.nama ?? "");
  const kodeKaryawan = String(employee.kode_karyawan ?? "-");
  const idUnik = String(employee.id_unik ?? "-");
  const divisi = String(employee.divisi ?? "-");
  const jabatan = String(employee.jabatan_status ?? "-");
  const namaShift = String(employee.nama_shift ?? "Belum Ada Shift");
  const statusAktif = String(employee.status_aktif ?? "Aktif");
  const statusBackup = String(employee.status_backup ?? "NORMAL");

  const inisial = nama
    .split(" ")
    .map((n) => n.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const avatarHue = getAvatarHue(nama);
  const isAktif = statusAktif === "Aktif";
  const isBackup = statusBackup === "BACKUP";

  const handleCardClick = () => {
    triggerHaptic("light");
    onOpenDetail(employee);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 backdrop-blur-md shadow-sm transition-all">
      {/* Baris Utama: Avatar + Identitas */}
      <div className="flex items-start gap-3 min-w-0">
        {/* Avatar Inisial */}
        <div className="relative shrink-0">
          <div
            className="grid size-11 place-items-center rounded-2xl text-sm font-black text-white shadow-md"
            style={{
              background: `linear-gradient(135deg, hsl(${avatarHue},70%,35%) 0%, hsl(${avatarHue},50%,22%) 100%)`,
            }}
          >
            {inisial || "??"}
          </div>
          {/* Indikator status aktif sebagai titik di sudut avatar */}
          <span
            className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-slate-900 ${
              isAktif ? "bg-emerald-400" : "bg-slate-500"
            }`}
          />
        </div>

        {/* Identitas */}
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-bold text-white truncate leading-tight">
            {nama || "(Tanpa Nama)"}
          </span>
          <span className="text-[11px] font-mono text-sky-400 truncate mt-0.5">
            {kodeKaryawan} &bull; {idUnik.slice(0, 16)}
            {idUnik.length > 16 ? "\u2026" : ""}
          </span>
          <span className="text-[11px] text-slate-400 truncate mt-0.5">
            {divisi} &bull; {jabatan}
          </span>
        </div>
      </div>

      {/* Baris Badge Status */}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        {/* Badge Shift */}
        <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-sky-300">
          <Icon name="clock" className="size-3" />
          {namaShift}
        </span>

        {/* Badge Status Aktif */}
        <StatusBadge status={statusAktif} />

        {/* Badge Backup (hanya jika BACKUP) */}
        {isBackup ? (
          <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-amber-300">
            Backup Pengganti
          </span>
        ) : null}
      </div>

      {/* Baris Aksi Bawah: Tombol Tunggal Terpadu */}
      <div className="mt-3 pt-3 border-t border-white/[0.06]">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleCardClick();
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-sky-500/40 bg-sky-500/10 py-2 text-[11px] font-bold text-sky-300 hover:bg-sky-500/20 active:scale-95 transition-all"
        >
          <Icon name="id-card" className="size-3.5" />
          Detail Karyawan &amp; ID Card
          <Icon name="chevron-right" className="size-3.5 ml-0.5" />
        </button>
      </div>
    </div>
  );
}
