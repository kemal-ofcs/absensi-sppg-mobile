"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { triggerHaptic } from "@/lib/client/haptics";
import { formatBytes, optimizeImageFile } from "@/lib/client/image-optimizer";
import {
  ambilFotoPersonil,
  hapusFotoPersonil,
  simpanFotoPersonil,
} from "@/lib/gateways/personnel-photo";

export interface StagedPhotoData {
  dataUrl: string;
  base64: string;
  mime: string;
}

interface PersonnelPhotoFieldProps {
  idUnik?: string;
  nama: string;
  disabled?: boolean;
  stagedMode?: boolean;
  stagedPhoto?: StagedPhotoData | null;
  onPhotoChanged?: (photoDataUrl: string | null) => void;
  onPhotoStaged?: (staged: StagedPhotoData | null) => void;
}

export function PersonnelPhotoField({
  idUnik,
  nama,
  disabled = false,
  stagedMode = false,
  stagedPhoto = null,
  onPhotoChanged,
  onPhotoStaged,
}: PersonnelPhotoFieldProps) {
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(
    stagedPhoto?.dataUrl || null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(
    !stagedMode && Boolean(idUnik),
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [isError, setIsError] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (stagedMode) {
      setPhotoDataUrl(stagedPhoto?.dataUrl || null);
      setIsLoading(false);
      return;
    }
    let isMounted = true;
    async function loadPhoto() {
      if (!idUnik) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const photo = await ambilFotoPersonil(idUnik);
        if (isMounted) {
          if (photo?.foto_base64) {
            const dataUrl = photo.foto_base64.startsWith("data:")
              ? photo.foto_base64
              : `data:${photo.foto_mime || "image/jpeg"};base64,${photo.foto_base64}`;
            setPhotoDataUrl(dataUrl);
            onPhotoChanged?.(dataUrl);
          } else {
            setPhotoDataUrl(null);
            onPhotoChanged?.(null);
          }
        }
      } catch (err) {
        if (isMounted) {
          console.error("Gagal memuat foto personil:", err);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadPhoto();
    return () => {
      isMounted = false;
    };
  }, [idUnik, stagedMode, stagedPhoto?.dataUrl, onPhotoChanged]);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!stagedMode && !idUnik) return;

    setIsSaving(true);
    setStatusMessage("");
    setIsError(false);

    try {
      const optimized = await optimizeImageFile(file, {
        maxWidth: 600,
        maxHeight: 800,
        quality: 0.85,
        mimeType: "image/jpeg",
        fit: "contain",
      });

      let base64 = optimized.dataUrl;
      let mime = "image/jpeg";
      const match = optimized.dataUrl.match(
        /^data:(image\/[a-zA-Z+]+);base64,(.+)$/,
      );
      if (match) {
        mime = match[1];
        base64 = match[2];
      }

      const fullDataUrl = `data:${mime};base64,${base64}`;
      if (stagedMode) {
        setPhotoDataUrl(fullDataUrl);
        onPhotoChanged?.(fullDataUrl);
        onPhotoStaged?.({ dataUrl: fullDataUrl, base64, mime });
        setStatusMessage(
          `Foto siap disimpan saat karyawan dibuat (${formatBytes(optimized.optimizedSizeBytes)})`,
        );
      } else if (idUnik) {
        await simpanFotoPersonil(idUnik, base64, mime);
        setPhotoDataUrl(fullDataUrl);
        onPhotoChanged?.(fullDataUrl);
        setStatusMessage(
          `Foto disimpan (${formatBytes(optimized.optimizedSizeBytes)})`,
        );
      }
      triggerHaptic("success");
      setIsError(false);
    } catch (err) {
      console.error("Gagal memproses foto personil:", err);
      setStatusMessage(
        err instanceof Error ? err.message : "Gagal memproses foto",
      );
      setIsError(true);
      triggerHaptic("error");
    } finally {
      setIsSaving(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleDeletePhoto() {
    setIsSaving(true);
    setStatusMessage("");
    setIsError(false);

    try {
      if (stagedMode) {
        setPhotoDataUrl(null);
        onPhotoChanged?.(null);
        onPhotoStaged?.(null);
        setStatusMessage("Foto dibatalkan");
      } else if (idUnik) {
        await hapusFotoPersonil(idUnik);
        setPhotoDataUrl(null);
        onPhotoChanged?.(null);
        setStatusMessage("Foto berhasil dihapus");
      }
      triggerHaptic("light");
      setIsError(false);
    } catch (err) {
      console.error("Gagal menghapus foto personil:", err);
      setStatusMessage(
        err instanceof Error ? err.message : "Gagal menghapus foto",
      );
      setIsError(true);
      triggerHaptic("error");
    } finally {
      setIsSaving(false);
    }
  }

  const initials = nama
    ? nama
        .split(" ")
        .slice(0, 2)
        .map((p) => p[0])
        .join("")
        .toUpperCase()
    : "P";

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-3.5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Foto Resmi Personil (ID Card)
        </span>
        {statusMessage ? (
          <span
            className={`text-[11px] font-semibold ${
              isError ? "text-rose-400" : "text-emerald-400"
            }`}
          >
            {statusMessage}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-3.5">
        <div className="relative flex h-20 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/20 bg-slate-800 shadow-md">
          {isLoading ? (
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
          ) : photoDataUrl ? (
            // biome-ignore lint/performance/noImgElement: data URL base64 avatar preview
            <img
              src={photoDataUrl}
              alt={nama || "Foto Personil"}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-base font-bold text-slate-400">
              {initials}
            </span>
          )}

          {isSaving ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            disabled={disabled || isSaving || isLoading}
            onChange={(e) => void handleFileChange(e)}
            id={
              idUnik ? `mobile-photo-input-${idUnik}` : "mobile-photo-input-new"
            }
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled || isSaving || isLoading}
              onClick={() => {
                triggerHaptic("light");
                fileInputRef.current?.click();
              }}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-sky-500 active:scale-95 disabled:opacity-50"
            >
              <Icon name="upload" className="size-3.5" />
              {photoDataUrl ? "Ganti Foto" : "Unggah Foto"}
            </button>

            {photoDataUrl ? (
              <button
                type="button"
                disabled={disabled || isSaving || isLoading}
                onClick={() => void handleDeletePhoto()}
                className="inline-flex min-h-9 items-center gap-1 rounded-xl border border-rose-500/30 bg-rose-950/40 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-900/50 active:scale-95 disabled:opacity-50"
              >
                <Icon name="trash" className="size-3.5" />
                Hapus
              </button>
            ) : null}
          </div>
          <p className="text-[10px] text-slate-400 leading-tight">
            Format JPEG/PNG/WebP, dikompresi otomatis &lt; 500 KB.
          </p>
        </div>
      </div>
    </div>
  );
}
