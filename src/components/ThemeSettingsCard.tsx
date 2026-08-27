"use client";

import { type ThemePreference, useTheme } from "@/components/ThemeProvider";
import { Icon, type IconName } from "@/components/ui/Icon";
import { triggerHaptic } from "@/lib/client/haptics";

const OPTIONS: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: "system", label: "Sistem", icon: "settings" },
  { value: "light", label: "Terang", icon: "sun" },
  { value: "dark", label: "Gelap", icon: "moon" },
];

/**
 * Pemilih tema lengkap untuk halaman Pengaturan.
 * Header hanya menyediakan sakelar cepat terang/gelap; opsi "Ikuti Sistem"
 * hanya bisa dipilih dari sini.
 */
export function ThemeSettingsCard() {
  const { preference, theme, setPreference } = useTheme();

  return (
    <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-4 backdrop-blur-md">
      <div className="mb-3 flex items-center gap-2.5">
        <div className="grid size-9 place-items-center rounded-xl bg-sky-500/20 text-sky-300">
          <Icon name="palette" className="size-5" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-white">Tema Tampilan</h3>
          <p className="text-[11px] text-slate-400">
            Sedang aktif: {theme === "light" ? "Terang" : "Gelap"}
            {preference === "system" ? " (ikut sistem)" : ""}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {OPTIONS.map((option) => {
          const active = preference === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                triggerHaptic("light");
                setPreference(option.value);
              }}
              className={`flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-[11px] font-bold transition active:scale-95 ${
                active
                  ? "border-sky-500/50 bg-sky-500/15 text-sky-300"
                  : "border-white/10 bg-white/[0.04] text-slate-400 hover:bg-white/[0.08]"
              }`}
            >
              <Icon name={option.icon} className="size-4" />
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
