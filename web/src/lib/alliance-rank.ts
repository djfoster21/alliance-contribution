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
