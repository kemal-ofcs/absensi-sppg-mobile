"use client";

import { useCallback, useEffect, useState } from "react";
import { QrFullscreenDialog } from "@/components/karyawan/QrFullscreenDialog";
import { Icon } from "@/components/ui/Icon";
import { downloadDataUrl } from "@/lib/client/download";
import { triggerHaptic } from "@/lib/client/haptics";
import {
  DEFAULT_ID_CARD_ELEMENTS,
  preloadCardAssets,
  renderIdCardSideToCanvas,
} from "@/lib/client/id-card-renderer";
import { createQrPng, employeeQrPayload } from "@/lib/client/qr-code";
import { shareDataUrl } from "@/lib/client/share";
import {
  type CompanyProfile,
  getCompanyProfile,
} from "@/lib/gateways/company-profile";
import {
  getIdCardTemplate,
  type IdCardTemplateConfig,
} from "@/lib/gateways/id-card-template";
import { syncNow } from "@/lib/gateways/sync-status";
import { useAppLogo } from "@/lib/hooks/useAppLogo";
import type { CardSide } from "@/types/id-card";

interface DigitalIdCardPreviewProps {
  /** Data lengkap satu baris karyawan dari SQLite. */
  employee: Record<string, unknown>;
}

type QrStatus = "loading" | "ready" | "no-token" | "error";

/**
 * Pratinjau ID Card digital karyawan dengan toggle Sisi Depan dan Sisi Belakang.
 * Mendukung template kustom resmi dari Desktop/Cloud dengan rendering Canvas 300 DPI,
 * serta fungsi Bagikan (Native Android Share Sheet) dan Simpan (MediaStore & Notifikasi).
 */
export function DigitalIdCardPreview({ employee }: DigitalIdCardPreviewProps) {
  const logoDataUrl = useAppLogo();

  // Template State
  const [template, setTemplate] = useState<IdCardTemplateConfig | null>(null);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(
    null,
  );
  const [cardSide, setCardSide] = useState<CardSide>("front");
  const [templateRendering, setTemplateRendering] = useState(true);
  const [renderedCardUrl, setRenderedCardUrl] = useState<string | null>(null);
  const [downloadingCard, setDownloadingCard] = useState(false);
  const [sharingCard, setSharingCard] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // QR Code State
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<QrStatus>("loading");
  const [qrFullscreen, setQrFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);

  const nama = String(employee.nama ?? "Karyawan SPPG");
  const tokenAbsensi = employee.token_absensi
    ? String(employee.token_absensi)
    : "";

  // 1. Muat Template ID Card Resmi & Profil Instansi dari SQLite lokal
  const loadTemplateAndCompany = useCallback(async () => {
    try {
      const [tpl, comp] = await Promise.all([
        getIdCardTemplate().catch(() => null),
        getCompanyProfile().catch(() => null),
      ]);
      if (tpl) {
        const safeElements =
          Array.isArray(tpl.elements) && tpl.elements.length > 0
            ? tpl.elements
            : DEFAULT_ID_CARD_ELEMENTS;
        setTemplate({
          ...tpl,
          elements: safeElements,
        });
      }
      if (comp) setCompanyProfile(comp);
    } catch {
      // Fallback jika belum ada template
    }
  }, []);

  useEffect(() => {
    void loadTemplateAndCompany();
    // Memicu sinkronisasi latar belakang agar template terbaru dari cloud langsung tertarik
    void syncNow().catch(() => undefined);
    // Retry load sekali lagi setelah 1.5 detik jika sinkronisasi baru saja menyelesaikan snapshot
    const timer = setTimeout(() => {
      void loadTemplateAndCompany();
    }, 1500);
    return () => clearTimeout(timer);
  }, [loadTemplateAndCompany]);

  // Reaktif terhadap event sync selesai (latar belakang Turso Cloud)
  useEffect(() => {
    const onSyncCompleted = () => {
      void loadTemplateAndCompany();
    };
    window.addEventListener("sppg:sync-completed", onSyncCompleted);
    return () => {
      window.removeEventListener("sppg:sync-completed", onSyncCompleted);
    };
  }, [loadTemplateAndCompany]);

  // 2. Generate QR Code Data URL on-demand
  useEffect(() => {
    let cancelled = false;
    async function generateQr() {
      if (!tokenAbsensi) {
        setQrStatus("no-token");
        setQrDataUrl(null);
        return;
      }
      setQrStatus("loading");
      try {
        const payload = employeeQrPayload(employee);
        const url = await createQrPng(payload, 380);
        if (!cancelled) {
          setQrDataUrl(url);
          setQrStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setQrStatus("error");
          setQrDataUrl(null);
        }
      }
    }
    void generateQr();
    return () => {
      cancelled = true;
    };
  }, [employee, tokenAbsensi]);

  // 3. Render Canvas Template saat template, company, atau sisi kartu berubah
  useEffect(() => {
    let cancelled = false;
    async function renderTemplateCanvas() {
      const effectiveTemplate: IdCardTemplateConfig = template || {
        id: "default_template",
        name: "Template Standar SPPG",
        orientation: "landscape",
        elements: DEFAULT_ID_CARD_ELEMENTS,
        isActive: true,
      };

      const activeCompany =
        companyProfile ||
        (logoDataUrl
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
          : null);

      setTemplateRendering(true);
      try {
        await preloadCardAssets({
          template: effectiveTemplate,
          company: activeCompany,
          employee,
        });

        const url = await renderIdCardSideToCanvas({
          template: effectiveTemplate,
          side: cardSide,
          employee,
          company: activeCompany,
          qrPngOverride: qrDataUrl || undefined,
          dpiScale: 1,
        });
        if (!cancelled) {
          setRenderedCardUrl(url);
        }
      } catch (renderErr) {
        console.warn(
          "Render canvas ID card failed, attempting simple draw:",
          renderErr,
        );
        if (!cancelled) {
          try {
            const fallbackUrl = await renderIdCardSideToCanvas({
              template: {
                ...effectiveTemplate,
                elements: DEFAULT_ID_CARD_ELEMENTS,
              },
              side: cardSide,
              employee,
              company: activeCompany,
              qrPngOverride: qrDataUrl || undefined,
              dpiScale: 1,
            });
            if (!cancelled) setRenderedCardUrl(fallbackUrl);
          } catch {
            if (!cancelled) setRenderedCardUrl(null);
          }
        }
      } finally {
        if (!cancelled) setTemplateRendering(false);
      }
    }

    void renderTemplateCanvas();
    return () => {
      cancelled = true;
    };
  }, [template, companyProfile, cardSide, employee, logoDataUrl, qrDataUrl]);

  const getCardDataUrl = async (side: CardSide): Promise<string> => {
    if (renderedCardUrl && side === cardSide) {
      return renderedCardUrl;
    }
    const activeCompany =
      companyProfile ||
      (logoDataUrl
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
        : null);

    const effectiveTemplate: IdCardTemplateConfig = template || {
      id: "default_template",
      name: "Template Standar SPPG",
      orientation: "landscape",
      elements: DEFAULT_ID_CARD_ELEMENTS,
      isActive: true,
    };

    return await renderIdCardSideToCanvas({
      template: effectiveTemplate,
      side,
      employee,
      company: activeCompany,
      qrPngOverride: qrDataUrl || undefined,
      dpiScale: 1,
    });
  };

  const handleCopyToken = async () => {
    if (!tokenAbsensi) return;
    try {
      await navigator.clipboard.writeText(tokenAbsensi);
      setCopied(true);
      triggerHaptic("success");
      setFeedback({
        type: "success",
        text: "Token absensi berhasil disalin ke clipboard.",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        text: "Gagal menyalin token ke clipboard.",
      });
    } finally {
      setTimeout(
        () => setFeedback((f) => (f?.type === "success" ? null : f)),
        3000,
      );
    }
  };

  const handleDownloadCard = async () => {
    setDownloadingCard(true);
    setFeedback(null);
    const sideLabel = cardSide === "front" ? "Depan" : "Belakang";
    const filename = `ID-Card-${sideLabel}-${nama.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
    try {
      const dataUrl = await getCardDataUrl(cardSide);
      const res = await downloadDataUrl(dataUrl, filename);
      triggerHaptic("success");
      setFeedback({
        type: "success",
        text: `ID Card (${sideLabel}) berhasil disimpan ke ${res.path || "perangkat"}!`,
      });
    } catch (err) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "Gagal menyimpan ID Card ke media penyimpanan.",
      });
    } finally {
      setDownloadingCard(false);
      setTimeout(
        () => setFeedback((f) => (f?.type === "success" ? null : f)),
        4000,
      );
    }
  };

  const handleShareCard = async () => {
    setSharingCard(true);
    setFeedback(null);
    const sideLabel = cardSide === "front" ? "Depan" : "Belakang";
    const filename = `ID-Card-${sideLabel}-${nama.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
    const title = `ID Card SPPG (${sideLabel}) - ${nama}`;
    const text = `ID Card Digital SPPG (${sideLabel}) untuk ${nama}`;
    try {
      const dataUrl = await getCardDataUrl(cardSide);
      const res = await shareDataUrl(dataUrl, filename, title, text);
      if (res.sukses) {
        triggerHaptic("success");
        setFeedback({
          type: "success",
          text: res.message || `ID Card (${sideLabel}) berhasil dibagikan!`,
        });
      } else if (!res.cancelled) {
        triggerHaptic("error");
        setFeedback({
          type: "error",
          text: res.message || "Gagal membagikan ID Card.",
        });
      }
    } catch (err) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Gagal membagikan ID Card.",
      });
    } finally {
      setSharingCard(false);
      setTimeout(
        () => setFeedback((f) => (f?.type === "success" ? null : f)),
        4000,
      );
    }
  };

  const isPortrait = template?.orientation === "portrait";

  return (
    <>
      {/* Sisi Kartu Toggle (Depan / Belakang) */}
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

      {/* Render ID Card Canvas Resolusi Tinggi */}
      <div
        className={`relative w-full overflow-hidden rounded-3xl border border-white/15 bg-slate-950 shadow-2xl transition-all ${
          isPortrait
            ? "aspect-[54/85.6] max-w-[280px] mx-auto"
            : "aspect-[85.6/54]"
        }`}
      >
        {templateRendering && !renderedCardUrl ? (
          <div className="flex size-full items-center justify-center bg-slate-900 animate-pulse">
            <span className="text-xs text-slate-400 font-medium">
              Me-render kartu resolusi tinggi...
            </span>
          </div>
        ) : renderedCardUrl ? (
          // biome-ignore lint/performance/noImgElement: Pratinjau ID card hasil render canvas
          <img
            src={renderedCardUrl}
            alt={`ID Card ${nama} (${cardSide === "front" ? "Depan" : "Belakang"})`}
            className="size-full object-contain rounded-3xl"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center bg-slate-900">
            <Icon name="alert" className="size-6 text-amber-400" />
            <span className="text-xs text-slate-400">
              Sedang memuat pratinjau kartu...
            </span>
          </div>
        )}
      </div>

      {/* Banner Notifikasi Feedback Operasional */}
      {feedback ? (
        <div
          className={`mt-2 flex items-center gap-2 rounded-xl p-2.5 text-xs font-semibold animate-fadeIn ${
            feedback.type === "success"
              ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-300"
              : "bg-rose-500/15 border border-rose-500/30 text-rose-300"
          }`}
        >
          <Icon
            name={feedback.type === "success" ? "check" : "alert"}
            className="size-4 shrink-0"
          />
          <span className="flex-1 leading-tight">{feedback.text}</span>
        </div>
      ) : null}

      {/* Tombol Aksi di Bawah Kartu */}
      <div className="grid grid-cols-2 gap-2 mt-3">
        {/* Bagikan Gambar Kartu */}
        <button
          type="button"
          disabled={sharingCard || templateRendering}
          onClick={() => void handleShareCard()}
          className="flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-3 py-2.5 text-xs font-bold text-slate-950 hover:bg-sky-400 active:scale-95 transition disabled:opacity-40"
        >
          <Icon name="share" className="size-4" />
          {sharingCard ? "Membagikan..." : "Bagikan ID Card"}
        </button>

        {/* Unduh Gambar Kartu */}
        <button
          type="button"
          disabled={downloadingCard || templateRendering}
          onClick={() => void handleDownloadCard()}
          className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 active:scale-95 transition disabled:opacity-40"
        >
          <Icon
            name={downloadingCard ? "check" : "download"}
            className="size-4"
          />
          {downloadingCard
            ? "Tersimpan!"
            : `Unduh ${cardSide === "front" ? "Depan" : "Belakang"}`}
        </button>

        {/* Perbesar QR */}
        <button
          type="button"
          disabled={qrStatus !== "ready"}
          onClick={() => {
            if (qrStatus !== "ready") return;
            triggerHaptic("light");
            setQrFullscreen(true);
          }}
          className="flex items-center justify-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-2.5 text-xs font-bold text-sky-300 hover:bg-sky-500/20 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Icon name="id-card" className="size-4" />
          Perbesar QR
        </button>

        {/* Salin Token */}
        <button
          type="button"
          disabled={!tokenAbsensi}
          onClick={() => void handleCopyToken()}
          className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-xs font-bold text-slate-300 hover:bg-white/10 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
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
