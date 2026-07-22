import type {
  MemberDelta,
  MemberRef,
  MemberSnapshot,
  PowerChange,
  RankChange,
  RosterDelta,
} from "../../shared/types";

// Power in this game accumulates steadily, so a swing far beyond normal growth is more likely an identity
// swap (a decoy that adopted a live governor name) or an OCR error than a real week — see the spec's
// "Known residual risk (accepted)". The ratio is PER WEEK, not per capture: `since` is each member's own
// last observation and is frequently several captures back, so a flat threshold would flag everyone who
// missed a few pastes and grew normally — training the operator to ignore the one list that matters.
export const VERIFY_POWER_RATIO = 0.2;

const RANK_ORDER: Record<string, number> = { R1: 1, R2: 2, R3: 3, R4: 4, R5: 5 };
const LEADERSHIP_RANKS = new Set(["R4", "R5"]);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type DeltaCurrentRow = {
  member_id: number;
  governor: string;
  alliance_rank: string | null;
  power: number | null;
  power_position: number | null;
};

export type DeltaInput = {
  captured_on: string; // the date of THIS capture — the far end of every per-member elapsed gap
  current: DeltaCurrentRow[];
  previous: MemberSnapshot[];
  joined: MemberRef[];
  departed: MemberRef[];
  returned: MemberRef[];
};

// Diffs one capture against each member's own last observation.
// `current` must hold AT MOST ONE row per member: it is keyed against the baseline by member_id, so a
// duplicate would emit the same member twice in every list. (MemberService.importRoster's validation
// rejects a batch that resolves two names to one member, which is what guarantees it there.)
export function computeDelta(input: DeltaInput): RosterDelta {
  const baseline = new Map(input.previous.map((row) => [row.member_id, row]));
  // A member who was inactive for months is expected to come back looking very different, so a big jump
  // is not suspicious for them — and they are the single largest source of false alarms.
  const returnedIds = new Set(input.returned.map((r) => r.member_id));

  const leadership: RankChange[] = [];
  const promotions: RankChange[] = [];
  const demotions: RankChange[] = [];
  const powerMoves: PowerChange[] = [];
  const verify: PowerChange[] = [];

  for (const row of input.current) {
    const before = baseline.get(row.member_id);
    if (!before) continue; // no prior observation — nothing to compare against

    // A null rank means the badge was unreadable and the ingest prompt told the model to omit the cell
    // rather than guess — routine input, not an event. A transition into or out of unknown did NOT happen
    // in-game, so it is reported nowhere: "R2 -> null" is not a demotion, "null -> R2" is not a promotion,
    // and "R4 -> null" is emphatically not the alliance losing an admin. The member's current rank is
    // visible elsewhere in the UI; this panel only reports changes that really occurred.
    if (
      before.alliance_rank !== null &&
      row.alliance_rank !== null &&
      before.alliance_rank !== row.alliance_rank
    ) {
      const change: RankChange = {
        member_id: row.member_id,
        governor: row.governor,
        from: before.alliance_rank,
        to: row.alliance_rank,
        since: before.captured_on,
      };
      // A change touching R4 or R5 on EITHER side is leadership only. The result panel renders the
      // three lists sequentially, so overlapping membership would render the same change twice.
      const touchesLeadership =
        LEADERSHIP_RANKS.has(before.alliance_rank) || LEADERSHIP_RANKS.has(row.alliance_rank);

      if (touchesLeadership) {
        leadership.push(change);
      } else {
        const from = RANK_ORDER[before.alliance_rank] ?? 0;
        const to = RANK_ORDER[row.alliance_rank] ?? 0;
        if (to > from) promotions.push(change);
        else if (to < from) demotions.push(change);
      }
    }

    if (before.power !== null && row.power !== null && before.power !== row.power) {
      const move: PowerChange = {
        member_id: row.member_id,
        governor: row.governor,
        from: before.power,
        to: row.power,
        delta: row.power - before.power,
        delta_position:
          before.power_position !== null && row.power_position !== null
            ? row.power_position - before.power_position
            : null,
        since: before.captured_on,
        elapsed_days: daysBetween(before.captured_on, input.captured_on),
      };
      powerMoves.push(move);

      // Scaled by the gap: one week keeps the bare ratio, six weeks needs six times it. Sub-week gaps
      // (a same-week re-capture) floor at one week rather than tightening into noise.
      // No zero-guard on `before.power`: 0 -> large is precisely the identity-swap signature this list
      // exists to catch, and the division correctly yields Infinity. 0 -> 0 can't reach here because the
      // enclosing `before.power !== row.power` already excluded it, so NaN is unreachable.
      const threshold = VERIFY_POWER_RATIO * Math.max(1, move.elapsed_days / 7);
      if (!returnedIds.has(row.member_id) && Math.abs(move.delta) / before.power > threshold) {
        verify.push(move);
      }
    }
  }

  // Both lists are rendered biggest-first; `verify` leads the panel, so it must not be the unsorted one.
  powerMoves.sort(byMagnitude);
  verify.sort(byMagnitude);

  const previousCapture = input.previous.reduce<string | null>(
    (latest, row) => (latest === null || row.captured_on > latest ? row.captured_on : latest),
    null,
  );

  return {
    previousCapture,
    leadership,
    promotions,
    demotions,
    powerMoves,
    verify,
    joined: input.joined,
    departed: input.departed,
    returned: input.returned,
  };
}

function byMagnitude(a: PowerChange, b: PowerChange): number {
  return Math.abs(b.delta) - Math.abs(a.delta);
}

// Whole days between two YYYY-MM-DD dates. Parsed as UTC midnight so no host timezone can shift a
// boundary, and kept pure — both endpoints come from the input, never from the clock.
function daysBetween(from: string, to: string): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / MS_PER_DAY);
}

function utcMidnight(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** A row of SnapshotRepo.lastTwoPerMember: rn 1 is the member's latest observation, rn 2 the previous. */
export type SnapshotRank = {
  member_id: number;
  rn: number;
  captured_on: string;
  power: number | null;
  power_position: number | null;
};

/**
 * Folds the last-two-per-member rows into one Δ per member. Input order is irrelevant; output is
 * ordered by member_id so the payload is stable between calls.
 *
 * `delta_position` is negative when the member moved UP the power leaderboard (position 6 -> 4 = -2),
 * matching PowerChange.delta_position in the import delta panel.
 */
export function computeMemberDeltas(rows: SnapshotRank[]): MemberDelta[] {
  const latest = new Map<number, SnapshotRank>();
  const previous = new Map<number, SnapshotRank>();
  for (const r of rows) {
    if (r.rn === 1) latest.set(r.member_id, r);
    else if (r.rn === 2) previous.set(r.member_id, r);
  }

  return [...latest.values()]
    .sort((a, b) => a.member_id - b.member_id)
    .map((cur) => {
      const prev = previous.get(cur.member_id);
      if (!prev) {
        return { member_id: cur.member_id, delta_power: null, delta_position: null, since: null };
      }
      return {
        member_id: cur.member_id,
        delta_power: diff(cur.power, prev.power),
        delta_position: diff(cur.power_position, prev.power_position),
        since: prev.captured_on,
      };
    });
}

// A null on either side means the value was unreadable in that capture — unknown, not zero.
function diff(current: number | null, prior: number | null): number | null {
  return current === null || prior === null ? null : current - prior;
}
