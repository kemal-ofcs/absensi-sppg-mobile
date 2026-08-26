import { Suspense } from "react";
import SlipDetailClient from "./SlipDetailClient";

export default function MobileSlipDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-400">
          Memuat...
        </div>
      }
    >
      <SlipDetailClient />
    </Suspense>
  );
}
