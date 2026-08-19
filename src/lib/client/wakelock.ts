"use client";

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: string, listener: () => void): void;
}

/**
 * Requests screen keep-alive via Screen Wake Lock API to prevent the phone display
 * from sleeping during active QR scanning sessions.
 * Returns an unmount / release cleanup function.
 */
export async function requestScreenWakeLock(): Promise<() => void> {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return () => undefined;
  }

  const nav = navigator as unknown as {
    wakeLock?: {
      request(type: "screen"): Promise<WakeLockSentinelLike>;
    };
  };
  if (!nav.wakeLock?.request) {
    return () => undefined;
  }

  let sentinel: WakeLockSentinelLike | null = null;
  let isCancelled = false;

  const acquire = async () => {
    try {
      if (document.visibilityState === "visible" && !isCancelled) {
        const lock = await nav.wakeLock?.request("screen");
        if (lock) {
          sentinel = lock;
        }
      }
    } catch {
      sentinel = null;
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      void acquire();
    }
  };

  await acquire();
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    isCancelled = true;
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    if (sentinel && !sentinel.released) {
      void sentinel.release().catch(() => undefined);
      sentinel = null;
    }
  };
}
