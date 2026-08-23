"use client";

import { useEffect, useState } from "react";
import { QrFullscreenDialog } from "@/components/karyawan/QrFullscreenDialog";
import { Icon } from "@/components/ui/Icon";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { triggerHaptic } from "@/lib/client/haptics";
import { renderIdCardSideToCanvas } from "@/lib/client/id-card-renderer";
import { createQrPng, employeeQrPayload } from "@/lib/client/qr-code";
import {
  getIdCardTemplate,
  type IdCardTemplateConfig,
} from "@/lib/gateways/id-card-template";
import { useAppLogo } from "@/lib/hooks/useAppLogo";
import type { CardSide } from "@/types/id-card";

interface DigitalIdCardPreviewProps {
  /** Data lengkap satu baris karyawan dari SQLite. */
  employee: Record<string, unknown>;
}

type QrStatus = "loading" | "ready" | "no-token" | "error";

/**
 * Pratinjau ID Card digital karyawan.
 *
 * Mendukung 2 mode tampilan:
 * 1. Template Kustom Resmi (jika ada template yang dikonfigurasi di Desktop/Cloud):
 *    Merender sisi depan & belakang kartu sesuai desain latar dan posisi elemen.
 * 2. Fallback Kartu Digital Modern SPPG:
 *    Tampilan gradien elegan dengan inisial avatar dan QR Code absensi tajam.
 *
 * PERFORMA: Seluruh aset dan canvas hanya di-generate on-demand saat komponen mount.
 */
export function DigitalIdCardPreview({ employee }: DigitalIdCardPreviewProps) {
  const logoDataUrl = useAppLogo();

  // Template State
  const [template, setTemplate] = useState<IdCardTemplateConfig | null>(null);
  const [cardSide, setCardSide] = useState<CardSide>("front");
  const [templateRendering, setTemplateRendering] = useState(true);
  const [renderedCardUrl, setRenderedCardUrl] = useState<string | null>(null);

  // QR Code State
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<QrStatus>("loading");
  const [qrFullscreen, setQrFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);

  const nama = String(employee.nama ?? "-");
  const kodeKaryawan = String(employee.kode_karyawan ?? "-");
  const divisi = String(employee.divisi ?? "-");
  const jabatan = String(employee.jabatan_status ?? "-");
  const statusQr = String(employee.status_qr ?? "Belum");
  const tokenAbsensi = String(employee.token_absensi ?? "");
  const namaShift = String(employee.nama_shift ?? "-");
  const idUnik = String(employee.id_unik ?? "-");

  const inisial = nama
    .split(" ")
    .map((n) => n.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // 1. Muat Template ID Card Resmi dari SQLite lokal
  useEffect(() => {
    let cancelled = false;
    async function loadTemplate() {
      try {
        const tpl = await getIdCardTemplate("default_template");
        if (!cancelled && tpl) {
          setTemplate(tpl);
        }
      } catch {
        // Fallback ke mode default jika template gagal dibaca
      }
    }
    void loadTemplate();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Generate QR Code Data URL on-demand
  useEffect(() => {
    let cancelled = false;
    async function generateQr() {
      const payload = employeeQrPayload(employee);
      if (!payload) {
        setQrStatus("no-token");
        return;
      }
      try {
        const dataUrl = await createQrPng(payload, 512);
        if (!cancelled) {
          setQrDataUrl(dataUrl);
          setQrStatus("ready");
        }
      } catch {
        if (!cancelled) setQrStatus("error");
      }
    }
    void generateQr();
    return () => {
      cancelled = true;
    };
  }, [employee]);

  // 3. Render Canvas Template Kustom saat template atau sisi kartu berubah
  useEffect(() => {
    let cancelled = false;
    async function renderTemplateCanvas() {
      if (!template) {
        setTemplateRendering(false);
        return;
      }
      setTemplateRendering(true);
      try {
        const url = await renderIdCardSideToCanvas({
          template,
          side: cardSide,
          employee,
          company: logoDataUrl
            ? {
                id: "default",
                company_name: "SPPG",
                branch_name: null,
                logo_url: logoDataUrl,
                signature_url: null,
                address: null,
                phone: null,
                email: null,
                website: null,
                leader_name: null,
                leader_title: null,
                leader_nip: null,
                card_terms: null,
                timezone: "Asia/Jakarta",
                updated_at: "",
              }
            : null,
          qrPngOverride: qrDataUrl || undefined,
          dpiScale: 1,
        });
        if (!cancelled) {
          setRenderedCardUrl(url);
        }
      } catch {
        if (!cancelled) setRenderedCardUrl(null);
      } finally {
        if (!cancelled) setTemplateRendering(false);
      }
    }
    void renderTemplateCanvas();
    return () => {
      cancelled = true;
    };
  }, [template, cardSide, employee, logoDataUrl, qrDataUrl]);

  const handleCopyToken = async () => {
    if (!tokenAbsensi) return;
    try {
      await navigator.clipboard.writeText(tokenAbsensi);
      setCopied(true);
      triggerHaptic("success");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard fallback
    }
  };

  const hasCustomBg = Boolean(
    template?.frontBgUrl ||
      template?.backBgUrl ||
      (template?.elements && template.elements.length > 0),
  );

  return (
    <>
      {/* Sisi Kartu Toggle (Depan / Belakang) jika ada template kustom */}
      {hasCustomBg ? (
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="text-xs font-bold text-slate-400">
            Pratinjau Kartu ID
          </span>
          <div className="flex rounded-xl bg-slate-800/80 p-1 border border-white/10">
            <button
              type="button"
              onClick={() => {
                triggerHaptic("light");
                setCardSide("front");
              }}
              className={`rounded-lg px-3 py-1 text-[11px] font-bold transition-all ${
                cardSide === "front"
                  ? "bg-sky-500 text-slate-950 shadow"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Sisi Depan
            </button>
            <button
              type="button"
              onClick={() => {
                triggerHaptic("light");
                setCardSide("back");
              }}
              className={`rounded-lg px-3 py-1 text-[11px] font-bold transition-all ${
                cardSide === "back"
                  ? "bg-sky-500 text-slate-950 shadow"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Sisi Belakang
            </button>
          </div>
        </div>
      ) : null}

      {/* Render ID Card Kustom (jika template aktif dan berhasil di-render) */}
      {hasCustomBg && renderedCardUrl ? (
        <div className="relative overflow-hidden rounded-3xl border border-white/15 bg-slate-950 shadow-2xl">
          {templateRendering ? (
            <div className="flex h-56 w-full items-center justify-center bg-slate-900 animate-pulse">
              <span className="text-xs text-slate-500">Memuat kartu...</span>
            </div>
          ) : (
            // biome-ignore lint/performance/noImgElement: Pratinjau ID card hasil render canvas
            <img
              src={renderedCardUrl}
              alt={`ID Card ${nama} (${cardSide === "front" ? "Depan" : "Belakang"})`}
              className="w-full object-contain rounded-3xl"
            />
          )}
        </div>
      ) : (
        /* Fallback: Kartu Digital Modern SPPG */
        <div className="relative overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-br from-slate-900 via-slate-900/90 to-sky-950/60 p-5 shadow-2xl">
          {/* Glow Dekoratif Latar */}
          <div className="pointer-events-none absolute -right-12 -top-12 size-48 rounded-full bg-sky-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-10 -left-10 size-40 rounded-full bg-indigo-500/10 blur-3xl" />

          {/* Header Kartu: Logo + Nama Instansi */}
          <div className="relative flex items-center gap-3 mb-5">
            {logoDataUrl ? (
              // biome-ignore lint/performance/noImgElement: Logo instansi dekoratif
              <img
                src={logoDataUrl}
                alt="Logo Instansi"
                className="size-10 rounded-xl object-contain bg-white/10 p-1"
              />
            ) : (
              <div className="grid size-10 place-items-center rounded-xl bg-sky-500/20 text-sky-300">
                <Icon name="id-card" className="size-5" />
              </div>
            )}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-sky-400">
                SPPG
              </p>
              <p className="text-xs font-black text-white leading-tight">
                Kartu Identitas Karyawan
              </p>
            </div>
          </div>

          {/* Isi Kartu: Identitas + QR */}
          <div className="relative flex items-start gap-4">
            {/* Identitas */}
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              {/* Avatar inisial */}
              <div className="grid size-14 place-items-center rounded-2xl bg-slate-700/60 text-lg font-black text-white border border-white/10 mb-2">
                {inisial || "??"}
              </div>
              <p className="text-base font-black text-white truncate">{nama}</p>
              <p className="text-[11px] font-mono text-sky-400">
                {kodeKaryawan}
              </p>
              <p className="text-[11px] text-slate-300 truncate">
                {divisi} &bull; {jabatan}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">{namaShift}</p>

              {/* Status QR Badge */}
              <div className="mt-2">
                <StatusBadge status={statusQr} />
              </div>
            </div>

            {/* Area QR Code */}
            <div className="shrink-0 flex flex-col items-center gap-2">
              <div className="size-28 rounded-2xl bg-white p-2 flex items-center justify-center">
                {qrStatus === "loading" && (
                  <div className="size-full rounded-xl bg-slate-200 animate-pulse" />
                )}
                {qrStatus === "ready" && qrDataUrl ? (
                  // biome-ignore lint/performance/noImgElement: QR Code gambar dinamis
                  <img
                    src={qrDataUrl}
                    alt={`QR Code ${nama}`}
                    className="size-full object-contain"
                    draggable={false}
                  />
                ) : null}
                {qrStatus === "no-token" && (
                  <div className="flex flex-col items-center gap-1 text-center p-1">
                    <Icon name="alert" className="size-5 text-amber-500" />
                    <p className="text-[9px] text-slate-500 leading-tight">
                      Token belum dibuat
                    </p>
                  </div>
                )}
                {qrStatus === "error" && (
                  <div className="flex flex-col items-center gap-1 text-center p-1">
                    <Icon name="alert" className="size-5 text-rose-500" />
                    <p className="text-[9px] text-slate-500 leading-tight">
                      Gagal generate
                    </p>
                  </div>
                )}
              </div>
              <p className="text-[9px] text-slate-500 text-center font-mono max-w-[7rem] truncate">
                {idUnik}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tombol Aksi di Bawah Kartu */}
      <div className="flex gap-2 mt-3">
        {/* Perbesar QR */}
        <button
          type="button"
          disabled={qrStatus !== "ready"}
          onClick={() => {
            if (qrStatus !== "ready") return;
            triggerHaptic("light");
            setQrFullscreen(true);
          }}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-2.5 text-xs font-bold text-sky-300 hover:bg-sky-500/20 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Icon name="id-card" className="size-4" />
          Perbesar QR
        </button>

        {/* Salin Token */}
        <button
          type="button"
          disabled={!tokenAbsensi}
          onClick={() => void handleCopyToken()}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-xs font-bold text-slate-300 hover:bg-white/10 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Icon name={copied ? "check" : "upload"} className="size-4" />
          {copied ? "Tersalin!" : "Salin Token"}
        </button>
      </div>

      {/* Informasi Token Tersembunyi */}
      {tokenAbsensi ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-slate-900/60 p-3">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
            Token Absensi
          </p>
          <p className="text-xs font-mono text-slate-300 break-all">
            {tokenAbsensi}
          </p>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="text-xs text-amber-400 leading-relaxed">
            Token absensi belum dibuat. Gunakan fitur Generate Token di aplikasi
            Desktop untuk mengaktifkan QR Code karyawan ini.
          </p>
        </div>
      )}

      {/* Dialog QR Fullscreen */}
      <QrFullscreenDialog
        qrDataUrl={qrDataUrl ?? ""}
        employeeName={nama}
        isOpen={qrFullscreen && qrStatus === "ready"}
        onClose={() => setQrFullscreen(false)}
      />
    </>
  );
}
