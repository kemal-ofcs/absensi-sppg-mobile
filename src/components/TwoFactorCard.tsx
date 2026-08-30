"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { triggerHaptic } from "@/lib/client/haptics";
import {
  beginTwoFactorSetup,
  confirmTwoFactorSetup,
  disableTwoFactor,
  getTwoFactorStatus,
  type TwoFactorSetup,
  type TwoFactorStatus,
} from "@/lib/gateways/two-factor";

/**
 * Pengaturan verifikasi dua langkah, versi Mobile.
 *
 * Isinya sama persis dengan kartu di Web/Desktop dan memakai gateway yang sama;
 * yang berbeda hanya bahasa visualnya — kartu gradien membulat, tipografi
 * rapat, dan sasaran sentuh minimal 44 px, mengikuti kartu lain di layar
 * Pengaturan Mobile.
 */
type Mode = "idle" | "setup" | "recovery" | "disable";

const inputClass =
  "w-full min-h-11 rounded-2xl border border-white/10 bg-slate-950/60 px-3 text-xs text-white placeholder-slate-600 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20 transition";

export function TwoFactorCard() {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getTwoFactorStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const fail = (error: unknown, fallback: string) =>
    setFeedback({
      tone: "error",
      text: error instanceof Error ? error.message : fallback,
    });

  const startSetup = async () => {
    setBusy(true);
    setFeedback(null);
    triggerHaptic("light");
    try {
      setSetup(await beginTwoFactorSetup());
      setCode("");
      setMode("setup");
    } catch (error) {
      fail(error, "Pendaftaran 2FA tidak dapat dimulai.");
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await confirmTwoFactorSetup(code);
      setRecoveryCodes(result.recoveryCodes);
      setCode("");
      setMode("recovery");
      await refresh();
    } catch (error) {
      fail(error, "Kode tidak dapat diverifikasi.");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      await disableTwoFactor(code);
      setCode("");
      setMode("idle");
      setFeedback({
        tone: "success",
        text: "Verifikasi dua langkah dimatikan.",
      });
      await refresh();
    } catch (error) {
      fail(error, "Verifikasi dua langkah tidak dapat dimatikan.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-3xl border border-violet-500/20 bg-gradient-to-br from-violet-950/25 via-slate-900/80 to-slate-900/90 p-4 backdrop-blur-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-500/20 text-violet-300">
            <Icon name="lock" className="size-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white">
              Verifikasi Dua Langkah
            </h3>
            <p className="text-[11px] text-slate-400">
              Kode 6 digit dari aplikasi autentikator
            </p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
            status?.enabled
              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
              : "border-amber-300/20 bg-amber-300/10 text-amber-300"
          }`}
        >
          {status === null ? "Memuat" : status.enabled ? "Aktif" : "Nonaktif"}
        </span>
      </div>

      <p className="mt-3 rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-[11px] leading-4 text-slate-400">
        Kode dihitung dari waktu, bukan dari jaringan — jadi tetap bekerja di
        lokasi tanpa sinyal.
      </p>

      {status?.requiredByRole && !status.enabled ? (
        <p className="mt-3 rounded-2xl border border-amber-400/25 bg-amber-400/10 p-3 text-[11px] leading-4 text-amber-200">
          Role akun Anda mewajibkan 2FA. Aktifkan sekarang — tanpa itu Anda
          tidak akan bisa login lagi setelah keluar.
        </p>
      ) : null}

      {feedback ? (
        <p
          className={`mt-3 rounded-2xl border p-3 text-[11px] leading-4 ${
            feedback.tone === "success"
              ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
              : "border-rose-400/25 bg-rose-400/10 text-rose-200"
          }`}
        >
          {feedback.text}
        </p>
      ) : null}

      {mode === "idle" ? (
        <div className="mt-3 space-y-2">
          {status?.enabled ? (
            <>
              <p className="text-[11px] text-slate-400">
                Sisa kode cadangan: {status.recoveryRemaining} dari 8.
              </p>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("warning");
                  setCode("");
                  setFeedback(null);
                  setMode("disable");
                }}
                className="min-h-11 w-full rounded-xl border border-rose-400/30 px-3 text-xs font-black text-rose-200 active:scale-95 transition"
              >
                Matikan 2FA
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void startSetup()}
              disabled={busy}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 text-xs font-black text-white shadow-md transition active:scale-95 disabled:opacity-50"
            >
              <Icon name="lock" className="size-4" />
              {busy ? "Menyiapkan..." : "Aktifkan 2FA"}
            </button>
          )}
        </div>
      ) : null}

      {mode === "setup" && setup ? (
        <div className="mt-3 space-y-3">
          <ol className="space-y-1 text-[11px] leading-4 text-slate-300">
            <li>1. Buka Google Authenticator atau Authy.</li>
            <li>2. Pilih tambah akun, masukkan kunci di bawah.</li>
            <li>3. Ketik kode 6 digit yang muncul.</li>
          </ol>

          {/* Kunci ditampilkan sebagai teks, bukan QR: menggambar QR butuh
              pustaka tambahan, sementara semua aplikasi autentikator menerima
              entri manual. */}
          <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Kunci akun (entri manual)
            </p>
            <p className="mt-1 break-all font-mono text-sm font-black tracking-widest text-white">
              {(setup.secret.match(/.{1,4}/g) ?? []).join(" ")}
            </p>
          </div>

          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-slate-300">
              Kode 6 digit
            </span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="123456"
              className={`${inputClass} font-mono tracking-[0.3em]`}
            />
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode("idle")}
              className="min-h-11 flex-1 rounded-xl border border-white/15 px-3 text-xs font-bold text-slate-300 active:scale-95 transition"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={() => void confirmSetup()}
              disabled={busy}
              className="min-h-11 flex-[2] rounded-xl bg-violet-500 px-3 text-xs font-black text-white active:scale-95 transition disabled:opacity-50"
            >
              {busy ? "Memeriksa..." : "Aktifkan Sekarang"}
            </button>
          </div>
        </div>
      ) : null}

      {mode === "recovery" ? (
        <div className="mt-3 space-y-3">
          <p className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-[11px] leading-4 text-emerald-200">
            2FA aktif. Simpan kode cadangan ini sekarang juga.
          </p>
          {/* Ditampilkan sekali seumur pendaftaran: yang tersimpan di database
              hanya hash-nya, jadi tidak ada cara menampilkannya lagi nanti. */}
          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-slate-950/60 p-3 font-mono text-xs text-white">
            {recoveryCodes.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <p className="text-[10px] leading-4 text-slate-500">
            Tiap kode hanya bisa dipakai sekali, sebagai pengganti kode
            autentikator bila ponsel Anda hilang. Halaman ini tidak akan
            menampilkannya lagi.
          </p>
          <button
            type="button"
            onClick={() => {
              setRecoveryCodes([]);
              setMode("idle");
            }}
            className="min-h-11 w-full rounded-xl bg-emerald-500 px-3 text-xs font-black text-slate-950 active:scale-95 transition"
          >
            Saya Sudah Menyimpannya
          </button>
        </div>
      ) : null}

      {mode === "disable" ? (
        <div className="mt-3 space-y-3">
          <p className="text-[11px] leading-4 text-slate-300">
            Masukkan kode dari aplikasi autentikator, atau salah satu kode
            cadangan.
          </p>
          <input
            autoComplete="one-time-code"
            maxLength={16}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="123456 atau ABCD-EFGH"
            className={`${inputClass} font-mono`}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode("idle")}
              className="min-h-11 flex-1 rounded-xl border border-white/15 px-3 text-xs font-bold text-slate-300 active:scale-95 transition"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={() => void turnOff()}
              disabled={busy}
              className="min-h-11 flex-1 rounded-xl bg-rose-500 px-3 text-xs font-black text-white active:scale-95 transition disabled:opacity-50"
            >
              {busy ? "Memproses..." : "Matikan"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
