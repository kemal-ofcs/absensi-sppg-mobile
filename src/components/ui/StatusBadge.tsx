interface StatusBadgeProps {
  status: string;
  className?: string;
}

const statusStyles: Record<string, string> = {
  Aktif: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  "Non-Aktif": "bg-rose-500/20 text-rose-300 border-rose-500/40",
  Berhasil: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  Terlambat: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  "Datang Lebih Awal": "bg-sky-500/20 text-sky-300 border-sky-500/40",
  "Pulang Normal": "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  "Pulang Lebih Awal": "bg-amber-500/20 text-amber-300 border-amber-500/40",
  "Pulang Lembur": "bg-indigo-500/20 text-indigo-300 border-indigo-500/40",
  "Perlu Verifikasi": "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  Ditolak: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  Hadir: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  Alfa: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  Izin: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  Sakit: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  Dispen: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  Pending: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  Synced: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
};

export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const style =
    statusStyles[status] ||
    "bg-slate-500/20 text-slate-300 border-slate-500/40";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${style} ${className}`}
    >
      {status}
    </span>
  );
}
