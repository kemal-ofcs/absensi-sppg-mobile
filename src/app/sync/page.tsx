"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { MobileAppShell } from "@/components/MobileAppShell";
import { Icon } from "@/components/ui/Icon";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import type { SyncConflict, SyncStatus } from "@/lib/gateways/sync-status";
import {
  clearFailedSync,
  getSyncConflicts,
  getSyncStatus,
  resolveSyncConflicts,
  resolveSyncConflictsLocal,
  retryFailedSync,
  syncNow,
} from "@/lib/gateways/sync-status";

export default function SyncPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [authLoading, isAuthenticated, router]);

  const loadStatus = useCallback(async () => {
    try {
      const data = await getSyncStatus();
      setStatus(data);
      const conf = await getSyncConflicts();
      setConflicts(conf);
    } catch {
      // Ignored silently
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      void loadStatus();
    }
  }, [isAuthenticated, loadStatus]);

  const handleSyncNow = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setMessage("");
    triggerHaptic("light");

    try {
      const newStatus = await syncNow();
      setStatus(newStatus);
      triggerHaptic("success");
      setMessage("Sinkronisasi data berhasil diselesaikan.");
    } catch (err: unknown) {
      triggerHaptic("error");
      setMessage(err instanceof Error ? err.message : "Sinkronisasi gagal.");
    } finally {
      setIsSyncing(false);
      void loadStatus();
    }
  };

  const handleRetry = async () => {
    triggerHaptic("light");
    try {
      await retryFailedSync();
      await handleSyncNow();
    } catch {
      // Handled
    }
  };

  const handleResolveConflicts = async (eventId?: string) => {
    triggerHaptic("light");
    try {
      await resolveSyncConflicts(eventId);
      triggerHaptic("success");
      setMessage(
        eventId
          ? "Konflik diselesaikan (mengikuti master cloud)."
          : "Semua konflik diselesaikan (mengikuti master cloud).",
      );
      await loadStatus();
    } catch (err: unknown) {
      triggerHaptic("error");
      setMessage(
        err instanceof Error ? err.message : "Gagal menyelesaikan konflik.",
      );
    }
  };

  const handleResolveConflictsLocal = async (eventId?: string) => {
    triggerHaptic("light");
    try {
      await resolveSyncConflictsLocal(eventId);
      triggerHaptic("success");
      setMessage(
        eventId
          ? "Data lokal diprioritaskan dan dikirim ke cloud."
          : "Semua data lokal diprioritaskan dan dikirim ke cloud.",
      );
      await loadStatus();
    } catch (err: unknown) {
      triggerHaptic("error");
      setMessage(
        err instanceof Error
          ? err.message
          : "Gagal memprioritaskan data lokal.",
      );
    }
  };

  const handleClearFailed = async () => {
    triggerHaptic("light");
    try {
      await clearFailedSync();
      await loadStatus();
    } catch {
      // Handled
    }
  };

  return (
    <MobileAppShell>
      <div className="flex flex-col gap-4">
        {/* Sync Hero Card */}
        <div className="rounded-3xl border border-white/15 bg-gradient-to-br from-slate-900 via-slate-900/90 to-sky-950/40 p-5 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-sky-400">
                Pusat Sinkronisasi
              </span>
              <h2 className="text-xl font-black tracking-tight text-white mt-0.5">
                Turso LibSQL Outbox
              </h2>
            </div>
            <div className="grid size-12 place-items-center rounded-2xl border border-sky-400/30 bg-sky-500/10 text-sky-300">
              <Icon name="sync" className="size-6 stroke-[2]" />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3.5 text-xs text-slate-300 mb-4 space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500">Client ID:</span>
              <span className="font-mono text-slate-300">
                {status?.clientId ? `${status.clientId.slice(0, 16)}...` : "--"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Revisi Server:</span>
              <span className="font-semibold text-sky-300">
                #{status?.lastRevision ?? 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Terakhir Sinkron:</span>
              <span className="font-medium text-slate-300">
                {status?.lastSyncAt
                  ? new Date(status.lastSyncAt * 1000).toLocaleTimeString(
                      "id-ID",
                      {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      },
                    )
                  : "Belum pernah"}
              </span>
            </div>
          </div>

          {message && (
            <div className="rounded-2xl border border-sky-500/30 bg-sky-950/50 p-3 text-xs text-sky-200 mb-4">
              {message}
            </div>
          )}

          {/* Sync Trigger Button */}
          <button
            type="button"
            onClick={handleSyncNow}
            disabled={isSyncing}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-sky-400 via-sky-500 to-blue-600 text-sm font-black text-slate-950 shadow-xl shadow-sky-950/60 active:scale-[0.98] transition disabled:opacity-50"
          >
            <Icon
              name="sync"
              className={`size-5 ${isSyncing ? "animate-spin" : ""}`}
            />
            <span>
              {isSyncing ? "Menyinkronkan..." : "Sinkronkan Sekarang"}
            </span>
          </button>
        </div>

        {/* Outbox Metrics Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">
              Antrean Outbox
            </span>
            <p className="text-2xl font-black text-amber-400 mt-1">
              {status?.pending ?? 0}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">
              Tersinkronisasi
            </span>
            <p className="text-2xl font-black text-emerald-400 mt-1">
              {status?.synced ?? 0}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">
              Gagal
            </span>
            <p className="text-2xl font-black text-rose-400 mt-1">
              {status?.failed ?? 0}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">
              Konflik Data
            </span>
            <p className="text-2xl font-black text-yellow-400 mt-1">
              {status?.conflict ?? 0}
            </p>
          </div>
        </div>

        {/* Conflict Actions & Review Card */}
        {conflicts.length > 0 && (
          <div className="rounded-3xl border border-amber-400/20 bg-amber-400/5 p-4 space-y-3">
            <div className="flex flex-col gap-2">
              <div>
                <h3 className="text-sm font-black text-amber-200">
                  Konflik Perlu Ditinjau ({conflicts.length})
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Versi data lokal berbeda dengan master cloud Turso.
                </p>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleResolveConflictsLocal()}
                  className="flex-1 rounded-xl bg-sky-400/20 border border-sky-400/30 py-2 px-2 text-[11px] font-bold text-sky-200 active:scale-95 transition"
                >
                  Pakai Semua Lokal
                </button>
                <button
                  type="button"
                  onClick={() => handleResolveConflicts()}
                  className="flex-1 rounded-xl bg-amber-400/20 border border-amber-400/30 py-2 px-2 text-[11px] font-bold text-amber-200 active:scale-95 transition"
                >
                  Ikuti Semua Cloud
                </button>
              </div>
            </div>

            <ul className="space-y-2 text-xs">
              {conflicts.slice(0, 10).map((c) => (
                <li
                  key={c.eventId}
                  className="rounded-2xl border border-amber-400/10 bg-slate-950/70 p-3 space-y-2"
                >
                  <div>
                    <span className="font-bold text-white">
                      {c.domain} · {c.entityKey}
                    </span>
                    <p className="text-amber-200/80 text-[11px] mt-0.5">
                      {c.reason}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleResolveConflictsLocal(c.eventId)}
                      className="flex-1 rounded-lg border border-sky-400/30 bg-sky-400/10 py-1.5 text-[11px] font-bold text-sky-200 active:scale-95 transition"
                    >
                      Gunakan Lokal
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResolveConflicts(c.eventId)}
                      className="flex-1 rounded-lg border border-white/10 bg-white/5 py-1.5 text-[11px] font-bold text-slate-300 active:scale-95 transition"
                    >
                      Ikuti Cloud
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Failed Actions */}
        {(status?.failed ?? 0) > 0 && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleRetry}
              className="flex-1 rounded-2xl bg-amber-500/20 border border-amber-500/30 p-3 text-xs font-bold text-amber-300 active:scale-95 transition"
            >
              Coba Ulang Gagal ({status?.failed})
            </button>
            <button
              type="button"
              onClick={handleClearFailed}
              className="flex-1 rounded-2xl bg-rose-500/20 border border-rose-500/30 p-3 text-xs font-bold text-rose-300 active:scale-95 transition"
            >
              Bersihkan Gagal
            </button>
          </div>
        )}

        {/* Table Records Summary */}
        {status?.tableCounts && typeof status.tableCounts === "object" && (
          <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
              Data Tersimpan di SQLite Lokal
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {Object.entries(status.tableCounts as Record<string, number>).map(
                ([tbl, cnt]) => (
                  <div
                    key={tbl}
                    className="flex justify-between rounded-xl bg-slate-950/60 p-2 border border-white/5"
                  >
                    <span className="text-slate-400 truncate max-w-[100px]">
                      {tbl}
                    </span>
                    <span className="font-bold text-white">{cnt}</span>
                  </div>
                ),
              )}
            </div>
          </div>
        )}
      </div>
    </MobileAppShell>
  );
}
