"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";
import { canAccessArea } from "@/lib/auth/access";
import { triggerHaptic } from "@/lib/client/haptics";
import { useAuth } from "@/lib/context/AuthContext";

interface NavItem {
  href: string;
  icon: IconName;
  label: string;
  isElevated?: boolean;
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const { user } = useAuth();

  const isOperational = canAccessArea(user, "operational");

  const navItems: NavItem[] = isOperational
    ? [
        { href: "/dashboard", icon: "dashboard", label: "Beranda" },
        { href: "/history", icon: "clock", label: "Riwayat" },
        {
          href: "/scanner",
          icon: "scanner",
          label: "Scanner",
          isElevated: true,
        },
        { href: "/operational", icon: "tools", label: "Operasional" },
        { href: "/settings", icon: "settings", label: "Akun" },
      ]
    : [
        { href: "/dashboard", icon: "dashboard", label: "Beranda" },
        { href: "/history", icon: "clock", label: "Riwayat" },
        {
          href: "/scanner",
          icon: "scanner",
          label: "Scanner",
          isElevated: true,
        },
        { href: "/sync", icon: "sync", label: "Sync" },
        { href: "/settings", icon: "settings", label: "Akun" },
      ];

  return (
    <nav
      aria-label="Navigasi Bawah Mobile"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-slate-950/95 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur-2xl shadow-[0_-10px_30px_rgba(0,0,0,0.6)]"
    >
      <div className="mx-auto flex w-full max-w-lg items-center justify-around px-2">
        {navItems.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard" || pathname === "/"
              : pathname.startsWith(item.href);

          if (item.isElevated) {
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => triggerHaptic("success")}
                aria-label="Buka Scanner QR"
                className="group relative -top-4 flex flex-col items-center"
              >
                <div
                  className={`grid size-14 place-items-center rounded-2xl shadow-xl transition-all active:scale-90 ${
                    isActive
                      ? "bg-gradient-to-tr from-sky-400 via-sky-500 to-blue-600 text-slate-950 shadow-sky-500/40 ring-4 ring-slate-950 ring-offset-2 ring-offset-sky-500/30"
                      : "bg-gradient-to-tr from-sky-500 to-blue-700 text-white shadow-sky-950/60 ring-4 ring-slate-950 hover:brightness-110"
                  }`}
                >
                  <Icon name="scanner" className="size-7 stroke-[2.2]" />
                </div>
                <span
                  className={`mt-1 text-[11px] font-black tracking-tight transition-colors ${
                    isActive ? "text-sky-300" : "text-slate-400"
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => triggerHaptic("light")}
              className={`flex min-h-12 min-w-12 flex-1 flex-col items-center justify-center gap-1 rounded-2xl py-1 text-center transition-all active:scale-95 ${
                isActive
                  ? "text-sky-300 font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <div
                className={`grid size-8 place-items-center rounded-xl transition-colors ${
                  isActive ? "bg-sky-400/15" : "bg-transparent"
                }`}
              >
                <Icon name={item.icon} className="size-5" />
              </div>
              <span className="text-[10px] font-semibold leading-none truncate max-w-[64px]">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
