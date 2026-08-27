"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { triggerHaptic } from "@/lib/client/haptics";

/** Jarak tarikan (px) yang harus dilewati sebelum refresh benar-benar jalan. */
const THRESHOLD_PX = 72;
/** Batas atas indikator supaya tarikan panjang tidak mendorong layout. */
const MAX_PULL_PX = 110;
/** Peredam gerakan: 1px jari kira-kira 0.5px indikator, terasa seperti native. */
const RESISTANCE = 0.5;
/** Toleransi gerakan menyamping; di atas ini dianggap swipe horizontal. */
const HORIZONTAL_SLOP_PX = 24;

type Phase = "idle" | "pulling" | "armed" | "refreshing";

interface PullToRefreshProps {
  children: ReactNode;
  /** Dipanggil saat tarikan dilepas melewati ambang. Menangani error-nya sendiri. */
  onRefresh: () => Promise<void>;
  /** Matikan gestur (mis. saat kamera scanner aktif). */
  disabled?: boolean;
  /** Kelas untuk kontainer terluar (posisinya relative). */
  className?: string;
  /** Kelas untuk pembungkus konten yang ikut bergeser saat ditarik. */
  innerClassName?: string;
}

/**
 * True bila ada kontainer scroll di jalur sentuhan yang belum berada di paling atas.
 * Tarikan hanya boleh dimulai ketika seluruh jalur itu sudah mentok ke atas.
 */
function isAnyScrollerScrolled(start: EventTarget | null): boolean {
  let node = start instanceof Element ? start : null;
  while (node && node !== document.body && node !== document.documentElement) {
    const overflowY = window.getComputedStyle(node).overflowY;
    const scrollable =
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight;
    if (scrollable && node.scrollTop > 0) return true;
    node = node.parentElement;
  }
  return (document.scrollingElement?.scrollTop ?? window.scrollY) > 0;
}

/**
 * Pembungkus pull-to-refresh untuk seluruh halaman Mobile.
 *
 * Menggantikan tombol "Refresh" manual: pengguna cukup menggeser layar ke bawah
 * saat sudah berada di paling atas, lalu melepasnya. Gestur diabaikan bila
 * sentuhan berasal dari dalam modal (role="dialog") atau dari elemen yang
 * menolak lewat atribut data-no-pull-refresh.
 */
export function PullToRefresh({
  children,
  onRefresh,
  disabled = false,
  className = "",
  innerClassName = "",
}: PullToRefreshProps) {
  const [distance, setDistance] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const startYRef = useRef(0);
  const startXRef = useRef(0);
  const trackingRef = useRef(false);
  const armedRef = useRef(false);
  const distanceRef = useRef(0);
  const phaseRef = useRef<Phase>("idle");
  const unmountedRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);

  onRefreshRef.current = onRefresh;
  phaseRef.current = phase;

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const runRefresh = useCallback(async () => {
    setPhase("refreshing");
    setDistance(THRESHOLD_PX);
    distanceRef.current = THRESHOLD_PX;
    triggerHaptic("success");
    try {
      await onRefreshRef.current();
    } catch (error) {
      console.warn("Pull-to-refresh gagal:", error);
    } finally {
      distanceRef.current = 0;
      if (!unmountedRef.current) {
        setPhase("idle");
        setDistance(0);
      }
    }
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || disabled) return;

    const cancelGesture = () => {
      trackingRef.current = false;
      armedRef.current = false;
      distanceRef.current = 0;
      setDistance(0);
      setPhase("idle");
    };

    const onTouchStart = (event: TouchEvent) => {
      if (phaseRef.current === "refreshing") return;
      if (event.touches.length !== 1) return;

      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('[role="dialog"], [data-no-pull-refresh]')
      ) {
        return;
      }
      if (isAnyScrollerScrolled(target)) return;

      startYRef.current = event.touches[0].clientY;
      startXRef.current = event.touches[0].clientX;
      trackingRef.current = true;
      armedRef.current = false;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!trackingRef.current || phaseRef.current === "refreshing") return;

      const touch = event.touches[0];
      const deltaY = touch.clientY - startYRef.current;
      const deltaX = Math.abs(touch.clientX - startXRef.current);

      // Gerakan ke atas atau menyamping: kembalikan ke scroll biasa.
      if (deltaY <= 0 || deltaX > HORIZONTAL_SLOP_PX) {
        cancelGesture();
        return;
      }

      // Konten sempat ter-scroll di tengah gestur (momentum): batalkan.
      if ((document.scrollingElement?.scrollTop ?? window.scrollY) > 0) {
        cancelGesture();
        return;
      }

      const pulled = Math.min(MAX_PULL_PX, deltaY * RESISTANCE);
      distanceRef.current = pulled;
      setDistance(pulled);

      const nowArmed = pulled >= THRESHOLD_PX;
      if (nowArmed !== armedRef.current) {
        armedRef.current = nowArmed;
        if (nowArmed) triggerHaptic("light");
      }
      setPhase(nowArmed ? "armed" : "pulling");

      // Cegah overscroll bawaan WebView supaya indikator tidak berkedip.
      if (event.cancelable) event.preventDefault();
    };

    const onTouchEnd = () => {
      if (!trackingRef.current || phaseRef.current === "refreshing") return;
      const shouldRefresh = distanceRef.current >= THRESHOLD_PX;
      trackingRef.current = false;
      armedRef.current = false;
      if (shouldRefresh) {
        void runRefresh();
      } else {
        distanceRef.current = 0;
        setDistance(0);
        setPhase("idle");
      }
    };

    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    node.addEventListener("touchend", onTouchEnd, { passive: true });
    node.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [disabled, runRefresh]);

  const isRefreshing = phase === "refreshing";
  const isActive = distance > 0 || isRefreshing;
  const progress = Math.min(1, distance / THRESHOLD_PX);

  const label = isRefreshing
    ? "Menyinkronkan..."
    : phase === "armed"
      ? "Lepas untuk sinkron"
      : "Tarik untuk sinkron";

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Indikator tarikan: mengambang, tidak menggeser layout halaman. */}
      <div
        aria-hidden={!isActive}
        className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center"
        style={{
          transform: `translateY(${Math.max(0, distance - 8)}px)`,
          opacity: isActive ? 1 : 0,
          transition:
            distance === 0
              ? "transform 220ms ease-out, opacity 220ms ease-out"
              : "opacity 120ms ease-out",
        }}
      >
        <div className="mt-1 flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/95 px-3 py-1.5 shadow-lg shadow-black/40 backdrop-blur">
          <span
            className="inline-flex"
            style={
              isRefreshing
                ? undefined
                : { transform: `rotate(${Math.round(progress * 270)}deg)` }
            }
          >
            <Icon
              name="sync"
              className={`size-3.5 text-sky-400 ${
                isRefreshing ? "animate-spin" : ""
              }`}
            />
          </span>
          <span className="text-[11px] font-semibold text-slate-300">
            {label}
          </span>
        </div>
      </div>

      {/*
        Konten ikut turun sedikit supaya tarikan terasa fisik.

        PENTING: saat diam, `transform` harus benar-benar `none` — bukan
        `translateY(0px)`. Elemen dengan transform apa pun menjadi containing
        block bagi keturunannya yang `position: fixed`, sehingga semua overlay
        modal di dalam halaman akan dipusatkan ke konten (dan ikut terpotong)
        alih-alih ke viewport.
      */}
      <div
        className={innerClassName}
        style={{
          transform: distance === 0 ? undefined : `translateY(${distance}px)`,
          transition: distance === 0 ? "transform 220ms ease-out" : "none",
        }}
      >
        {children}
      </div>

      <output className="sr-only" aria-live="polite">
        {isRefreshing ? "Menyinkronkan data" : ""}
      </output>
    </div>
  );
}
