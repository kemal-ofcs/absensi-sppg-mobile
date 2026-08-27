"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MobileAppShell } from "@/components/MobileAppShell";
import { Icon } from "@/components/ui/Icon";
import { canAccessArea, hasPermission } from "@/lib/auth/access";
import {
  calculateDistanceMeters,
  getCurrentCoordinates,
} from "@/lib/client/geolocation";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import {
  type GeofenceSettings,
  getGeofenceSettings,
  saveGeofenceSettings,
} from "@/lib/gateways/geofence";
import {
  clearTursoConfig,
  getDatabaseConfig,
  saveTursoConfig,
  type TursoConnectionStatus,
  testTursoConnection,
} from "@/lib/gateways/turso-config";
import { useOnlineStatus } from "@/lib/hooks/useOnlineStatus";
import {
  DATABASE_PROVIDER_OPTIONS,
  type DatabaseProvider,
  describeProvider,
  reviewDatabaseEndpoint,
} from "@/lib/validations/database-endpoint";
import { validateGeofenceSettings } from "@/lib/validations/geofence";

export default function SettingsPage() {
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const router = useRouter();
  const isOnline = useOnlineStatus();
  const canOperational = canAccessArea(user, "operational");
  const canShift = canAccessArea(user, "shift");
  const canPayroll = canAccessArea(user, "payroll");
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
  const [tursoProvider, setTursoProvider] = useState<DatabaseProvider>("turso");
  const [tursoAllowInsecure, setTursoAllowInsecure] = useState(false);
  const [tursoTokenSaved, setTursoTokenSaved] = useState(false);
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
      // Provider ikut dimuat: tanpa itu perangkat yang terhubung ke server LAN
      // selalu tampil dalam mode Turso dan penyimpanan berikutnya menolak
      // alamat LAN-nya sendiri.
      getDatabaseConfig()
        .then((config) => {
          if (cancelled || !config.configured) return;
          setTursoUrl(config.databaseUrl);
          setTursoProvider(config.provider);
          setTursoAllowInsecure(config.allowInsecureTransport);
          setTursoTokenSaved(config.authTokenSaved);
        })
        .catch(() => undefined);
    }

    const onSyncCompleted = () => {
      if (isAuthenticated && canManageGeofence) {
        void loadGeofence();
      }
    };
    window.addEventListener("sppg:sync-completed", onSyncCompleted);

    return () => {
      cancelled = true;
      window.removeEventListener("sppg:sync-completed", onSyncCompleted);
    };
  }, [isAuthenticated, canManageGeofence, user?.isSuperadmin]);

  const handleLogout = async () => {
    triggerHaptic("warning");
    if (confirm("Apakah Anda yakin ingin keluar dari akun operator ini?")) {
      await logout();
      router.replace("/login");
    }
  };

  const [currentDeviceCoords, setCurrentDeviceCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [geofenceBusy, setGeofenceBusy] = useState(false);

  const handleUseCurrentLocation = async () => {
    setGeofenceBusy(true);
    triggerHaptic("light");
    const coordinates = await getCurrentCoordinates();
    setGeofenceBusy(false);
    if (!coordinates) {
      triggerHaptic("error");
      setSaveMessage(
        "Lokasi GPS tidak dapat dideteksi. Pastikan GPS/Location HP aktif dan izin lokasi diizinkan.",
      );
      setTimeout(() => setSaveMessage(""), 4000);
      return;
    }
    setCurrentDeviceCoords({
      lat: coordinates.lat,
      lng: coordinates.lng,
    });
    setGeofence((curr) => ({
      ...curr,
      latitude: Number(coordinates.lat.toFixed(7)),
      longitude: Number(coordinates.lng.toFixed(7)),
    }));
    triggerHaptic("success");
    setSaveMessage("Koordinat GPS HP berhasil dimasukkan ke form.");
    setTimeout(() => setSaveMessage(""), 3000);
  };

  const handleSaveGeofence = async () => {
    const errors = validateGeofenceSettings(geofence);
    const firstError = Object.values(errors)[0];
    if (firstError) {
      triggerHaptic("error");
      setSaveMessage(firstError);
      setTimeout(() => setSaveMessage(""), 3000);
      return;
    }
    setGeofenceBusy(true);
    triggerHaptic("light");
    try {
      const saved = await saveGeofenceSettings(geofence);
      setGeofence(saved);
      triggerHaptic("success");
      setSaveMessage(
        "Pengaturan Geofencing berhasil disimpan dan disinkronkan.",
      );
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (error) {
      triggerHaptic("error");
      setSaveMessage(
        error instanceof Error ? error.message : "Gagal menyimpan geofencing.",
      );
      setTimeout(() => setSaveMessage(""), 3000);
    } finally {
      setGeofenceBusy(false);
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

  // Cermin sisi klien dari `normalize_database_url` di Rust. Backend tetap
  // penjaga sebenarnya; ini hanya supaya formulir bisa menjelaskan lebih awal.
  const tursoEndpoint = reviewDatabaseEndpoint(
    tursoUrl,
    tursoProvider,
    tursoAllowInsecure,
  );
  const tursoProviderInfo = describeProvider(tursoProvider);

  const handleTursoSave = async () => {
    // Tahan input yang jelas salah di sini supaya alasannya tampil di dekat
    // field, bukan sebagai kegagalan IPC generik setelah penyimpanan.
    if (!tursoEndpoint.valid) {
      setSaveMessage(
        tursoEndpoint.issue?.message ?? "URL database tidak dapat dipakai.",
      );
      setTimeout(() => setSaveMessage(""), 4000);
      return;
    }
    if (tursoEndpoint.tokenRequired && !tursoToken.trim() && !tursoTokenSaved) {
      setSaveMessage("Auth Token wajib diisi untuk alamat database ini.");
      setTimeout(() => setSaveMessage(""), 4000);
      return;
    }
    setTursoBusy(true);
    triggerHaptic("light");
    try {
      await saveTursoConfig(tursoUrl.trim(), tursoToken.trim(), {
        provider: tursoProvider,
        allowInsecureTransport: tursoAllowInsecure,
      });
      if (tursoToken.trim().length > 0) setTursoTokenSaved(true);
      triggerHaptic("success");
      setSaveMessage(
        `Konfigurasi ${describeProvider(tursoProvider).label} berhasil disimpan ke Vault!`,
      );
      const status = await testTursoConnection(
        tursoUrl.trim(),
        tursoToken.trim(),
        {
          provider: tursoProvider,
          allowInsecureTransport: tursoAllowInsecure,
        },
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
        {
          provider: tursoProvider,
          allowInsecureTransport: tursoAllowInsecure,
        },
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
      setTursoProvider("turso");
      setTursoAllowInsecure(false);
      setTursoTokenSaved(false);
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

        {/* Slip & Estimasi Gaji Section (Hanya jika memiliki izin payroll) */}
        {canPayroll ? (
          <div className="rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/30 via-slate-900/80 to-slate-900/90 p-4 backdrop-blur-md">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="grid size-9 place-items-center rounded-xl bg-emerald-500/20 text-emerald-300">
                  <Icon name="document" className="size-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Slip &amp; Estimasi Gaji
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Kalkulasi upah harian &amp; arsip pembayaran digital
                  </p>
                </div>
              </div>
              <Link
                href="/payroll"
                onClick={() => triggerHaptic("light")}
                className="rounded-xl bg-emerald-500 px-3.5 py-1.5 text-xs font-black text-slate-950 shadow-md hover:bg-emerald-400 active:scale-95 transition whitespace-nowrap"
              >
                Buka &rarr;
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
                    Database (LibSQL)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Turso Cloud atau server database Anda sendiri
                  </p>
                </div>
              </div>
              <span className="rounded-md bg-cyan-400/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-cyan-300 border border-cyan-400/20">
                Superadmin
              </span>
            </div>

            <div className="space-y-3 pt-1">
              <fieldset className="space-y-2">
                <legend className="block text-[11px] font-bold text-slate-300">
                  Jenis Database
                </legend>
                {DATABASE_PROVIDER_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`grid min-w-0 cursor-pointer gap-1 rounded-xl border p-2.5 text-[11px] leading-4 transition ${
                      tursoProvider === option.value
                        ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-100"
                        : "border-white/10 bg-slate-950/60 text-slate-400"
                    }`}
                  >
                    <span className="flex items-center gap-2 font-black">
                      <input
                        type="radio"
                        name="mobile-database-provider"
                        value={option.value}
                        checked={tursoProvider === option.value}
                        onChange={() => {
                          setTursoProvider(option.value);
                          setTursoAllowInsecure(false);
                          setTursoTestStatus(null);
                        }}
                        className="size-4 shrink-0 accent-cyan-400"
                      />
                      <span className="min-w-0 truncate">{option.label}</span>
                    </span>
                    <span className="font-normal opacity-80">
                      {option.description}
                    </span>
                  </label>
                ))}
              </fieldset>

              <div>
                <label
                  htmlFor="turso-url-input"
                  className="block text-[11px] font-bold text-slate-300 mb-1"
                >
                  {tursoProvider === "turso"
                    ? "URL Database Cloud"
                    : "Alamat Server Database"}
                </label>
                <input
                  id="turso-url-input"
                  type="text"
                  inputMode="url"
                  value={tursoUrl}
                  onChange={(e) => {
                    setTursoUrl(e.target.value);
                    setTursoTestStatus(null);
                  }}
                  placeholder={tursoProviderInfo.urlPlaceholder}
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs font-mono text-white outline-none focus:border-cyan-400"
                />
                {tursoUrl.trim().length > 0 && tursoEndpoint.issue ? (
                  <p className="mt-1 text-[11px] leading-4 text-amber-300">
                    {tursoEndpoint.issue.message}
                  </p>
                ) : null}
              </div>

              {tursoProvider === "self_hosted" &&
              (tursoEndpoint.issue?.code === "INSECURE_PUBLIC" ||
                tursoAllowInsecure) ? (
                <label className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-[11px] font-bold leading-4 text-rose-200">
                  <input
                    type="checkbox"
                    checked={tursoAllowInsecure}
                    onChange={(e) => {
                      setTursoAllowInsecure(e.target.checked);
                      setTursoTestStatus(null);
                    }}
                    className="mt-0.5 size-4 shrink-0 accent-rose-400"
                  />
                  <span>
                    Izinkan koneksi tanpa enkripsi ke alamat publik. Auth Token
                    dan data absensi dikirim sebagai teks biasa. Pakai hanya
                    pada jaringan yang benar-benar Anda percayai.
                  </span>
                </label>
              ) : null}

              <div>
                <label
                  htmlFor="turso-token-input"
                  className="block text-[11px] font-bold text-slate-300 mb-1"
                >
                  {tursoEndpoint.tokenRequired
                    ? "Auth Token Database"
                    : "Auth Token Database (opsional)"}
                </label>
                <div className="relative">
                  <input
                    id="turso-token-input"
                    type={showTursoToken ? "text" : "password"}
                    value={tursoToken}
                    onChange={(e) => setTursoToken(e.target.value)}
                    placeholder={
                      tursoTokenSaved
                        ? "•••••••••••••••• (Tersimpan di vault)"
                        : tursoProviderInfo.tokenPlaceholder
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
                    ? `Terhubung ke ${tursoProviderInfo.label} (Latensi: ${tursoTestStatus.latency_ms ?? 0} ms)`
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

          {canManageGeofence ? (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs text-slate-300">
                  <span className="font-semibold">Latitude</span>
                  <input
                    type="number"
                    step="any"
                    min={-90}
                    max={90}
                    value={geofence.latitude}
                    onChange={(e) =>
                      setGeofence((c) => ({
                        ...c,
                        latitude: Number(e.target.value),
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-xs text-white outline-none focus:border-sky-400"
                  />
                </label>
                <label className="space-y-1 text-xs text-slate-300">
                  <span className="font-semibold">Longitude</span>
                  <input
                    type="number"
                    step="any"
                    min={-180}
                    max={180}
                    value={geofence.longitude}
                    onChange={(e) =>
                      setGeofence((c) => ({
                        ...c,
                        longitude: Number(e.target.value),
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-xs text-white outline-none focus:border-sky-400"
                  />
                </label>
              </div>

              <div className="space-y-1.5 text-xs text-slate-300">
                <div className="flex justify-between items-center">
                  <span className="font-semibold">Radius Kantor (meter)</span>
                  <span className="font-mono font-bold text-sky-400">
                    {geofence.radiusMeter}m
                  </span>
                </div>
                <input
                  type="number"
                  min={10}
                  max={10000}
                  value={geofence.radiusMeter}
                  onChange={(e) =>
                    setGeofence((c) => ({
                      ...c,
                      radiusMeter: Number(e.target.value),
                    }))
                  }
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 font-mono text-xs text-white outline-none focus:border-sky-400"
                />
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {[25, 50, 100, 250, 500].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        triggerHaptic("light");
                        setGeofence((c) => ({ ...c, radiusMeter: preset }));
                      }}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all ${
                        geofence.radiusMeter === preset
                          ? "bg-sky-400 text-slate-950 shadow-sm"
                          : "border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
                      }`}
                    >
                      {preset}m
                    </button>
                  ))}
                </div>
              </div>

              {currentDeviceCoords ? (
                <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-3 text-xs space-y-1">
                  <div className="flex justify-between text-slate-400">
                    <span>GPS HP Anda:</span>
                    <span className="font-mono text-sky-300">
                      {currentDeviceCoords.lat.toFixed(5)},{" "}
                      {currentDeviceCoords.lng.toFixed(5)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Jarak ke Titik Kantor:</span>
                    <span className="font-mono font-bold text-white">
                      {calculateDistanceMeters(
                        currentDeviceCoords.lat,
                        currentDeviceCoords.lng,
                        geofence.latitude,
                        geofence.longitude,
                      )}{" "}
                      meter
                    </span>
                  </div>
                  <div className="pt-1 flex justify-end">
                    <span
                      className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold ${
                        calculateDistanceMeters(
                          currentDeviceCoords.lat,
                          currentDeviceCoords.lng,
                          geofence.latitude,
                          geofence.longitude,
                        ) <= geofence.radiusMeter
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      }`}
                    >
                      {calculateDistanceMeters(
                        currentDeviceCoords.lat,
                        currentDeviceCoords.lng,
                        geofence.latitude,
                        geofence.longitude,
                      ) <= geofence.radiusMeter
                        ? "Di Dalam Radius Kantor"
                        : "Di Luar Radius Kantor"}
                    </span>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  disabled={geofenceBusy}
                  onClick={handleUseCurrentLocation}
                  className="w-full rounded-xl border border-white/10 bg-white/[0.05] py-2.5 text-xs font-bold text-slate-200 hover:bg-white/10 active:scale-95 transition disabled:opacity-50"
                >
                  Ambil Lokasi GPS HP Ini
                </button>
                <button
                  type="button"
                  disabled={geofenceBusy}
                  onClick={handleSaveGeofence}
                  className="w-full rounded-xl bg-sky-400 py-2.5 text-xs font-black text-slate-950 shadow-md hover:bg-sky-300 active:scale-95 transition disabled:opacity-50"
                >
                  {geofenceBusy
                    ? "Menyimpan..."
                    : "Simpan Pengaturan Geofencing"}
                </button>
              </div>
            </div>
          ) : (
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
                  {geofence.latitude.toFixed(5)},{" "}
                  {geofence.longitude.toFixed(5)}
                </span>
              </div>
            </div>
          )}
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
