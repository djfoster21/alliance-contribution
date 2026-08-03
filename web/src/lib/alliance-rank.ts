/**
 * Alliance rank presentation. `alliance_rank` is the R1–R5 in-game rank (spec 2026-07-27 §62-74) —
 * NOT the score rank the ranking boards compute, and NOT `power_position`.
 *
 * Every rank carries its own tone (2026-08-03 spec — supersedes the old "R1–R3 stay neutral"
 * colour budget): hues echo the board bands (R3=top blue, R2=mid teal, R1=rest slate,
 * R4/R5=leadership purple, R5 bold) so a badge-vs-row mismatch reads as "mis-ranked member".
 */
export const LEADERSHIP_RANKS = new Set(["R4", "R5"]);

const RANK_TONES: Record<string, string> = {
  R5: "bg-rank5-bg text-rank5-fg",
  R4: "bg-rank4-bg text-rank4-fg",
  R3: "bg-rank3-bg text-rank3-fg",
  R2: "bg-rank2-bg text-rank2-fg",
  R1: "bg-rank1-bg text-rank1-fg",
};

/** Tailwind tone classes for a rank, or null when there is no rank to show. */
export function rankTone(rank: string | null): string | null {
  if (!rank) return null;
  return RANK_TONES[rank] ?? "bg-muted-surface text-muted";
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

/**
 * The should-be rank per section: the top band is where R3s belong, the second R2s, the rest R1s.
 * Leadership is appointed, not positional — no expectation.
 */
export const BAND_EXPECTED_RANK: Record<Band, string | null> = {
  leadership: null,
  top: "R3",
  mid: "R2",
  rest: "R1",
};

/** True when a member's recorded rank sits outside its section's should-be rank. */
export function rankMismatch(rank: string | null, expected: string | null): boolean {
  return rank !== null && expected !== null && rank !== expected;
}

/** Faint row tint per band. */
export const BAND_ROW_CLASS: Record<Band, string> = {
  leadership: "bg-band-lead-bg",
  top: "bg-band-top-bg",
  mid: "bg-band-mid-bg",
  rest: "bg-band-rest-bg",
};

/**
 * Band edge for the row's FIRST CELL, not the row: `Table` is border-collapse: collapse, and
 * browsers don't paint box-shadow on row boxes in the collapse model (same trick as
 * roster-cells.tsx riskEdgeClass).
 */
export const BAND_EDGE_CLASS: Record<Band, string> = {
  leadership: "[box-shadow:inset_3px_0_0_var(--color-band-lead)]",
  top: "[box-shadow:inset_3px_0_0_var(--color-band-top)]",
  mid: "[box-shadow:inset_3px_0_0_var(--color-band-mid)]",
  rest: "[box-shadow:inset_3px_0_0_var(--color-band-rest)]",
};
