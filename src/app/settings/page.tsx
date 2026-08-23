"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MobileAppShell } from "@/components/MobileAppShell";
import { Icon } from "@/components/ui/Icon";
import { canAccessArea, hasPermission } from "@/lib/auth/access";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import {
  type GeofenceSettings,
  getGeofenceSettings,
  saveGeofenceSettings,
} from "@/lib/gateways/geofence";
import {
  clearTursoConfig,
  getTursoUrl,
  saveTursoConfig,
  type TursoConnectionStatus,
  testTursoConnection,
} from "@/lib/gateways/turso-config";
import { useOnlineStatus } from "@/lib/hooks/useOnlineStatus";

export default function SettingsPage() {
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const router = useRouter();
  const isOnline = useOnlineStatus();
  const canOperational = canAccessArea(user, "operational");
  const canShift = canAccessArea(user, "shift");
  const canManageGeofence = Boolean(
    user?.isSuperadmin || hasPermission(user, "branding.manage"),
  );

  const [geofence, setGeofence] = useState<GeofenceSettings>({
    enabled: false,
    latitude: 0,
    longitude: 0,
    radiusMeter: 100,
  });
  const [geofenceLoading, setGeofenceLoading] = useState(true);
  const [saveMessage, setSaveMessage] = useState("");

  const [tursoUrl, setTursoUrl] = useState("");
  const [tursoToken, setTursoToken] = useState("");
  const [showTursoToken, setShowTursoToken] = useState(false);
  const [tursoBusy, setTursoBusy] = useState(false);
  const [tursoTesting, setTursoTesting] = useState(false);
  const [tursoTestStatus, setTursoTestStatus] =
    useState<TursoConnectionStatus | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    let cancelled = false;
    async function loadGeofence() {
      try {
        const settings = await getGeofenceSettings();
        if (!cancelled) setGeofence(settings);
      } catch {
        // Handled
      } finally {
        if (!cancelled) setGeofenceLoading(false);
      }
    }
    if (isAuthenticated && canManageGeofence) {
      void loadGeofence();
    } else {
      setGeofenceLoading(false);
    }
    if (isAuthenticated && user?.isSuperadmin) {
      getTursoUrl()
        .then((url) => {
          if (!cancelled && url) setTursoUrl(url);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, canManageGeofence, user?.isSuperadmin]);

  const handleLogout = async () => {
    triggerHaptic("warning");
    if (confirm("Apakah Anda yakin ingin keluar dari akun operator ini?")) {
      await logout();
      router.replace("/login");
    }
  };

  const handleToggleGeofence = async () => {
    triggerHaptic("light");
    const updated = { ...geofence, enabled: !geofence.enabled };
    setGeofence(updated);
    try {
      await saveGeofenceSettings(updated);
      triggerHaptic("success");
      setSaveMessage(
        updated.enabled
          ? "Geofencing GPS diaktifkan."
          : "Geofencing GPS dinonaktifkan.",
      );
      setTimeout(() => setSaveMessage(""), 3000);
    } catch {
      triggerHaptic("error");
    }
  };

  const handleTursoSave = async () => {
    if (!tursoUrl.trim()) {
      setSaveMessage("URL database cloud Turso tidak boleh kosong.");
      setTimeout(() => setSaveMessage(""), 3000);
      return;
    }
    setTursoBusy(true);
    triggerHaptic("light");
    try {
      await saveTursoConfig(tursoUrl.trim(), tursoToken.trim());
      triggerHaptic("success");
      setSaveMessage(
        "Konfigurasi database cloud Turso berhasil disimpan ke Vault!",
      );
      const status = await testTursoConnection(
        tursoUrl.trim(),
        tursoToken.trim(),
      );
      setTursoTestStatus(status);
      setTimeout(() => setSaveMessage(""), 4000);
    } catch (error) {
      triggerHaptic("error");
      setSaveMessage(
        error instanceof Error
          ? error.message
          : "Gagal menyimpan konfigurasi Turso.",
      );
      setTimeout(() => setSaveMessage(""), 4000);
    } finally {
      setTursoBusy(false);
    }
  };

  const handleTursoTest = async () => {
    setTursoTesting(true);
    triggerHaptic("light");
    try {
      const status = await testTursoConnection(
        tursoUrl.trim() || undefined,
        tursoToken.trim() || undefined,
      );
      setTursoTestStatus(status);
      if (status.connected) {
        triggerHaptic("success");
        setSaveMessage(
          `Koneksi Berhasil! Latensi: ${status.latency_ms ?? 0} ms`,
        );
      } else {
        triggerHaptic("error");
        setSaveMessage(`Koneksi gagal: ${status.error_message || "Error"}`);
      }
      setTimeout(() => setSaveMessage(""), 4000);
    } catch (error) {
      triggerHaptic("error");
      setSaveMessage(
        error instanceof Error ? error.message : "Gagal menguji koneksi Turso.",
      );
      setTimeout(() => setSaveMessage(""), 4000);
    } finally {
      setTursoTesting(false);
    }
  };

  const handleTursoClear = async () => {
    if (
      !confirm("Hapus konfigurasi database cloud Turso dari perangkat ini?")
    ) {
      return;
    }
    setTursoBusy(true);
    triggerHaptic("warning");
    try {
      await clearTursoConfig();
      setTursoUrl("");
      setTursoToken("");
      setTursoTestStatus(null);
      setSaveMessage("Konfigurasi database cloud Turso berhasil direset.");
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (_error) {
      setSaveMessage("Gagal mereset konfigurasi.");
    } finally {
      setTursoBusy(false);
    }
  };

  if (!user) return null;

  return (
    <MobileAppShell>
      <div className="flex flex-col gap-4">
        {/* Operator Profile Card */}
        <div className="rounded-3xl border border-white/15 bg-gradient-to-br from-slate-900 via-slate-900/90 to-sky-950/40 p-5 shadow-xl backdrop-blur-xl">
          <div className="flex items-center gap-3.5 mb-4">
            <div className="grid size-14 place-items-center rounded-2xl bg-gradient-to-tr from-sky-400 to-blue-600 font-black text-xl text-slate-950 shadow-lg">
              {user.nama_operator?.charAt(0)?.toUpperCase() || "O"}
            </div>
            <div className="flex flex-col min-w-0">
              <h2 className="text-base font-black text-white truncate">
                {user.nama_operator}
              </h2>
              <span className="text-xs font-semibold text-sky-300">
                {user.role} • {user.kode_operator}
              </span>
              <span className="text-[11px] text-slate-400 mt-0.5">
                Username: @{user.username}
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-xs text-slate-300 space-y-1.5">
            <div className="flex justify-between">
              <span className="text-slate-500">Status Server:</span>
              <span
                className={isOnline ? "text-emerald-400" : "text-amber-400"}
              >
                {isOnline ? "Terhubung Online" : "Mode Offline"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Revisi Izin:</span>
              <span className="font-semibold text-white">
                v{user.permissionRevision}
              </span>
            </div>
          </div>
        </div>

        {/* Global Toast Message */}
        {saveMessage && (
          <div className="rounded-2xl border border-sky-500/30 bg-sky-950/60 p-3 text-xs font-bold text-sky-200 shadow-lg">
            {saveMessage}
          </div>
        )}

        {/* Pusat Operasional SPPG Section (Hanya jika memiliki izin operasional) */}
        {canOperational ? (
          <div className="rounded-3xl border border-indigo-500/20 bg-gradient-to-br from-indigo-950/30 via-slate-900/80 to-slate-900/90 p-4 backdrop-blur-md">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-2.5">
                <div className="grid size-9 place-items-center rounded-xl bg-indigo-500/20 text-indigo-300">
                  <Icon name="tools" className="size-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Pusat Operasional SPPG
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Koreksi admin, penugasan backup &amp; entri manual
                  </p>
                </div>
              </div>
              <Link
                href="/operational"
                onClick={() => triggerHaptic("light")}
                className="rounded-xl bg-indigo-500 px-3.5 py-1.5 text-xs font-black text-white shadow-md hover:bg-indigo-400 active:scale-95 transition"
              >
                Buka &rarr;
              </Link>
            </div>
          </div>
        ) : null}

        {/* Shift Kerja & Jadwal Section (Hanya jika memiliki izin shift) */}
        {canShift ? (
          <div className="rounded-3xl border border-sky-500/20 bg-gradient-to-br from-sky-950/30 via-slate-900/80 to-slate-900/90 p-4 backdrop-blur-md">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="grid size-9 place-items-center rounded-xl bg-sky-500/20 text-sky-300">
                  <Icon name="clock" className="size-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Shift Kerja &amp; Jadwal
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Atur jam masuk, jam pulang, toleransi &amp; istirahat
                  </p>
                </div>
              </div>
              <Link
                href="/shift"
                onClick={() => triggerHaptic("light")}
                className="rounded-xl bg-sky-500 px-3.5 py-1.5 text-xs font-black text-slate-950 shadow-md hover:bg-sky-400 active:scale-95 transition whitespace-nowrap"
              >
                Kelola &rarr;
              </Link>
            </div>
          </div>
        ) : null}

        {/* Superadmin Turso Database Cloud Section */}
        {user?.isSuperadmin ? (
          <div className="rounded-3xl border border-cyan-400/20 bg-gradient-to-br from-cyan-950/20 via-slate-900/90 to-slate-900/95 p-4 backdrop-blur-md">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2.5">
                <div className="grid size-9 place-items-center rounded-xl bg-cyan-400/20 text-cyan-300">
                  <Icon name="database" className="size-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Database Cloud (Turso)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Koneksi langsung LibSQL HTTP Pipeline
                  </p>
                </div>
              </div>
              <span className="rounded-md bg-cyan-400/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-cyan-300 border border-cyan-400/20">
                Superadmin
              </span>
            </div>

            <div className="space-y-3 pt-1">
              <div>
                <label
                  htmlFor="turso-url-input"
                  className="block text-[11px] font-bold text-slate-300 mb-1"
                >
                  URL Database Cloud
                </label>
                <input
                  id="turso-url-input"
                  type="text"
                  value={tursoUrl}
                  onChange={(e) => setTursoUrl(e.target.value)}
                  placeholder="libsql://db-org.turso.io"
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs font-mono text-white outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label
                  htmlFor="turso-token-input"
                  className="block text-[11px] font-bold text-slate-300 mb-1"
                >
                  Auth Token Database
                </label>
                <div className="relative">
                  <input
                    id="turso-token-input"
                    type={showTursoToken ? "text" : "password"}
                    value={tursoToken}
                    onChange={(e) => setTursoToken(e.target.value)}
                    placeholder={
                      tursoUrl
                        ? "•••••••••••••••• (Tersimpan di vault)"
                        : "eyJhbGciOiJFZERT..."
                    }
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 pr-16 text-xs font-mono text-white outline-none focus:border-cyan-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTursoToken((prev) => !prev)}
                    className="absolute right-1.5 top-1.5 rounded-lg bg-white/5 px-2 py-1 text-[10px] font-bold text-slate-300"
                  >
                    {showTursoToken ? "Tutup" : "Lihat"}
                  </button>
                </div>
              </div>

              {tursoTestStatus ? (
                <div
                  className={`rounded-xl border p-2.5 text-xs font-semibold ${
                    tursoTestStatus.connected
                      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                      : "border-rose-500/20 bg-rose-500/10 text-rose-300"
                  }`}
                >
                  {tursoTestStatus.connected
                    ? `Terhubung ke Turso (Latensi: ${tursoTestStatus.latency_ms ?? 0} ms)`
                    : `Gagal terhubung: ${tursoTestStatus.error_message || "Periksa token/URL"}`}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleTursoSave}
                  disabled={tursoBusy || tursoTesting}
                  className="flex-1 min-h-10 rounded-xl bg-cyan-400 px-3 text-xs font-black text-slate-950 shadow-md active:scale-95 transition disabled:opacity-50"
                >
                  {tursoBusy ? "Menyimpan..." : "Simpan ke Vault"}
                </button>
                <button
                  type="button"
                  onClick={handleTursoTest}
                  disabled={tursoBusy || tursoTesting}
                  className="min-h-10 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-3 text-xs font-bold text-cyan-200 active:scale-95 transition disabled:opacity-50"
                >
                  {tursoTesting ? "Menguji..." : "Uji Koneksi"}
                </button>
                {tursoUrl ? (
                  <button
                    type="button"
                    onClick={handleTursoClear}
                    disabled={tursoBusy || tursoTesting}
                    className="min-h-10 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 text-xs font-bold text-rose-300 active:scale-95 transition disabled:opacity-50"
                  >
                    Reset
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {/* Pusat Sinkronisasi Shortcut */}
        <div className="rounded-3xl border border-sky-500/20 bg-gradient-to-br from-sky-950/30 via-slate-900/80 to-slate-900/90 p-4 backdrop-blur-md">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2.5">
              <div className="grid size-9 place-items-center rounded-xl bg-sky-500/20 text-sky-300">
                <Icon name="sync" className="size-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">
                  Pusat Sinkronisasi Data
                </h3>
                <p className="text-[11px] text-slate-400">
                  Antrean outbox offline, riwayat push & snapshot
                </p>
              </div>
            </div>
            <Link
              href="/sync"
              onClick={() => triggerHaptic("light")}
              className="rounded-xl bg-sky-400 px-3.5 py-1.5 text-xs font-black text-slate-950 shadow-md hover:bg-sky-300 active:scale-95 transition"
            >
              Buka →
            </Link>
          </div>
        </div>

        {/* GPS Geofencing Preferences */}
        <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-4 backdrop-blur-md">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-bold text-white">
                GPS Geofencing Absensi
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Validasi radius lokasi scan terhadap titik koordinat kantor
              </p>
            </div>
            {canManageGeofence ? (
              <button
                type="button"
                onClick={handleToggleGeofence}
                disabled={geofenceLoading}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  geofence.enabled ? "bg-sky-500" : "bg-slate-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block size-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    geofence.enabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            ) : (
              <span className="rounded-full border border-white/10 bg-slate-950 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                Hanya Superadmin
              </span>
            )}
          </div>

          {saveMessage && (
            <div className="rounded-xl border border-sky-500/30 bg-sky-950/40 p-2.5 text-xs text-sky-200 mb-3">
              {saveMessage}
            </div>
          )}

          <div className="rounded-2xl border border-white/5 bg-slate-950/60 p-3 text-xs text-slate-400 space-y-1">
            <div className="flex justify-between">
              <span>Radius Validasi:</span>
              <span className="font-semibold text-white">
                {geofence.radiusMeter} meter
              </span>
            </div>
            <div className="flex justify-between">
              <span>Koordinat Kantor:</span>
              <span className="font-mono text-slate-300">
                {geofence.latitude.toFixed(5)}, {geofence.longitude.toFixed(5)}
              </span>
            </div>
          </div>
        </div>

        {/* Hardware & App Information */}
        <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-4 backdrop-blur-md">
          <h3 className="text-sm font-bold text-white mb-2">
            Informasi Native
          </h3>
          <div className="rounded-2xl border border-white/5 bg-slate-950/60 p-3 text-xs text-slate-400 space-y-1.5">
            <div className="flex justify-between">
              <span>Runtime Core:</span>
              <span className="font-semibold text-sky-300">
                Tauri v2 Mobile
              </span>
            </div>
            <div className="flex justify-between">
              <span>Local Storage:</span>
              <span className="font-semibold text-white">
                Private SQLite rusqlite (WAL)
              </span>
            </div>
            <div className="flex justify-between">
              <span>Cloud Engine:</span>
              <span className="font-semibold text-white">
                Turso LibSQL Sync
              </span>
            </div>
            <div className="flex justify-between">
              <span>Haptic Feedback:</span>
              <span className="text-emerald-400">Aktif (Native Vibration)</span>
            </div>
          </div>
        </div>

        {/* Logout Button */}
        <button
          type="button"
          onClick={handleLogout}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-sm font-black text-rose-300 active:scale-[0.98] transition hover:bg-rose-500/30"
        >
          <Icon name="logout" className="size-4" />
          <span>Keluar dari Akun</span>
        </button>
      </div>
    </MobileAppShell>
  );
}
