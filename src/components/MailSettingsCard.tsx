"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { triggerHaptic } from "@/lib/client/haptics";
import {
  getMailConfig,
  type MailTestResult,
  saveMailConfig,
  sendTestMail,
} from "@/lib/gateways/mail-config";
import {
  describeMailFailure,
  isMailProvider,
  MAIL_PROVIDER_LABEL,
  MAIL_PROVIDER_REQUIREMENT,
  MAIL_PROVIDERS,
  type MailConfig,
} from "@/lib/mail/mail-config";

/**
 * Konfigurasi pengirim email sistem, versi Mobile.
 *
 * Isinya sama persis dengan kartu di Web/Desktop dan memakai gateway yang sama;
 * yang berbeda hanya bahasa visualnya — kartu gradien membulat, tipografi
 * rapat, dan sasaran sentuh minimal 44 px, mengikuti kartu lain di layar
 * Pengaturan Mobile.
 */

const inputClass =
  "w-full min-h-11 rounded-2xl border border-white/10 bg-slate-950/60 px-3 text-xs text-white placeholder-slate-600 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/20 transition";

export function MailSettingsCard() {
  const [config, setConfig] = useState<MailConfig | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState<MailConfig["provider"]>("resend");
  const [senderEmail, setSenderEmail] = useState("");
  const [senderName, setSenderName] = useState("");
  const [resetBaseUrl, setResetBaseUrl] = useState("");
  const [isActive, setIsActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<MailTestResult | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  const applyConfig = useCallback((value: MailConfig) => {
    setConfig(value);
    setProvider(value.provider);
    setSenderEmail(value.senderEmail);
    setSenderName(value.senderName);
    setResetBaseUrl(value.resetBaseUrl);
    setIsActive(value.isActive);
    setApiKey("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getMailConfig()
      .then((value) => {
        if (!cancelled) applyConfig(value);
      })
      .catch(() => {
        if (!cancelled) setConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, [applyConfig]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    triggerHaptic("light");
    try {
      applyConfig(
        await saveMailConfig({
          provider,
          apiKey,
          senderEmail,
          senderName,
          resetBaseUrl,
          isActive,
        }),
      );
      setFeedback({
        tone: "success",
        text: "Konfigurasi email sistem tersimpan.",
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "Konfigurasi email tidak dapat disimpan.",
      });
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    triggerHaptic("light");
    try {
      setTestResult(await sendTestMail());
    } catch (error) {
      setTestResult({
        delivered: false,
        message:
          error instanceof Error
            ? error.message
            : "Uji kirim gagal dijalankan.",
        detail: "",
        to: "",
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/25 via-slate-900/80 to-slate-900/90 p-4 backdrop-blur-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-500/20 text-emerald-300">
            <Icon name="tools" className="size-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white">
              Email Sistem (Lupa Password)
            </h3>
            <p className="text-[11px] text-slate-400">
              Pengirim link pemulihan password
            </p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
            config?.isActive
              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
              : "border-amber-300/20 bg-amber-300/10 text-amber-300"
          }`}
        >
          {config === null ? "Memuat" : config.isActive ? "Aktif" : "Nonaktif"}
        </span>
      </div>

      <p className="mt-3 rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-[11px] leading-4 text-slate-400">
        Selama konfigurasi ini nonaktif, operator yang lupa password tidak dapat
        memulihkan akunnya sendiri — tidak ada jalur lain untuk menyerahkan
        token reset selain email pemilik akun.
      </p>

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

      {expanded ? (
        <form className="mt-3 space-y-3" onSubmit={submit}>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-slate-300">
              Penyedia
            </span>
            <select
              value={provider}
              onChange={(event) => {
                if (isMailProvider(event.target.value)) {
                  setProvider(event.target.value);
                }
              }}
              className={inputClass}
            >
              {MAIL_PROVIDERS.map((item) => (
                <option key={item} value={item}>
                  {MAIL_PROVIDER_LABEL[item]}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[10px] leading-4 text-slate-500">
              {MAIL_PROVIDER_REQUIREMENT[provider]}
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-slate-300">
              Kunci API
            </span>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                config?.hasApiKey
                  ? "Tersimpan — isi bila ingin mengganti"
                  : "Tempel kunci API penyedia"
              }
              className={inputClass}
            />
            <span className="mt-1 block text-[10px] leading-4 text-slate-500">
              Kunci tidak pernah ditampilkan kembali setelah disimpan.
            </span>
          </label>

          <div className="grid grid-cols-1 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold text-slate-300">
                Email pengirim
              </span>
              <input
                type="email"
                inputMode="email"
                value={senderEmail}
                onChange={(event) => setSenderEmail(event.target.value)}
                placeholder="no-reply@sppg.id"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold text-slate-300">
                Nama pengirim
              </span>
              <input
                value={senderName}
                onChange={(event) => setSenderName(event.target.value)}
                placeholder="Absensi SPPG"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold text-slate-300">
                URL halaman reset (opsional)
              </span>
              <input
                inputMode="url"
                value={resetBaseUrl}
                onChange={(event) => setResetBaseUrl(event.target.value)}
                placeholder="https://absensi.sppg.id"
                className={inputClass}
              />
              <span className="mt-1 block text-[10px] leading-4 text-slate-500">
                Kosongkan bila tidak memakai aplikasi Web — email akan memuat
                kode reset yang diketik langsung di aplikasi.
              </span>
            </label>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-3">
            <div className="min-w-0">
              <span className="text-xs font-bold text-white">
                Aktifkan pengiriman
              </span>
              <p className="text-[11px] text-slate-400">
                Wajib aktif agar fitur Lupa Password berfungsi.
              </p>
            </div>
            <label className="relative inline-flex shrink-0 cursor-pointer items-center">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-slate-800 after:absolute after:top-0.5 after:left-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-emerald-400 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none" />
            </label>
          </div>

          {testResult ? (
            <div
              className={`rounded-2xl border p-3 text-[11px] leading-4 ${
                testResult.delivered
                  ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
                  : "border-rose-400/25 bg-rose-400/10 text-rose-200"
              }`}
            >
              <p className="font-bold">{testResult.message}</p>
              {describeMailFailure(testResult.detail) ? (
                <p className="mt-1 font-semibold">
                  {describeMailFailure(testResult.detail)}
                </p>
              ) : null}
              {testResult.detail ? (
                <p className="mt-1 break-words font-mono text-[10px] opacity-80">
                  {testResult.detail}
                </p>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void runTest()}
            disabled={testing || !config?.hasApiKey}
            className="min-h-11 w-full rounded-xl border border-white/15 px-3 text-xs font-bold text-slate-200 active:scale-95 transition disabled:opacity-50"
          >
            {testing ? "Mengirim email uji..." : "Kirim Email Uji"}
          </button>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="min-h-11 flex-1 rounded-xl border border-white/15 px-3 text-xs font-bold text-slate-300 active:scale-95 transition"
            >
              Tutup
            </button>
            <button
              type="submit"
              disabled={busy}
              className="min-h-11 flex-[2] rounded-xl bg-emerald-500 px-3 text-xs font-black text-slate-950 shadow-md transition hover:bg-emerald-400 active:scale-95 disabled:opacity-50"
            >
              {busy ? "Menyimpan..." : "Simpan Konfigurasi"}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            triggerHaptic("light");
            setExpanded(true);
          }}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-black text-slate-950 shadow-md transition hover:bg-emerald-400 active:scale-95"
        >
          <Icon name="settings" className="size-4" />
          {config?.hasApiKey ? "Ubah Konfigurasi" : "Atur Sekarang"}
        </button>
      )}
    </div>
  );
}
