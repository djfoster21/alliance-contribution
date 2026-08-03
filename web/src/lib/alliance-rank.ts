/**
 * Alliance rank presentation. `alliance_rank` is the R1–R5 in-game rank (spec 2026-07-27 §62-74) —
 * NOT the score rank the ranking boards compute, and NOT `power_position`.
 *
 * R4 (admins) and R5 (the leader) are appointed rather than earned, so they carry the emphasized
 * tone; R1–R3 stay neutral so a board of 86 members does not turn into a wall of colour.
 */
export const LEADERSHIP_RANKS = new Set(["R4", "R5"]);

/** Tailwind tone classes for a rank, or null when there is no rank to show. */
export function rankTone(rank: string | null): string | null {
  if (!rank) return null;
  return LEADERSHIP_RANKS.has(rank) ? "bg-accent-subtle text-accent" : "bg-muted-surface text-muted";
}

export type Band = "leadership" | "top" | "mid" | "rest";

/**
 * Assigns each row a band from its DISPLAY position on a board (2026-08-03 spec).
 * R4/R5 are leadership and don't consume counted slots. Value-aware on top of position:
 * boards are roster-seeded so a zero-value tail always exists (alphabetical — never "Top N"),
 * and a row tying the previous counted row inherits its band so the alphabetical tiebreak
 * can't split a tie group across a colour boundary.
 *
 * `bands` is structural, not @shared/types.RankBands: this file runs under the root unit-test
 * project, where the @shared alias does not resolve (same rule as overview-derive.ts).
 */
export function assignBands(
  rows: Array<{ alliance_rank: string | null; value: number }>,
  bands: { top: number; mid: number },
): Band[] {
  const out: Band[] = [];
  let counted = 0;
  let prev: { value: number; band: Band } | null = null;
  for (const row of rows) {
    if (row.alliance_rank !== null && LEADERSHIP_RANKS.has(row.alliance_rank)) {
      out.push("leadership");
      continue;
    }
    let band: Band;
    if (row.value === 0) band = "rest";
    else if (prev !== null && row.value === prev.value) band = prev.band;
    else if (counted < bands.top) band = "top";
    else if (counted < bands.top + bands.mid) band = "mid";
    else band = "rest";
    out.push(band);
    prev = { value: row.value, band };
    counted++;
  }
  return out;
}
