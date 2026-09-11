/**
 * Label & warna status batch payroll — sama dengan
 * `web-desktop/src/components/payroll/RunStatusBadge.tsx`.
 */
const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  DRAFT: {
    label: "Draft",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  },
  SUBMITTED: {
    label: "Diajukan",
    className: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  },
  REVIEWED: {
    label: "Direview",
    className: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300",
  },
  APPROVED: {
    label: "Disetujui",
    className: "border-teal-500/30 bg-teal-500/10 text-teal-300",
  },
  PAID: {
    label: "Dibayar (Terkunci)",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  },
  REJECTED: {
    label: "Ditolak",
    className: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  },
};

export function RunStatusBadge({ status }: { status: string }) {
  const normalized = (status || "").toUpperCase();
  const style = STATUS_STYLE[normalized] ?? {
    label: normalized || "-",
    className: "border-white/15 bg-slate-500/15 text-slate-300",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${style.className}`}
    >
      {style.label}
    </span>
  );
}

export function runStatusLabel(status: string) {
  return STATUS_STYLE[(status || "").toUpperCase()]?.label ?? status;
}
