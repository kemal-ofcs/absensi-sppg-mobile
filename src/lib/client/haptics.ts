"use client";

export type HapticFeedbackType = "success" | "warning" | "error" | "light";

/**
 * Triggers native haptic vibration feedback with standard tactile duration patterns.
 */
export function triggerHaptic(type: HapticFeedbackType = "light"): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  if (!("vibrate" in navigator)) {
    return false;
  }

  try {
    switch (type) {
      case "light":
        return navigator.vibrate(25);
      case "success":
        return navigator.vibrate(50);
      case "warning":
        return navigator.vibrate([60, 40, 60]);
      case "error":
        return navigator.vibrate([100, 50, 100, 50, 120]);
      default:
        return navigator.vibrate(30);
    }
  } catch {
    return false;
  }
}
