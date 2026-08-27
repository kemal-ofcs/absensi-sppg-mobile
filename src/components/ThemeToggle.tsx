"use client";

import { useTheme } from "@/components/ThemeProvider";
import { Icon } from "@/components/ui/Icon";
import { triggerHaptic } from "@/lib/client/haptics";

/**
 * Tombol ganti tema di header. Menggantikan posisi tombol "Refresh" lama;
 * sinkronisasi manual sekarang lewat gestur tarik-ke-bawah.
 *
 * Sekali tekan = ganti terang/gelap. Untuk kembali ke "Ikuti Sistem" tersedia
 * pilihan lengkap di halaman Pengaturan.
 */
export function ThemeToggle() {
  const { theme, preference, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={() => {
        triggerHaptic("light");
        toggleTheme();
      }}
      aria-label={isDark ? "Aktifkan tema terang" : "Aktifkan tema gelap"}
      title={
        preference === "system"
          ? "Tema: Ikuti Sistem"
          : isDark
            ? "Tema: Gelap"
            : "Tema: Terang"
      }
      className="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/10 active:scale-95 transition"
    >
      <Icon name={isDark ? "sun" : "moon"} className="size-4" />
    </button>
  );
}
