"use client";

import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { Icon } from "@/components/ui/Icon";
import { triggerHaptic } from "@/lib/client/haptics";
import {
  getScannerSafetySettings,
  type ScannerSafetySettings,
  saveScannerSafetySettings,
} from "@/lib/gateways/scanner-settings";
import { validateScannerSafetySettings } from "@/lib/validations/scanner-settings";

/*
 * Keamanan pemindai & anti double-scan — padanan kartu yang sama di
 * Pengaturan Web/Desktop. Pemanggil wajib menjaganya untuk Superadmin saja:
 * `desktop_get/update_scanner_settings` menolak akun lain.
 */

const MULTI_SCAN_PRESETS = [1, 3, 5, 10, 15];
const COOLDOWN_PRESETS = [10, 30, 60, 120, 300];

const INPUT_CLASS =
  "min-h-11 w-28 rounded-xl border border-white/15 bg-slate-950 px-3 font-mono text-xs text-white outline-none transition focus:border-sky-400";

function presetClass(active: boolean) {
  return `min-h-9 rounded-lg border px-2.5 font-mono text-[11px] font-semibold transition active:scale-95 ${
    active
      ? "border-sky-400 bg-sky-400/20 text-sky-200"
      : "border-white/10 bg-white/5 text-slate-400"
  }`;
}

export function ScannerSafetyCard() {
  const [settings, setSettings] = useState<ScannerSafetySettings>({
    antiDoubleScanSeconds: 60,
    batasMultiScanMenit: 5,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const isSubmittingRef = useRef(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getScannerSafetySettings()
      .then((loaded) => {
        if (!cancelled) setSettings(loaded);
      })
      .catch((err) => {
        if (!cancelled) {
          setFeedback({
            type: "error",
            message:
              err instanceof Error
                ? err.message
                : "Pengaturan keamanan scanner tidak dapat dibaca.",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    const validationMessage = Object.values(
      validateScannerSafetySettings(settings),
    )[0];
    if (validationMessage) {
      triggerHaptic("error");
      setFeedback({ type: "error", message: validationMessage });
      return;
    }
    isSubmittingRef.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      setSettings(await saveScannerSafetySettings(settings));
      triggerHaptic("success");
      setFeedback({
        type: "success",
        message: "Pengaturan keamanan scanner dan multi-scan tersimpan.",
      });
    } catch (err) {
      triggerHaptic("error");
      setFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Pengaturan keamanan scanner gagal disimpan.",
      });
    } finally {
      isSubmittingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-3xl border border-indigo-500/20 bg-gradient-to-br from-indigo-950/30 via-slate-900/80 to-slate-900/90 p-4 backdrop-blur-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-500/20 text-indigo-300">
            <Icon name="scanner" className="size-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white">Keamanan Pemindai</h3>
            <p className="text-[11px] text-slate-400">
              Anti double-scan &amp; batas multi-scan
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-md border border-white/10 bg-slate-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-300">
          {loading
            ? "Memuat"
            : settings.batasMultiScanMenit > 0
              ? `Multi ${settings.batasMultiScanMenit} mnt`
              : "Multi nonaktif"}
        </span>
      </div>

      {feedback ? (
        <FeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onClose={() => setFeedback(null)}
          className="mt-3 text-xs"
        />
      ) : null}

      <div className="mt-3 space-y-2 rounded-2xl border border-white/10 bg-slate-950/60 p-3">
        <label
          htmlFor="scanner-multi-scan"
          className="block text-xs font-bold text-slate-200"
        >
          Batas multi-scan masuk (menit)
        </label>
        <p className="text-[11px] leading-4 text-slate-500">
          Scan masuk ulang dalam kurun waktu ini ditolak agar tidak dianggap
          scan pulang atau duplikat. Default 5 menit; 0 = nonaktif.
        </p>
        <div className="flex items-center gap-2">
          <input
            id="scanner-multi-scan"
            type="number"
            inputMode="numeric"
            min={0}
            max={120}
            step={1}
            disabled={loading}
            value={settings.batasMultiScanMenit}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                batasMultiScanMenit: Math.max(0, Number(event.target.value)),
              }))
            }
            className={INPUT_CLASS}
          />
          <span className="text-[11px] text-slate-400">menit</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {MULTI_SCAN_PRESETS.map((value) => (
            <button
              key={value}
              type="button"
              disabled={loading}
              onClick={() =>
                setSettings((current) => ({
                  ...current,
                  batasMultiScanMenit: value,
                }))
              }
              className={presetClass(settings.batasMultiScanMenit === value)}
            >
              {value} mnt
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 space-y-2 rounded-2xl border border-white/10 bg-slate-950/60 p-3">
        <label
          htmlFor="scanner-cooldown"
          className="block text-xs font-bold text-slate-200"
        >
          Cooldown anti double-scan (detik)
        </label>
        <p className="text-[11px] leading-4 text-slate-500">
          Jeda minimal sebelum scanner membaca lagi QR/kartu yang sama. Default
          60 detik.
        </p>
        <div className="flex items-center gap-2">
          <input
            id="scanner-cooldown"
            type="number"
            inputMode="numeric"
            min={0}
            max={600}
            step={5}
            disabled={loading}
            value={settings.antiDoubleScanSeconds}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                antiDoubleScanSeconds: Math.max(0, Number(event.target.value)),
              }))
            }
            className={INPUT_CLASS}
          />
          <span className="text-[11px] text-slate-400">
            detik ({Math.round((settings.antiDoubleScanSeconds / 60) * 10) / 10}{" "}
            mnt)
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {COOLDOWN_PRESETS.map((value) => (
            <button
              key={value}
              type="button"
              disabled={loading}
              onClick={() =>
                setSettings((current) => ({
                  ...current,
                  antiDoubleScanSeconds: value,
                }))
              }
              className={presetClass(settings.antiDoubleScanSeconds === value)}
            >
              {value >= 60 ? `${value / 60} mnt` : `${value} dtk`}
            </button>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={loading || saving}
        className="mt-3 min-h-11 w-full rounded-xl bg-indigo-500 text-xs font-black text-on-accent shadow-md transition hover:bg-indigo-400 active:scale-95 disabled:opacity-50"
      >
        {saving ? "Menyimpan..." : "Simpan pengaturan scanner"}
      </button>
    </form>
  );
}
