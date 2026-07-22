import { cn } from "@/lib/utils";
import { rankTone } from "@/lib/alliance-rank";

/**
 * The R1–R5 alliance-rank pill. Renders NOTHING when the member has no recorded rank — an absent
 * rank is unknown, not "R0", and a dash would read as a real value in a column of badges.
 *
 * `title` spells the term out because on the ranking boards this badge sits next to the score rank,
 * and the two must never be confused (spec 2026-07-27 §73).
 */
export function AllianceRankBadge({ rank, className }: { rank: string | null; className?: string }) {
  const tone = rankTone(rank);
  if (!tone) return null;
  return (
    <span
      title={`Alliance rank ${rank}`}
      className={cn(
        "num inline-flex items-center rounded-[6px] px-1.5 py-0.5 text-[11px] font-semibold",
        tone,
        className,
      )}
    >
      {rank}
    </span>
  );
}
