// Pure derivation behind the roster table. Deliberately free of JSX, DOM types, and path aliases,
// for the same reason as roster-paste.ts and overview-derive.ts: web/ has no test runner, so this
// lives as plain TypeScript that test/unit/ imports by relative path and the root Vitest unit
// project executes.

import { AT_RISK } from "./overview-derive";

/**
 * The member fields the roster view reads. Structural, so `Member` from shared/types satisfies it.
 * Every function here is generic over the caller's member type rather than narrowing to this one:
 * the page hands rows straight to action handlers typed on the full `Member`, and a row that had
 * been flattened to this six-field shape could not be passed to them.
 */
export type RosterMember = {
  id: number;
  governor: string;
  alliance_rank: string | null;
  power: number | null;
  power_position: number | null;
  active: number;
};

/** The delta fields the roster view reads. Structural, so `MemberDelta` satisfies it. */
export type RosterDeltaLike = {
  member_id: number;
  delta_power: number | null;
  delta_position: number | null;
  since: string | null;
  // Optional: captureRosterInput's entries carry no pair, and other structural callers must stay
  // valid without them. Set together only for a real observed change (see MemberDelta).
  rank_from?: string | null;
  rank_to?: string | null;
};

/**
 * `unknown` is not a state of the member — it means we have no attendance to judge them on, either
 * because the fetch has not landed (or failed) or because the alliance has logged no events at all.
 * Rendering it as "Active" would claim a fact we do not have; rendering it as "At risk" would put
 * an orange edge on all 86 rows of a fresh install.
 */
export type RosterStatus = "active" | "at-risk" | "inactive" | "unknown";

export type RosterRow<M extends RosterMember = RosterMember> = {
  member: M;
  deltaPower: number | null;
  /**
   * Places GAINED since this member's own last observation: positive = moved up the power board.
   * It is the negation of `delta_position`, which is signed the other way (shared/types.ts:222).
   * Null = no prior observation; 0 = observed and did not move. The two are never merged.
   */
  move: number | null;
  attendance: number | null; // 0..1, or null when there is no attendance to judge on
  status: RosterStatus;
  /** Observed alliance-rank change vs the member's own previous observation. Null = no change observed. */
  rankChange: { from: string; to: string } | null;
};

export function buildRosterRows<M extends RosterMember>(input: {
  members: M[];
  deltas: Map<number, RosterDeltaLike>;
  attendance: Map<number, number> | null;
}): RosterRow<M>[] {
  return input.members.map((member) => {
    const delta = input.deltas.get(member.id);
    // A member absent from a LOADED attendance map has genuinely attended nothing — /api/attendance
    // is a LEFT JOIN over every member (stats-repo.ts attendanceCounts), so absence there is a real
    // zero. Only a null map means "nothing to judge on".
    const attendance = input.attendance === null ? null : (input.attendance.get(member.id) ?? 0);
    return {
      member,
      deltaPower: delta?.delta_power ?? null,
      // `|| 0` normalizes the -0 that `-delta.delta_position` produces when delta_position is 0 —
      // -0 and 0 are `===` but not `Object.is` equal, and a zero move must not carry a sign.
      move: delta?.delta_position == null ? null : -delta.delta_position || 0,
      attendance,
      status: deriveStatus(member, attendance),
      rankChange: delta?.rank_from != null && delta?.rank_to != null ? { from: delta.rank_from, to: delta.rank_to } : null,
    };
  });
}

function deriveStatus(member: RosterMember, attendance: number | null): RosterStatus {
  if (member.active === 0) return "inactive";
  if (attendance === null) return "unknown";
  return attendance < AT_RISK ? "at-risk" : "active";
}

export type RosterFilter = "all" | "active" | "inactive";
export type RosterSort = "power" | "tier" | "movers" | "name" | "status";

export function filterRows<M extends RosterMember>(rows: RosterRow<M>[], filter: RosterFilter): RosterRow<M>[] {
  if (filter === "all") return rows;
  const wanted = filter === "active" ? 1 : 0;
  return rows.filter((r) => r.member.active === wanted);
}

/** Exported for RankChangeChip's direction tint — one R-level map per side of the Worker/SPA boundary. */
export const TIER_ORDER: Record<string, number> = { R5: 5, R4: 4, R3: 3, R2: 2, R1: 1 };

/**
 * Triage order, most in need of attention first: someone slipping, then someone we cannot judge,
 * then the healthy bulk, then the people who have already left. Higher sorts earlier — `desc` does
 * the rest, and the numbers are spaced by one because nothing else reads them.
 */
const STATUS_ORDER: Record<RosterStatus, number> = { "at-risk": 4, unknown: 3, active: 2, inactive: 1 };

/**
 * Null sinks to the bottom of every numeric sort rather than sorting as zero: a member with no power
 * reading has not "lost", and a member with no prior observation has not "not moved". Sorting them
 * as zero would file them in the middle of the board and hide that the reading is missing.
 */
function desc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

export function sortRows<M extends RosterMember>(rows: RosterRow<M>[], sort: RosterSort): RosterRow<M>[] {
  const out = rows.slice();
  switch (sort) {
    case "power":
      return out.sort((a, b) => desc(a.member.power, b.member.power));
    case "tier":
      return out.sort(
        (a, b) =>
          desc(TIER_ORDER[a.member.alliance_rank ?? ""] ?? null, TIER_ORDER[b.member.alliance_rank ?? ""] ?? null) ||
          desc(a.member.power, b.member.power),
      );
    case "movers":
      return out.sort((a, b) =>
        desc(
          a.deltaPower === null ? null : Math.abs(a.deltaPower),
          b.deltaPower === null ? null : Math.abs(b.deltaPower),
        ),
      );
    case "name":
      return out.sort((a, b) => a.member.governor.localeCompare(b.member.governor));
    case "status":
      return out.sort(
        (a, b) => desc(STATUS_ORDER[a.status], STATUS_ORDER[b.status]) || desc(a.member.power, b.member.power),
      );
  }
}

/**
 * Everything below reports on the LIVE roster only. A deactivated member keeps their last observed
 * power forever (MemberService only flips `active`), so including them would report people who have
 * left as current alliance strength — the same trap overview-derive.ts:26-35 documents.
 */
function live<M extends RosterMember>(rows: RosterRow<M>[]): RosterRow<M>[] {
  return rows.filter((r) => r.member.active === 1);
}

export type RosterSummary = {
  totalPower: number;
  /**
   * Σ of every member's change since THEIR OWN last observation. Each term can span a different
   * number of captures (MemberService.deltas compares each member's last two snapshots), so this is
   * "total change since everyone was last seen", not the change across one interval. The UI must
   * label it that way — there is no single previous-capture date to name.
   */
  powerDelta: number;
  gained: number;
  dropped: number;
  atRisk: number;
  tracked: number;
};

export function summarizeRoster(rows: RosterRow[]): RosterSummary {
  const summary: RosterSummary = {
    totalPower: 0,
    powerDelta: 0,
    gained: 0,
    dropped: 0,
    atRisk: 0,
    tracked: 0,
  };
  for (const r of live(rows)) {
    summary.tracked += 1;
    if (r.member.power !== null) summary.totalPower += r.member.power;
    if (r.deltaPower !== null) {
      summary.powerDelta += r.deltaPower;
      if (r.deltaPower > 0) summary.gained += 1;
      if (r.deltaPower < 0) summary.dropped += 1;
    }
    if (r.status === "at-risk") summary.atRisk += 1;
  }
  return summary;
}

/** Bar denominators. Computed over the whole live roster so bar lengths are stable across tabs. */
export function rosterScales(rows: RosterRow[]): { maxPower: number; maxAbsDelta: number } {
  let maxPower = 0;
  let maxAbsDelta = 0;
  for (const r of live(rows)) {
    if (r.member.power !== null) maxPower = Math.max(maxPower, r.member.power);
    if (r.deltaPower !== null) maxAbsDelta = Math.max(maxAbsDelta, Math.abs(r.deltaPower));
  }
  return { maxPower, maxAbsDelta };
}

/**
 * The ids of the n strongest live members, by power.
 *
 * The `#` column shows the game's own `power_position`, which is what the admin sees on the Alliance
 * Ranking screen — but it is only rewritten for members present in the last import, has no
 * uniqueness constraint (member-service.ts:371), and can therefore repeat or go stale. Deriving
 * "top 10" from it would bold an arbitrary number of rows. This derives it from power instead.
 */
export function topPowerIds(rows: RosterRow[], n: number): Set<number> {
  return new Set(
    live(rows)
      .filter((r) => r.member.power !== null)
      .sort((a, b) => (b.member.power ?? 0) - (a.member.power ?? 0))
      .slice(0, n)
      .map((r) => r.member.id),
  );
}

/**
 * One row of the time-travel payload (GET /api/members/captures/:date/roster). Structural mirror
 * of shared CaptureRosterRow — this module deliberately avoids path aliases (see header comment).
 */
export type CaptureRosterRowLike = {
  member_id: number;
  governor: string;
  alliance_rank: string | null;
  power: number | null;
  power_position: number | null;
  delta_power: number | null;
  delta_position: number | null;
  since: string | null;
};

/**
 * Adapts a historical capture payload to buildRosterRows input. A capture holds observed members
 * only and says nothing about active/inactive (absence ≠ departure), so every row renders as
 * active; the page passes attendance: null alongside, which turns the STATUS column into dashes.
 */
export function captureRosterInput(rows: CaptureRosterRowLike[]): {
  members: RosterMember[];
  deltas: Map<number, RosterDeltaLike>;
} {
  return {
    members: rows.map((r) => ({
      id: r.member_id,
      governor: r.governor,
      alliance_rank: r.alliance_rank,
      power: r.power,
      power_position: r.power_position,
      active: 1,
    })),
    deltas: new Map(
      rows.map((r) => [
        r.member_id,
        { member_id: r.member_id, delta_power: r.delta_power, delta_position: r.delta_position, since: r.since },
      ]),
    ),
  };
}
