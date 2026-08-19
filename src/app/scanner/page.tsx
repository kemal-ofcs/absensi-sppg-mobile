"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { MobileAppShell } from "@/components/MobileAppShell";
import { ScannerView } from "@/components/ScannerView";
import { useAuth } from "@/lib/context/AuthContext";

export default function ScannerPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  return (
    <MobileAppShell>
      <div className="flex flex-col gap-2">
        <ScannerView />
      </div>
    </MobileAppShell>
  );
}
