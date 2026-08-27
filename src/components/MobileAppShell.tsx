"use client";

import type { ReactNode } from "react";
import { useCallback } from "react";
import {
  SYNC_COMPLETED_EVENT,
  SYNC_FAILED_EVENT,
  syncNow,
} from "@/lib/gateways/sync-status";
import { AutoAlfaRunner } from "./AutoAlfaRunner";
import { AutoSyncRunner } from "./AutoSyncRunner";
import { MobileBottomNav } from "./MobileBottomNav";
import { MobileHeader } from "./MobileHeader";
import { PullToRefresh } from "./PullToRefresh";

/** Durasi minimal indikator terlihat supaya tarikan tidak terasa "tidak melakukan apa-apa". */
const MIN_SPINNER_MS = 550;

interface MobileAppShellProps {
  children: ReactNode;
  contentClassName?: string;
  hideNav?: boolean;
  /**
   * Matikan pull-to-refresh untuk halaman yang gesturnya bentrok
   * (mis. pratinjau kamera scanner).
   */
  disablePullRefresh?: boolean;
}

export function MobileAppShell({
  children,
  contentClassName = "",
  hideNav = false,
  disablePullRefresh = false,
}: MobileAppShellProps) {
  /**
   * Gestur tarik-ke-bawah menggantikan tombol "Refresh" lama di header.
   *
   * `syncNow()` hanya memancarkan `sppg:sync-completed` lewat AutoSyncRunner
   * ketika ada baris yang benar-benar berubah, sedangkan tarikan manual harus
   * selalu memuat ulang layar yang sedang dilihat. Karena itu event-nya
   * dipancarkan di sini tanpa syarat setelah siklus selesai.
   */
  const handleRefresh = useCallback(async () => {
    const startedAt = Date.now();
    try {
      const status = await syncNow();
      window.dispatchEvent(
        new CustomEvent(SYNC_COMPLETED_EVENT, { detail: status }),
      );
    } catch (error) {
      window.dispatchEvent(
        new CustomEvent(SYNC_FAILED_EVENT, {
          detail: {
            message:
              error instanceof Error
                ? error.message
                : "Sinkronisasi gagal tanpa keterangan.",
            partial: false,
          },
        }),
      );
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_SPINNER_MS) {
        await new Promise((resolve) =>
          setTimeout(resolve, MIN_SPINNER_MS - elapsed),
        );
      }
    }
  }, []);

  return (
    <div className="mobile-shell min-h-dvh flex flex-col bg-slate-950 text-slate-100 antialiased selection:bg-sky-500/30 selection:text-sky-200">
      <AutoAlfaRunner />
      <AutoSyncRunner />
      <MobileHeader />
      <PullToRefresh
        onRefresh={handleRefresh}
        disabled={disablePullRefresh}
        className="flex-1 flex flex-col"
        innerClassName="flex-1 flex flex-col"
      >
        <main
          id="main-content"
          className={`flex-1 flex flex-col px-4 pt-4 ${
            hideNav ? "pb-6" : "pb-28"
          } ${contentClassName}`}
        >
          {children}
        </main>
      </PullToRefresh>
      {!hideNav && <MobileBottomNav />}
    </div>
  );
}
