export function isDesktopRuntime() {
  const runtime = process.env.NEXT_PUBLIC_SPPG_RUNTIME;
  if (runtime === "desktop" || runtime === "mobile") return true;
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>) ||
      "__TAURI__" in (window as unknown as Record<string, unknown>))
  );
}
