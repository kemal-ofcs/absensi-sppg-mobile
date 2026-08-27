"use client";

import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/** Pilihan tema yang disimpan. "system" mengikuti pengaturan perangkat. */
export type ThemePreference = "system" | "light" | "dark";
/** Tema yang benar-benar dipakai setelah "system" diselesaikan. */
export type ResolvedTheme = "light" | "dark";

/**
 * Kunci localStorage. Nilai yang sama dibaca oleh skrip anti-kedip di
 * `app/layout.tsx`; ubah keduanya bersamaan kalau perlu diganti.
 */
export const THEME_STORAGE_KEY = "sppg-theme";

interface ThemeContextValue {
  /** Preferensi tersimpan: system | light | dark. */
  preference: ThemePreference;
  /** Tema efektif setelah "system" diselesaikan. */
  theme: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
  /** Ganti cepat terang <-> gelap (memutus mode "system"). */
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // Mode privat / storage diblokir: jatuh ke "system".
  }
  return "system";
}

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

/**
 * Terapkan tema ke <html>. Atribut data-theme dipakai CSS di globals.css,
 * sedangkan meta theme-color menyesuaikan warna status bar Android.
 */
function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", resolved === "light" ? "#f8fafc" : "#030712");
  }
}

/**
 * Penyedia tema gelap/terang tanpa dependensi eksternal.
 *
 * Sengaja tidak memakai `next-themes`: build Mobile adalah static export yang
 * dibungkus Tauri dan harus tetap jalan sepenuhnya offline, jadi satu paket
 * kecil pun tidak sepadan dengan risikonya. Yang dibutuhkan cuma tiga hal —
 * simpan preferensi, ikuti `prefers-color-scheme` saat "system", dan set
 * `data-theme` sebelum paint pertama (dilakukan skrip inline di layout).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [theme, setTheme] = useState<ResolvedTheme>("dark");

  // Baca preferensi tersimpan setelah hidrasi (localStorage tidak ada di SSR).
  useEffect(() => {
    const stored = readStoredPreference();
    setPreferenceState(stored);
    const resolved = stored === "system" ? systemTheme() : stored;
    setTheme(resolved);
    applyTheme(resolved);
  }, []);

  // Ikuti perubahan tema perangkat selama preferensi masih "system".
  useEffect(() => {
    if (preference !== "system") return;
    if (typeof window === "undefined" || !window.matchMedia) return;

    const query = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      const resolved = systemTheme();
      setTheme(resolved);
      applyTheme(resolved);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Preferensi tidak persisten kalau storage diblokir; UI tetap berubah.
    }
    const resolved = next === "system" ? systemTheme() : next;
    setTheme(resolved);
    applyTheme(resolved);
  }, []);

  const toggleTheme = useCallback(() => {
    setPreference(theme === "dark" ? "light" : "dark");
  }, [theme, setPreference]);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, theme, setPreference, toggleTheme }),
    [preference, theme, setPreference, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/** Akses tema aktif. Melempar bila dipakai di luar ThemeProvider. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme harus dipakai di dalam <ThemeProvider>.");
  }
  return ctx;
}
