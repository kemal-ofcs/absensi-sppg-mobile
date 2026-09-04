"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { BRANDING } from "@/lib/constants/branding";
import { useAuth } from "@/lib/context/AuthContext";

export default function RootPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      if (isAuthenticated) {
        router.replace("/dashboard");
      } else {
        router.replace("/login");
      }
    }
  }, [isAuthenticated, isLoading, router]);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-slate-950">
      <div className="flex flex-col items-center gap-3">
        <div className="size-10 rounded-full border-3 border-sky-400 border-t-transparent animate-spin" />
        <span className="text-xs font-semibold text-slate-400">
          Memuat {BRANDING.appDisplayName}...
        </span>
      </div>
    </div>
  );
}
