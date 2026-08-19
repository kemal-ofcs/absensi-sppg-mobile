"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MobileAppShell } from "@/components/MobileAppShell";
import { Icon } from "@/components/ui/Icon";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import type { GeofenceSettings } from "@/lib/gateways/geofence";
import {
  getGeofenceSettings,
  saveGeofenceSettings,
} from "@/lib/gateways/geofence";
import { useOnlineStatus } from "@/lib/hooks/useOnlineStatus";

export default function SettingsPage() {
  const { user, logout, isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const isOnline = useOnlineStatus();

  const [geofence, setGeofence] = useState<GeofenceSettings>({
    enabled: false,
    latitude: 0,
    longitude: 0,
    radiusMeter: 100,
  });
  const [geofenceLoading, setGeofenceLoading] = useState(true);
  const [saveMessage, setSaveMessage] = useState("");

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
    if (isAuthenticated) {
      void loadGeofence();
    }
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

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
