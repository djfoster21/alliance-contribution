import { cn } from "@/lib/utils";

/** Attendance pill. Threshold on pct×100: ≥80 good (green), ≥50 watch (amber), <50 risk (red). */
export function AttendanceBadge({ pct, className }: { pct: number; className?: string }) {
  const pctInt = Math.round(pct * 100);
  const tone =
    pctInt >= 80
      ? "bg-good-bg text-good-fg"
      : pctInt >= 50
        ? "bg-watch-bg text-watch-fg"
        : "bg-risk-bg text-risk-fg";
  return (
    <span
      className={cn(
        "num inline-flex items-center rounded-[6px] px-1.5 py-0.5 text-[12px] font-semibold",
        tone,
        className,
      )}
    >
      {pctInt}%
    </span>
  );
}
