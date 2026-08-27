"use client";

import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { BootstrapPanel } from "@/components/BootstrapPanel";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { FeedbackBanner } from "@/components/ui/FeedbackBanner";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import {
  type BootstrapStatus,
  getBootstrapStatus,
} from "@/lib/gateways/bootstrap";
import { getServerUrl, setServerUrl } from "@/lib/gateways/server-config";
import { useOnlineStatus } from "@/lib/hooks/useOnlineStatus";

function parseCooldownSeconds(msg: string): number {
  if (
    !msg.toLowerCase().includes("terlalu banyak") &&
    !msg.toLowerCase().includes("rate_limited") &&
    !msg.toLowerCase().includes("dikunci")
  ) {
    return 0;
  }
  let totalSec = 0;
  const minMatch = msg.match(/(\d+)\s*menit/i);
  const secMatch = msg.match(/(\d+)\s*detik/i);
  if (minMatch) totalSec += Number.parseInt(minMatch[1], 10) * 60;
  if (secMatch) totalSec += Number.parseInt(secMatch[1], 10);
  if (totalSec === 0) totalSec = 120;
  return totalSec;
}

export default function LoginPage() {
  const { login, isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const isOnline = useOnlineStatus();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [bootstrapStatus, setBootstrapStatus] =
    useState<BootstrapStatus | null>(null);
  // Dibuka manual ketika kredensial database tersimpan tetapi database cloud-nya
  // tidak menjawab. Tanpa pintu ini, perangkat yang menunjuk database Turso yang
  // sudah dihapus terkunci di form login: provisioning tidak pernah muncul lagi
  // dan tidak ada tempat untuk memasukkan URL database baru.
  const [showDatabaseSetup, setShowDatabaseSetup] = useState(false);
  // Status provisioning belum diketahui pada render pertama. Tanpa penanda ini
  // form login sempat tampil lebih dulu di peluncuran pertama, sehingga instalasi
  // baru terlihat seperti "langsung masuk ke halaman login" padahal layar
  // provisioning menyusul sepersekian detik kemudian.
  const [bootstrapChecked, setBootstrapChecked] = useState(false);

  const refreshBootstrapStatus = useCallback(() => {
    void getBootstrapStatus()
      .then((status) => {
        setBootstrapStatus(status);
        if (status?.reachable) setShowDatabaseSetup(false);
      })
      .catch(() => setBootstrapStatus(null))
      .finally(() => setBootstrapChecked(true));
  }, []);

  useEffect(() => {
    refreshBootstrapStatus();
  }, [refreshBootstrapStatus]);

  // Live countdown ticker
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds((prev) => {
        if (prev <= 1) {
          setErrorMessage("");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  // Server Endpoint Settings state
  const [serverUrl, setServerUrlState] = useState(
    "https://absensi-sppg-seven.vercel.app",
  );
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [customServerUrl, setCustomServerUrl] = useState("");
  const [serverSaveMessage, setServerSaveMessage] = useState("");
  const [isSavingServer, setIsSavingServer] = useState(false);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    void getServerUrl().then((url) => {
      if (url) {
        setServerUrlState(url);
        setCustomServerUrl(url);
      }
    });
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (
      isSubmittingRef.current ||
      cooldownSeconds > 0 ||
      !username.trim() ||
      !password
    )
      return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage("");
    triggerHaptic("light");

    try {
      const result = await login(username.trim(), password);
      if (result.sukses) {
        triggerHaptic("success");
        router.replace("/dashboard");
      } else {
        triggerHaptic("error");
        const msg = result.pesan || "Login gagal.";
        setErrorMessage(msg);
        const cooldown = parseCooldownSeconds(msg);
        if (cooldown > 0) setCooldownSeconds(cooldown);
      }
    } catch (err: unknown) {
      triggerHaptic("error");
      const message =
        err instanceof Error
          ? err.message
          : "Gagal terhubung ke modul autentikasi.";
      setErrorMessage(message);
      const cooldown = parseCooldownSeconds(message);
      if (cooldown > 0) setCooldownSeconds(cooldown);
    } finally {
      setIsSubmitting(false);
      isSubmittingRef.current = false;
    }
  };

  const handleSaveServerUrl = async (urlToSave: string) => {
    const target = urlToSave.trim();
    if (!target) return;
    setIsSavingServer(true);
    setServerSaveMessage("");
    try {
      const savedOrigin = await setServerUrl(target);
      setServerUrlState(savedOrigin);
      setCustomServerUrl(savedOrigin);
      setServerSaveMessage(`Server berhasil disetel ke: ${savedOrigin}`);
      triggerHaptic("success");
      setTimeout(() => {
        setIsServerModalOpen(false);
        setServerSaveMessage("");
      }, 1200);
    } catch (err: unknown) {
      triggerHaptic("error");
      setServerSaveMessage(
        err instanceof Error ? err.message : "Gagal menyimpan URL server.",
      );
    } finally {
      setIsSavingServer(false);
    }
  };

  if (!isAuthenticated && !bootstrapChecked) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="size-10 rounded-full border-3 border-sky-400 border-t-transparent animate-spin" />
          <span className="text-xs font-semibold text-slate-400">
            Memeriksa konfigurasi database...
          </span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated && bootstrapStatus?.required) {
    return (
      <BootstrapPanel
        status={bootstrapStatus}
        onCompleted={refreshBootstrapStatus}
      />
    );
  }

  if (!isAuthenticated && bootstrapStatus && showDatabaseSetup) {
    return (
      <BootstrapPanel
        status={bootstrapStatus}
        onCompleted={refreshBootstrapStatus}
        onCancel={() => setShowDatabaseSetup(false)}
      />
    );
  }

  return (
    <div className="min-h-dvh flex flex-col justify-between bg-slate-950 p-6 pt-[calc(2rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <div className="w-full max-w-sm mx-auto my-auto flex flex-col items-center">
        {/* Brand Banner */}
        <div className="flex flex-col items-center text-center mb-6">
          <BrandLogo size={56} className="mb-4 shadow-sky-500/20" />
          <h1 className="text-2xl font-black tracking-tight text-white">
            Absensi SPPG
          </h1>
          <p className="text-xs font-semibold text-slate-400 mt-1">
            Mobile Edition • Android & iOS
          </p>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs">
              <span
                className={`size-2 rounded-full ${
                  isOnline ? "bg-emerald-400" : "bg-amber-400"
                }`}
              />
              <span className="text-slate-300 font-medium">
                {isOnline ? "Online" : "Offline"}
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                setCustomServerUrl(serverUrl);
                setServerSaveMessage("");
                setIsServerModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-300 hover:bg-sky-500/20 active:scale-95 transition"
            >
              <span>⚙️ Server</span>
            </button>
          </div>
        </div>

        {/* Database cloud tersimpan tetapi tidak menjawab: tawarkan konfigurasi
            ulang, jangan biarkan pengguna menebak-nebak di form login. */}
        {bootstrapStatus?.configured && !bootstrapStatus.reachable ? (
          <div className="mb-4 w-full rounded-2xl border border-amber-500/30 bg-amber-950/50 p-4 text-xs leading-5 text-amber-100">
            <p className="font-bold text-amber-300">
              Database cloud tidak dapat dihubungi
            </p>
            <p className="mt-1 text-[11px] text-amber-200/90">
              {bootstrapStatus.message ??
                "Perangkat ini masih menunjuk database lama."}
            </p>
            <p className="mt-1 text-[11px] text-amber-200/70">
              Kalau internet aktif dan database sudah diganti/dihapus, arahkan
              aplikasi ke database yang baru. Login offline tetap bisa dipakai
              bila perangkat ini pernah login online sebelumnya.
            </p>
            <button
              type="button"
              onClick={() => setShowDatabaseSetup(true)}
              className="mt-3 min-h-10 w-full rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 text-xs font-bold text-amber-200 active:scale-[0.98] transition"
            >
              Konfigurasi ulang database
            </button>
          </div>
        ) : null}

        {/* Login Form Card */}
        <div className="w-full rounded-3xl border border-white/15 bg-slate-900/90 p-6 shadow-2xl backdrop-blur-2xl">
          {cooldownSeconds > 0 ? (
            <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-950/50 p-4 text-center text-xs font-medium text-amber-200 backdrop-blur-md">
              <div className="flex items-center justify-center gap-2 mb-1">
                <span className="text-base animate-pulse">⏳</span>
                <span className="font-bold text-amber-300">
                  Akun Terkunci Sementara
                </span>
              </div>
              <p className="text-[11px] text-amber-200/80">
                Terlalu banyak percobaan gagal. Silakan coba lagi dalam:
              </p>
              <div className="mt-2 inline-flex items-center gap-1 rounded-xl bg-slate-950/80 px-3 py-1 font-mono text-sm font-black text-amber-400 border border-amber-500/20">
                <span>
                  {Math.floor(cooldownSeconds / 60) > 0
                    ? `${Math.floor(cooldownSeconds / 60)}m `
                    : ""}
                  {cooldownSeconds % 60}s
                </span>
              </div>
            </div>
          ) : errorMessage ? (
            <FeedbackBanner
              type="error"
              message={errorMessage}
              className="mb-4"
              onClose={() => setErrorMessage("")}
            />
          ) : null}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="username"
                className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5"
              >
                Username / Kode Operator
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="contoh: super001 atau SPD001"
                autoComplete="username"
                required
                disabled={cooldownSeconds > 0}
                className="w-full min-h-12 rounded-2xl border border-white/15 bg-slate-950 px-4 text-sm text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20 transition disabled:opacity-50"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                disabled={cooldownSeconds > 0}
                className="w-full min-h-12 rounded-2xl border border-white/15 bg-slate-950 px-4 text-sm text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20 transition disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              disabled={
                isSubmitting ||
                cooldownSeconds > 0 ||
                !username.trim() ||
                !password
              }
              className="mt-2 flex min-h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-r from-sky-400 via-sky-500 to-blue-600 font-black text-sm text-slate-950 shadow-xl shadow-sky-950/60 disabled:opacity-50 active:scale-[0.98] transition-all"
            >
              {isSubmitting ? (
                <div className="flex items-center gap-2">
                  <div className="size-4 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />
                  <span>Memverifikasi...</span>
                </div>
              ) : cooldownSeconds > 0 ? (
                <span>Terkunci ({cooldownSeconds}s)</span>
              ) : (
                <span>Masuk Aplikasi</span>
              )}
            </button>
          </form>
        </div>

        {/* Server Endpoint Active Info */}
        <div className="mt-4 text-center">
          <p className="text-[11px] text-slate-400 truncate max-w-xs">
            Endpoint:{" "}
            <span className="font-mono text-sky-300">{serverUrl}</span>
          </p>
        </div>
      </div>

      {/* Footer Info */}
      <footer className="text-center text-[11px] text-slate-500">
        SPPG Absensi Native Mobile v0.1 • 100% Offline-First
      </footer>

      {/* Server Config Modal */}
      {isServerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl border border-white/15 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>⚙️</span> Pengaturan Server API
              </h2>
              <button
                type="button"
                onClick={() => setIsServerModalOpen(false)}
                className="size-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-sm"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              Tentukan alamat server backend SPPG yang dituju untuk autentikasi
              dan sinkronisasi data.
            </p>

            <div className="mb-4">
              <label
                htmlFor="serverUrlInput"
                className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5"
              >
                URL Server Origin
              </label>
              <input
                id="serverUrlInput"
                type="text"
                value={customServerUrl}
                onChange={(e) => setCustomServerUrl(e.target.value)}
                placeholder="https://absensi-sppg-seven.vercel.app"
                className="w-full min-h-11 rounded-xl border border-white/15 bg-slate-950 px-3 text-xs font-mono text-white placeholder-slate-600 focus:border-sky-400 focus:outline-none"
              />
            </div>

            {/* Quick presets */}
            <div className="mb-5 flex flex-col gap-2">
              <span className="text-[11px] font-semibold text-slate-400">
                Pilihan Cepat:
              </span>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setCustomServerUrl("https://absensi-sppg-seven.vercel.app")
                  }
                  className="w-full text-left px-3 py-2 rounded-xl border border-sky-500/20 bg-sky-500/5 hover:bg-sky-500/10 text-xs text-sky-200 transition"
                >
                  <span className="font-bold text-sky-400">
                    ☁️ Cloud Vercel:
                  </span>
                  <div className="font-mono text-[10px] text-slate-300">
                    https://absensi-sppg-seven.vercel.app
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setCustomServerUrl("http://127.0.0.1:3000")}
                  className="w-full text-left px-3 py-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 text-xs text-emerald-200 transition"
                >
                  <span className="font-bold text-emerald-400">
                    💻 USB Reverse / Lokal PC:
                  </span>
                  <div className="font-mono text-[10px] text-slate-300">
                    http://127.0.0.1:3000
                  </div>
                </button>
              </div>
            </div>

            {serverSaveMessage && (
              <div className="mb-4 p-2.5 rounded-xl bg-slate-800 border border-white/10 text-xs text-center text-sky-300 font-medium">
                {serverSaveMessage}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsServerModalOpen(false)}
                className="flex-1 min-h-10 rounded-xl border border-white/10 bg-slate-800 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isSavingServer || !customServerUrl.trim()}
                onClick={() => handleSaveServerUrl(customServerUrl)}
                className="flex-1 min-h-10 rounded-xl bg-sky-500 font-bold text-xs text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition"
              >
                {isSavingServer ? "Menyimpan..." : "Simpan & Terapkan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
