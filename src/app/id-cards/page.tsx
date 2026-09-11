"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DigitalIdCardPreview } from "@/components/karyawan/DigitalIdCardPreview";
import { MobileAppShell } from "@/components/MobileAppShell";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { canAccessArea } from "@/lib/auth/access";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import { getDaftarKaryawan } from "@/lib/gateways/employee";
import { getDaftarIdCard, updateStatusIdCard } from "@/lib/gateways/id-card";
import { useDebounce } from "@/lib/hooks/useDebounce";

/*
 * Daftar ID Card untuk Mobile — padanan tab "Daftar & Cetak Kartu" di
 * `web-desktop/src/app/id-cards`. Perancang template dan tata letak kertas
 * SENGAJA tetap di Desktop: layar sempit dan tidak ada printer.
 *
 * "Cetak" di Android berarti menyimpan gambar kartu dari pratinjau; kartu
 * otomatis ditandai Tercetak begitu gambarnya BENAR-BENAR tersimpan, sama
 * seperti Web saat PNG disimpan. Penandaan manual juga tersedia untuk kartu
 * yang dicetak di tempat lain.
 *
 * Setiap baris digabung dengan data karyawan lengkap sebelum dipakai pratinjau,
 * karena renderer kartu membaca lebih banyak kolom karyawan daripada yang
 * dibawa daftar ID Card. (`jabatan_status` sendiri kini ikut di daftar itu —
 * dulu tidak, dan kartu yang dicetak dari halaman ID Card berjabatan "Staff"
 * untuk semua orang.)
 */

type Row = Record<string, unknown>;
type StatusFilter = "all" | "Belum" | "Berhasil";

/** Kartu dirender bertahap: satu instansi bisa punya ratusan karyawan. */
const PAGE_SIZE = 30;

const STATUS_CHIPS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "Belum", label: "Belum Cetak" },
  { value: "Berhasil", label: "Tercetak" },
];

function statusOf(row: Row): string {
  return String(row.idcard_status || "Belum");
}

function statusLabel(status: string) {
  if (status === "Berhasil") return "Tercetak";
  if (status === "Gagal") return "Gagal";
  return "Belum Cetak";
}

export default function MobileIdCardsPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const canView = canAccessArea(user, "idcards");

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const isSubmittingRef = useRef(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 250);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Row | null>(null);

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

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [cards, employees] = await Promise.all([
        getDaftarIdCard({}),
        // Data karyawan hanya melengkapi pratinjau (jabatan dll.). Gagal
        // memuatnya tidak boleh menyembunyikan daftar kartu itu sendiri.
        getDaftarKaryawan().catch(() => [] as Row[]),
      ]);
      const byId = new Map(
        employees.map((employee) => [String(employee.id_unik), employee]),
      );
      setRows(
        (cards ?? []).map((card) => ({
          ...(byId.get(String(card.id_unik)) ?? {}),
          ...card,
        })),
      );
    } catch (err) {
      if (!silent) {
        setFeedback({
          type: "error",
          message:
            err instanceof Error ? err.message : "Daftar ID Card gagal dimuat.",
        });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && canView) void load();
  }, [isAuthenticated, canView, load]);

  useEffect(() => {
    const onSyncCompleted = () => {
      void load(true);
    };
    window.addEventListener("sppg:sync-completed", onSyncCompleted);
    return () => {
      window.removeEventListener("sppg:sync-completed", onSyncCompleted);
    };
  }, [load]);

  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    return rows.filter((row) => {
      const status = statusOf(row);
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (!term) return true;
      return [row.nama, row.kode_karyawan, row.id_unik, row.divisi]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [rows, debouncedSearch, statusFilter]);

  const printedCount = rows.filter(
    (row) => statusOf(row) === "Berhasil",
  ).length;

  /**
   * Ubah status beberapa kartu. Satu per satu, karena setiap perubahan adalah
   * event outbox tersendiri — gagal di tengah jalan melaporkan yang sudah jadi.
   */
  const markStatus = async (
    ids: string[],
    status: "Belum" | "Berhasil",
    note: string,
    { quiet = false }: { quiet?: boolean } = {},
  ) => {
    if (ids.length === 0 || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setBusy(true);
    let done = 0;
    try {
      for (const id of ids) {
        await updateStatusIdCard({
          id_unik: id,
          idcard_status: status,
          idcard_catatan: note,
        });
        done++;
      }
      triggerHaptic("success");
      if (!quiet) {
        setFeedback({
          type: "success",
          message: `${done} kartu ditandai ${statusLabel(status)}.`,
        });
      }
      setSelected(new Set());
      setSelectMode(false);
      await load(true);
    } catch (err) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        message: `${done} dari ${ids.length} kartu berhasil diubah. ${
          err instanceof Error ? err.message : "Status ID Card gagal diubah."
        }`,
      });
      await load(true);
    } finally {
      isSubmittingRef.current = false;
      setBusy(false);
    }
  };

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (authLoading || !isAuthenticated || !canView) {
    return <div className="min-h-dvh bg-slate-950" />;
  }

  return (
    <MobileAppShell>
      <div className="flex flex-col gap-4 text-slate-100">
        {/* Header */}
        <div className="flex items-center gap-3">
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
            <h1 className="truncate text-lg font-black tracking-tight text-white">
              ID Card
            </h1>
            <p className="text-[11px] text-slate-400">
              {loading
                ? "Memuat..."
                : `${printedCount} dari ${rows.length} kartu tercetak`}
            </p>
          </div>
        </div>

        {feedback ? (
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            onClose={() => setFeedback(null)}
          />
        ) : null}

        {/* Filter */}
        <div className="flex flex-col gap-3 rounded-3xl border border-white/15 bg-slate-900/90 p-3 shadow-xl">
          <input
            type="text"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setVisible(PAGE_SIZE);
            }}
            placeholder="Cari nama, kode, atau divisi..."
            aria-label="Cari ID Card"
            className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 text-xs text-white placeholder-slate-500 outline-none focus:border-sky-400"
          />
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {STATUS_CHIPS.map((chip) => (
              <button
                key={chip.value}
                type="button"
                onClick={() => {
                  triggerHaptic("light");
                  setStatusFilter(chip.value);
                  setVisible(PAGE_SIZE);
                }}
                className={`min-h-9 shrink-0 rounded-xl px-3 text-xs font-semibold transition ${
                  statusFilter === chip.value
                    ? "bg-sky-500 font-bold text-slate-950"
                    : "bg-white/5 text-slate-400 hover:bg-white/10"
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {selectMode ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() =>
                  setSelected(
                    selected.size === filtered.length
                      ? new Set()
                      : new Set(filtered.map((row) => String(row.id_unik))),
                  )
                }
                className="min-h-11 rounded-xl border border-white/10 bg-white/5 text-[11px] font-bold text-slate-300 transition active:scale-95"
              >
                {selected.size === filtered.length && filtered.length > 0
                  ? "Batal pilih semua"
                  : `Pilih semua (${filtered.length})`}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectMode(false);
                  setSelected(new Set());
                }}
                className="min-h-11 rounded-xl border border-white/10 bg-white/5 text-[11px] font-bold text-slate-300 transition active:scale-95"
              >
                Selesai memilih
              </button>
              <button
                type="button"
                disabled={busy || selected.size === 0}
                onClick={() =>
                  void markStatus(
                    [...selected],
                    "Berhasil",
                    "Ditandai tercetak dari Android",
                  )
                }
                className="col-span-2 min-h-11 rounded-xl bg-sky-500 text-xs font-black text-slate-950 shadow-md transition active:scale-95 disabled:opacity-50"
              >
                {busy ? "Menyimpan..." : `Tandai Tercetak (${selected.size})`}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                triggerHaptic("light");
                setSelectMode(true);
              }}
              disabled={loading || filtered.length === 0}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-xs font-bold text-slate-300 transition active:scale-95 disabled:opacity-50"
            >
              <Icon name="check" className="size-4" />
              Pilih beberapa kartu
            </button>
          )}
        </div>

        {/* Daftar */}
        {loading ? (
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-2xl border border-white/5 bg-slate-900/40"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-8 text-center text-xs text-slate-500">
            {rows.length === 0
              ? "Belum ada karyawan untuk dibuatkan ID Card."
              : "Tidak ada kartu yang cocok dengan filter."}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.slice(0, visible).map((row) => {
              const id = String(row.id_unik);
              const status = statusOf(row);
              const printed = status === "Berhasil";
              const isSelected = selected.has(id);
              return (
                <li
                  key={id}
                  className={`flex flex-col gap-2.5 rounded-2xl border p-3.5 ${
                    isSelected
                      ? "border-sky-400/70 bg-sky-950/30"
                      : "border-white/10 bg-slate-900/80"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    {selectMode ? (
                      <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelected(id)}
                          className="size-5 shrink-0 accent-sky-400"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold text-white">
                            {String(row.nama || "-")}
                          </span>
                          <span className="block truncate font-mono text-[11px] text-sky-300">
                            {String(row.kode_karyawan || id)}
                          </span>
                        </span>
                      </label>
                    ) : (
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-white">
                          {String(row.nama || "-")}
                        </p>
                        <p className="truncate font-mono text-[11px] text-sky-300">
                          {String(row.kode_karyawan || id)}
                        </p>
                      </div>
                    )}
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                        printed
                          ? "border-sky-500/40 bg-sky-500/15 text-sky-300"
                          : status === "Gagal"
                            ? "border-rose-500/40 bg-rose-500/15 text-rose-300"
                            : "border-white/15 bg-slate-500/15 text-slate-300"
                      }`}
                    >
                      {statusLabel(status)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-slate-950/60 px-3 py-2 text-[11px]">
                    <span className="truncate text-slate-400">
                      {String(row.jabatan_status || "-")} ·{" "}
                      {String(row.divisi || "-")}
                    </span>
                    <span
                      className={`shrink-0 font-mono font-bold ${
                        row.token_absensi
                          ? "text-emerald-400"
                          : "text-amber-400"
                      }`}
                    >
                      QR {row.token_absensi ? "siap" : "belum terbit"}
                    </span>
                  </div>

                  {!selectMode ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          triggerHaptic("light");
                          setPreview(row);
                        }}
                        className="min-h-11 flex-1 rounded-xl border border-white/10 bg-slate-800 text-xs font-bold text-slate-200 transition active:scale-95"
                      >
                        Pratinjau &amp; simpan
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void markStatus(
                            [id],
                            printed ? "Belum" : "Berhasil",
                            printed
                              ? "Status dikembalikan dari Android"
                              : "Ditandai tercetak dari Android",
                          )
                        }
                        className={`min-h-11 flex-1 rounded-xl text-xs font-bold transition active:scale-95 disabled:opacity-50 ${
                          printed
                            ? "border border-white/10 bg-white/5 text-slate-300"
                            : "bg-sky-500 text-slate-950"
                        }`}
                      >
                        {printed ? "Tandai belum" : "Tandai tercetak"}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {filtered.length > visible ? (
          <button
            type="button"
            onClick={() => setVisible((current) => current + PAGE_SIZE)}
            className="min-h-11 w-full rounded-xl border border-white/10 bg-white/5 text-xs font-bold text-sky-300 transition active:scale-95"
          >
            Tampilkan lagi ({visible} dari {filtered.length})
          </button>
        ) : null}
      </div>

      <Modal
        isOpen={Boolean(preview)}
        onClose={() => setPreview(null)}
        title="Pratinjau ID Card"
        titleId="id-card-preview-title"
        subtitle={preview ? String(preview.nama || "") : undefined}
        maxWidth="max-w-md"
      >
        {preview ? (
          <DigitalIdCardPreview
            employee={preview}
            onSaved={(side) =>
              void markStatus(
                [String(preview.id_unik)],
                "Berhasil",
                `PNG (${side === "front" ? "depan" : "belakang"}) disimpan dari Android`,
                { quiet: true },
              )
            }
          />
        ) : null}
      </Modal>
    </MobileAppShell>
  );
}
