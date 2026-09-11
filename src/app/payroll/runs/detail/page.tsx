import { Suspense } from "react";
import RunDetailClient from "./RunDetailClient";

export default function MobilePayrollRunDetailPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-slate-950" />}>
      <RunDetailClient />
    </Suspense>
  );
}
