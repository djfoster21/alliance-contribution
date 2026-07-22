// Pure derivations behind the Overview dashboard. Deliberately free of JSX, DOM types, and path
// aliases: web/ has no test runner, so these live as plain TypeScript that test/unit/ can import by
// relative path and the root Vitest unit project can execute. Parameters are structural for the
// same reason — @shared/types does not resolve there.

/**
 * The 50% line below which a member counts as at risk. Note: AttendanceBadge (web/src/components/
 * AttendanceBadge.tsx) bands on the *rounded* display percent, so a member in [0.495, 0.5) counts as
 * at risk here but can still render an amber "50%" pill there — this is the honest threshold from the
 * spec, not a pixel-for-pixel match to the badge.
 */
export const AT_RISK = 0.5;

// Structural on purpose (see file header). Note this type has no `active` field: these helpers do
// not know about deactivated members. Pass the roster through `activeRows` below before calling
// attendanceSummary/atRiskMembers — it will not happen here.
export type AttendanceLike = { member_id: number; governor: string; pct: number };
export type EventLike = { id: number; date: string; instance: number };

export type AttendanceSummary = {
  avgPct: number; // 0..1, mean attendance across the roster
  perfect: number; // members at 100%
  atRisk: number; // members below 50%
};

/**
 * The live roster only. Soft-deleted members stay in /api/attendance frozen at whatever attendance
 * they had when they left, which makes them structurally the worst attenders — averaging or ranking
 * over them reports stale data as current. Exists so the filter is a visible call at each site: a
 * caller that genuinely wants the whole roster (the Attendance page) reads as a deliberate omission
 * rather than a forgotten one.
 */
export function activeRows<T extends { active: number }>(rows: T[]): T[] {
  return rows.filter((row) => row.active === 1);
}

/**
 * Roster-wide attendance headline. Returns zeros rather than NaN on an empty roster so a fresh
 * install renders "0%" instead of "NaN%".
 */
export function attendanceSummary(rows: AttendanceLike[]): AttendanceSummary {
  if (rows.length === 0) return { avgPct: 0, perfect: 0, atRisk: 0 };

  let total = 0;
  let perfect = 0;
  let atRisk = 0;
  for (const row of rows) {
    total += row.pct;
    if (row.pct === 1) perfect += 1;
    if (row.pct < AT_RISK) atRisk += 1;
  }

  return { avgPct: total / rows.length, perfect, atRisk };
}

/** Worst attendance first, governor as the tie-break so the rendered order never jitters. */
export function atRiskMembers<T extends AttendanceLike>(rows: T[], limit: number): T[] {
  return rows
    .filter((row) => row.pct < AT_RISK)
    .sort((a, b) => a.pct - b.pct || a.governor.localeCompare(b.governor))
    .slice(0, limit);
}

/**
 * Newest ingests first. The events endpoint orders ascending for the admin page, so the dashboard
 * reverses here rather than adding a second ordering to the query.
 */
export function recentEvents<T extends EventLike>(events: T[], limit: number): T[] {
  return [...events]
    .sort((a, b) => b.date.localeCompare(a.date) || b.instance - a.instance || b.id - a.id)
    .slice(0, limit);
}
