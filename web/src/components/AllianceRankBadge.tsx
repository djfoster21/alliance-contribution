import { cn } from "@/lib/utils";
import { rankMismatch, rankTone } from "@/lib/alliance-rank";

/**
 * The R1–R5 alliance-rank pill. Renders NOTHING when the member has no recorded rank — an absent
 * rank is unknown, not "R0", and a dash would read as a real value in a column of badges.
 *
 * `title` spells the term out because on the ranking boards this badge sits next to the score rank,
 * and the two must never be confused (spec 2026-07-27 §73).
 *
 * `expected` is the section's should-be rank on a banded board (2026-08-03 spec): when the member's
 * rank differs, the badge carries a warning ring so mis-ranked members surface without decoding the
 * band colours. Omitted (undefined) on non-banded surfaces — no ring, behaviour unchanged.
 */
export function AllianceRankBadge({
  rank,
  expected,
  className,
}: {
  rank: string | null;
  expected?: string | null;
  className?: string;
}) {
  const tone = rankTone(rank);
  if (!tone) return null;
  const mismatch = rankMismatch(rank, expected ?? null);
  return (
    <span
      title={
        mismatch
          ? `Alliance rank ${rank} — this section is for ${expected}s`
          : `Alliance rank ${rank}`
      }
      className={cn(
        "num inline-flex items-center rounded-[6px] px-1.5 py-0.5 text-[11px] font-semibold",
        tone,
        mismatch && "ring-2 ring-warn",
        className,
      )}
    >
      {rank}
    </span>
  );
}
