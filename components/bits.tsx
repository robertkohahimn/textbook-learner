import Link from "next/link";

export function Wordmark() {
  return (
    <Link href="/" className="inline-flex items-baseline gap-2 group">
      <span className="font-display text-2xl font-semibold tracking-tight">
        Folio
      </span>
      <span className="hidden sm:inline text-xs text-ink-faint tracking-[0.18em] uppercase group-hover:text-ink-soft transition-colors">
        study any book
      </span>
    </Link>
  );
}

export function ProgressBar({
  value,
  className = "",
}: {
  value: number; // 0..1
  className?: string;
}) {
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`h-1 rounded-full bg-line-soft overflow-hidden ${className}`}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  );
}

export function WorkingDot({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
      <span className="size-1.5 rounded-full bg-accent pulse-dot" />
      {label}
    </span>
  );
}

export function CheckRing({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-flex size-5 items-center justify-center rounded-full border transition-all duration-300 ${
        done
          ? "border-accent bg-accent text-accent-ink"
          : "border-line bg-transparent text-transparent"
      }`}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path
          d="M1.5 5.5L4 8L8.5 2.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
