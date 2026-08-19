interface FeedbackBannerProps {
  type?: "success" | "error" | "warning" | "info";
  message: string;
  className?: string;
  onClose?: () => void;
}

const bannerStyles = {
  success: "border-emerald-500/40 bg-emerald-950/50 text-emerald-200",
  error: "border-rose-500/40 bg-rose-950/50 text-rose-200",
  warning: "border-amber-500/40 bg-amber-950/50 text-amber-200",
  info: "border-sky-500/40 bg-sky-950/50 text-sky-200",
};

export function FeedbackBanner({
  type = "info",
  message,
  className = "",
  onClose,
}: FeedbackBannerProps) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className={`relative flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm font-medium shadow-lg backdrop-blur-md transition-all ${bannerStyles[type]} ${className}`}
    >
      <div className="flex items-center gap-2.5">
        <span className="shrink-0 font-bold">
          {type === "success" && "✓"}
          {type === "error" && "✕"}
          {type === "warning" && "!"}
          {type === "info" && "ℹ"}
        </span>
        <p className="leading-snug">{message}</p>
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup notifikasi"
          className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/10 text-xs font-bold hover:bg-white/20"
        >
          ×
        </button>
      )}
    </div>
  );
}
