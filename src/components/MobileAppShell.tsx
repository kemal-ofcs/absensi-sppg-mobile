"use client";

import type { ReactNode } from "react";
import { AutoAlfaRunner } from "./AutoAlfaRunner";
import { MobileBottomNav } from "./MobileBottomNav";
import { MobileHeader } from "./MobileHeader";

interface MobileAppShellProps {
  children: ReactNode;
  contentClassName?: string;
  hideNav?: boolean;
}

export function MobileAppShell({
  children,
  contentClassName = "",
  hideNav = false,
}: MobileAppShellProps) {
  return (
    <div className="mobile-shell min-h-dvh flex flex-col bg-slate-950 text-slate-100 antialiased selection:bg-sky-500/30 selection:text-sky-200">
      <AutoAlfaRunner />
      <MobileHeader />
      <main
        id="main-content"
        className={`flex-1 flex flex-col px-4 pt-4 ${
          hideNav ? "pb-6" : "pb-28"
        } ${contentClassName}`}
      >
        {children}
      </main>
      {!hideNav && <MobileBottomNav />}
    </div>
  );
}
