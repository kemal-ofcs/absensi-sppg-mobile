/**
 * Pembuka tautan eksternal untuk build Tauri Mobile.
 *
 * File ini KHUSUS Mobile dan sengaja tidak punya padanan di `web-desktop`,
 * jadi ia tidak akan tertimpa oleh `scripts/sync-frontend-lib.ts` (script itu
 * hanya menyalin, tidak menghapus file tambahan di sisi mobile).
 *
 * WebView Android yang dipakai Tauri tidak meneruskan skema non-http
 * (`tel:`, `whatsapp:`) ke Intent sistem, dan `target="_blank"` pada anchor
 * biasa juga tidak membuka aplikasi native. Karena itu urutannya:
 *   1. `AndroidBridge.openExternal()` — Intent ACTION_VIEW native (jalur utama di APK).
 *   2. `window.open(url, "_blank")` — browser / dev server.
 *   3. `window.location.href` — fallback terakhir.
 */

export interface OpenExternalResult {
  sukses: boolean;
  error?: string;
}

export function openExternalLink(url: string): OpenExternalResult {
  const target = url.trim();
  if (!target) {
    return { sukses: false, error: "Tautan tujuan kosong." };
  }

  if (typeof window === "undefined") {
    return { sukses: false, error: "Tautan hanya bisa dibuka dari perangkat." };
  }

  // 1. Jembatan native Android (APK Tauri Mobile).
  if (window.AndroidBridge?.openExternal) {
    try {
      const rawRes = window.AndroidBridge.openExternal(target);
      const parsed = JSON.parse(rawRes) as OpenExternalResult;
      if (parsed?.sukses) return { sukses: true };
      if (parsed?.error) {
        console.warn("AndroidBridge openExternal gagal:", parsed.error);
      }
    } catch (bridgeErr) {
      console.warn("AndroidBridge openExternal error, fallback:", bridgeErr);
    }
  }

  // 2. Browser biasa / dev server.
  try {
    const opened = window.open(target, "_blank", "noopener,noreferrer");
    if (opened) return { sukses: true };
  } catch {
    // lanjut ke fallback terakhir
  }

  // 3. Navigasi langsung.
  try {
    window.location.href = target;
    return { sukses: true };
  } catch {
    return {
      sukses: false,
      error: "Tidak ada aplikasi yang bisa membuka tautan ini.",
    };
  }
}
