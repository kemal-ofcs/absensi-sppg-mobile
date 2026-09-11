"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { triggerHaptic } from "@/lib/client/haptics";

/*
 * Potongan UI bersama halaman konfigurasi payroll Mobile (`/payroll/config`
 * dan tiga sub-halaman aturannya). Sengaja di `components/`, bukan `lib/`:
 * `mobile/src/lib` adalah salinan hasil generate dari `web-desktop`.
 */

export const IDR = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export const CONFIG_INPUT_CLASS =
  "min-h-11 w-full rounded-xl border border-white/15 bg-slate-950 px-3 text-sm text-white outline-none focus:border-sky-400 disabled:opacity-60";

export const CONFIG_LABEL_CLASS =
  "mb-1 block text-[11px] font-semibold text-slate-400";

/** Tanggal lokal perangkat; `toISOString()` memakai UTC dan meleset sehari sebelum pukul 07.00 WIB. */
export function todayLocal() {
  return new Date().toLocaleDateString("en-CA");
}

/**
 * Mengurai isian angka opsional. String kosong berarti "tanpa batas" (null);
 * selain itu hasilnya angka, atau NaN bila isiannya bukan angka.
 */
export function parseOptionalNumber(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

export function PayrollConfigHeader({
  title,
  subtitle,
  backHref,
  backLabel,
  loading,
  onReload,
}: {
  title: string;
  subtitle: string;
  backHref: string;
  backLabel: string;
  loading: boolean;
  onReload: () => void;
}) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => {
          triggerHaptic("light");
          router.push(backHref);
        }}
        aria-label={backLabel}
        className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/5 text-slate-300 transition hover:bg-white/10 active:scale-95"
      >
        <Icon name="arrow-left" className="size-5" />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-black tracking-tight text-white">
          {title}
        </h1>
        <p className="text-[11px] text-slate-400">{subtitle}</p>
      </div>
      <button
        type="button"
        onClick={() => {
          triggerHaptic("light");
          onReload();
        }}
        disabled={loading}
        aria-label="Muat ulang data"
        className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/5 text-slate-300 transition hover:bg-white/10 active:scale-95 disabled:opacity-50"
      >
        <Icon
          name="refresh"
          className={`size-5 ${loading ? "animate-spin" : ""}`}
        />
      </button>
    </div>
  );
}

export function ConfigSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, i) => `skeleton-${i + 1}`).map(
        (id) => (
          <div
            key={id}
            className="h-24 animate-pulse rounded-2xl border border-white/5 bg-slate-900/40"
          />
        ),
      )}
    </div>
  );
}

export function ConfigEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-6 text-center text-xs text-slate-500">
      {children}
    </div>
  );
}

/** Tombol Ubah + Hapus pada kartu baris konfigurasi. */
export function ConfigRowActions({
  deleteLabel,
  onEdit,
  onDelete,
}: {
  deleteLabel: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex shrink-0 gap-1.5">
      <button
        type="button"
        onClick={() => {
          triggerHaptic("light");
          onEdit();
        }}
        className="min-h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-[11px] font-bold text-sky-300 transition active:scale-95"
      >
        Ubah
      </button>
      <button
        type="button"
        onClick={() => {
          triggerHaptic("light");
          onDelete();
        }}
        aria-label={deleteLabel}
        className="grid size-9 place-items-center rounded-lg border border-rose-500/25 bg-rose-500/10 text-rose-300 transition active:scale-95"
      >
        <Icon name="trash" className="size-4" />
      </button>
    </div>
  );
}

/** Kerangka form di dalam Modal: pesan galat, isian, lalu Batal + Simpan. */
export function ConfigFormModal({
  isOpen,
  title,
  titleId,
  error,
  saving,
  submitLabel,
  onDismissError,
  onClose,
  onSubmit,
  children,
}: {
  isOpen: boolean;
  title: string;
  titleId: string;
  error: string | null;
  saving: boolean;
  submitLabel: string;
  onDismissError: () => void;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!saving) onClose();
      }}
      title={title}
      titleId={titleId}
      maxWidth="max-w-md"
      hideFooter
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="flex flex-col gap-3.5 text-xs"
      >
        {error ? (
          <FeedbackBanner
            type="error"
            message={error}
            onClose={onDismissError}
            className="text-xs"
          />
        ) : null}
        {children}
        <div className="flex items-center gap-2 border-t border-white/10 pt-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/5 font-bold text-slate-300 transition active:scale-95 disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={saving}
            className="min-h-11 flex-1 rounded-xl bg-sky-500 font-black text-slate-950 shadow-lg transition active:scale-95 disabled:opacity-50"
          >
            {saving ? "Menyimpan..." : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ConfirmDeleteModal({
  label,
  note,
  titleId,
  busy,
  onCancel,
  onConfirm,
}: {
  label: string | null;
  note: string;
  titleId: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      isOpen={label !== null}
      onClose={() => {
        if (!busy) onCancel();
      }}
      title="Konfirmasi penghapusan"
      titleId={titleId}
      maxWidth="max-w-sm"
      hideFooter
    >
      {label !== null ? (
        <div className="flex flex-col gap-4 text-xs">
          <div className="rounded-2xl border border-rose-500/20 bg-rose-950/30 p-3.5">
            <p className="text-sm leading-6 text-slate-300">
              Hapus <strong className="text-white">{label}</strong>?
            </p>
            <p className="mt-1 text-[11px] leading-4 text-slate-400">{note}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/5 text-xs font-bold text-slate-300 transition hover:bg-white/10 active:scale-95 disabled:opacity-50"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className="min-h-11 flex-1 rounded-xl bg-rose-500 text-xs font-black text-on-accent shadow-lg transition hover:bg-rose-600 active:scale-95 disabled:opacity-50"
            >
              {busy ? "Menghapus..." : "Hapus"}
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

/** Catatan standar dialog hapus: batch yang sudah dibuat tidak ikut berubah. */
export const FROZEN_RUN_NOTE =
  "Batch payroll yang sudah dibuat tidak berubah — angkanya dibekukan saat batch dibuat. Yang terpengaruh hanya batch berikutnya.";
