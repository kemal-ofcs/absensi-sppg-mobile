"use client";

import Link from "next/link";
import { useState } from "react";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { Icon } from "@/components/ui/Icon";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";
import { useOnlineStatus } from "@/lib/hooks/useOnlineStatus";
import { invokeDesktop } from "@/lib/runtime/desktop-commands";

export function MobileHeader() {
  const { user } = useAuth();
  const isOnline = useOnlineStatus();
  const [isSyncing, setIsSyncing] = useState(false);

  const handleQuickSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    triggerHaptic("light");
    try {
      await invokeDesktop("desktop_sync_now");
      triggerHaptic("success");
    } catch {
      triggerHaptic("warning");
    } finally {
      setIsSyncing(false);
    }
  };

  if (!user) return null;

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/90 pt-[env(safe-area-inset-top)] backdrop-blur-xl shadow-lg shadow-black/40">
      <div className="flex h-14 items-center justify-between px-4">
        {/* Left: Brand Logo & Title */}
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 active:scale-95 transition-transform"
        >
          <BrandLogo size={32} />
          <div className="flex flex-col">
            <span className="text-sm font-black tracking-tight text-white leading-tight">
              SPPG Mobile
            </span>
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-400">
              <span
                className={`size-2 rounded-full ${
                  isOnline
                    ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
                    : "bg-amber-400"
                }`}
              />
              <span>{isOnline ? "Online" : "Offline Mode"}</span>
            </div>
          </div>
        </Link>

        {/* Right: Operator pill & Sync icon button */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleQuickSync}
            disabled={isSyncing}
            aria-label="Sinkronisasi data"
            className="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/10 active:scale-95 transition"
          >
            <Icon
              name="sync"
              className={`size-4 ${isSyncing ? "animate-spin text-sky-400" : ""}`}
            />
          </button>
          <Link
            href="/settings"
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-2.5 py-1.5 active:scale-95 transition"
          >
            <div className="grid size-6 place-items-center rounded-lg bg-sky-500/20 text-sky-300 text-xs font-bold">
              {user.nama_operator?.charAt(0)?.toUpperCase() || "U"}
            </div>
            <span className="max-w-[70px] truncate text-xs font-semibold text-slate-200">
              {user.nama_operator}
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}
