"use client";

import { dataUrlToBlob, downloadDataUrl } from "@/lib/client/download";
import { isDesktopRuntime } from "@/lib/runtime/app-runtime";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";

export interface ShareResult {
  sukses: boolean;
  cancelled?: boolean;
  message?: string;
}

/**
 * Membagikan berkas gambar (ID Card / QR Code) ke aplikasi lain (WhatsApp, Telegram, Gmail, Drive, dll).
 * Mengutamakan Android Native Share Sheet (via AndroidBridge) pada Android WebView,
 * kemudian Tauri IPC `desktop_share_file`, dan fallback ke Web Share API / Unduhan.
 */
export async function shareDataUrl(
  dataUrl: string,
  filename: string,
  title = "ID Card SPPG",
  text = "ID Card Digital SPPG",
): Promise<ShareResult> {
  const cleanBase64 = dataUrl.includes(";base64,")
    ? dataUrl.split(";base64,")[1] || ""
    : dataUrl.includes(",")
      ? dataUrl.split(",")[1] || ""
      : dataUrl;

  // 1. Android Native Bridge Share Sheet (Prioritas Tertinggi di Mobile WebView)
  if (typeof window !== "undefined" && window.AndroidBridge?.shareImage) {
    try {
      const rawRes = window.AndroidBridge.shareImage(
        cleanBase64,
        filename,
        title,
      );
      const res = JSON.parse(rawRes) as {
        sukses: boolean;
        error?: string;
      };
      if (res.sukses) {
        return {
          sukses: true,
          message: "Membuka menu bagikan...",
        };
      }
      if (res.error) {
        throw new Error(res.error);
      }
    } catch (bridgeErr) {
      console.warn("AndroidBridge shareImage failed, falling back:", bridgeErr);
    }
  }

  // 2. Desktop Tauri Command
  if (isDesktopRuntime()) {
    try {
      const res = await invokeDesktop<{
        sukses: boolean;
        path?: string;
      }>("desktop_share_file", {
        filename,
        base64Data: cleanBase64,
        title,
      });
      if (res?.sukses) {
        return {
          sukses: true,
          message: "Berkas berhasil disiapkan.",
        };
      }
    } catch (desktopErr) {
      console.warn("Tauri desktop_share_file failed:", desktopErr);
    }
  }

  // 3. Web Share API (Browser standar yang mendukung File Sharing)
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function"
  ) {
    try {
      const blob = dataUrlToBlob(dataUrl);
      const file = new File([blob], filename, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title,
          text,
          files: [file],
        });
        return { sukses: true };
      }
      await navigator.share({
        title,
        text,
      });
      return { sukses: true };
    } catch (shareErr) {
      if ((shareErr as Error)?.name === "AbortError") {
        return { sukses: false, cancelled: true };
      }
      console.warn(
        "navigator.share failed, falling back to download:",
        shareErr,
      );
    }
  }

  // 4. Fallback: Simpan ke media penyimpanan lokal
  const downloadRes = await downloadDataUrl(dataUrl, filename);
  // Di Android ini membuka dialog "Simpan ke…"; menutupnya = pembatalan.
  if (downloadRes.cancelled) return { sukses: false, cancelled: true };
  return {
    sukses: downloadRes.sukses,
    message: downloadRes.path
      ? `ID Card tersimpan di ${downloadRes.path}`
      : "ID Card berhasil disimpan.",
  };
}

/**
 * Membagikan teks (ringkasan slip gaji / pesan operasional) via Web Share API atau Clipboard.
 */
export async function shareText(
  text: string,
  title = "Slip Gaji SPPG",
): Promise<ShareResult> {
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function"
  ) {
    try {
      await navigator.share({ title, text });
      return { sukses: true };
    } catch (shareErr) {
      if ((shareErr as Error)?.name === "AbortError") {
        return { sukses: false, cancelled: true };
      }
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return {
        sukses: true,
        message: "Teks slip berhasil disalin ke clipboard.",
      };
    } catch {
      // Clipboard ditolak (izin/konteks tidak aman) bukan akhir jalan: baris
      // di bawah tetap mengembalikan sukses=false beserta pesan yang tampil
      // ke pengguna, jadi kegagalannya tidak disembunyikan.
    }
  }

  return { sukses: false, message: "Perangkat tidak mendukung bagikan teks." };
}
