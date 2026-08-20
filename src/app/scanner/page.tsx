"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { MobileAppShell } from "@/components/MobileAppShell";
import { ScannerView } from "@/components/ScannerView";
import { Icon } from "@/components/ui/Icon";
import { canAccessArea } from "@/lib/auth/access";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";

export default function ScannerPage() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const canUseScanner = canAccessArea(user, "scanner");

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  if (!isLoading && isAuthenticated && !canUseScanner) {
    return (
      <MobileAppShell>
        <div className="flex min-h-[65vh] flex-col items-center justify-center p-6 text-center">
          <div className="mb-4 grid size-16 place-items-center rounded-3xl border border-rose-500/30 bg-rose-500/10 text-rose-400 shadow-inner">
            <Icon name="scanner" className="size-8 stroke-[2.2]" />
          </div>
          <h2 className="text-lg font-black text-white">
            Akses Scanner Ditolak
          </h2>
          <p className="mt-2 max-w-xs text-xs leading-relaxed text-slate-400">
            Akun operator Anda ({user?.role || "Operator"}) tidak memiliki izin
            untuk menggunakan fitur QR Scanner absensi.
          </p>
          <button
            type="button"
            onClick={() => {
              triggerHaptic("light");
              router.replace("/dashboard");
            }}
            className="mt-6 rounded-2xl bg-sky-400 px-6 py-2.5 text-xs font-black text-slate-950 shadow-lg transition active:scale-95 hover:bg-sky-300"
          >
            Kembali ke Beranda
          </button>
        </div>
      </MobileAppShell>
    );
  }

  return (
    <MobileAppShell>
      <div className="flex flex-col gap-2">
        <ScannerView />
      </div>
    </MobileAppShell>
  );
}
