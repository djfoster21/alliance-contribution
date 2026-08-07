// Row types matching migrations/0001_init.sql (+ 0002 + 0004) exactly.

export type ActivityType = {
  id: number;
  key: string;
  name: string;
  unit_label: string | null;
  weight: number;
  max_instance: number;
  min_value: number;
  active: number;
  sort: number;
  color: string;
};

export type ScoringTier = {
  id: number;
  activity_type_id: number;
  min_value: number;
  points: number;
};

export type Member = {
  id: number;
  governor: string;
  alliance_rank: string | null;
  power: number | null;
  power_position: number | null;
  active: number;
  created_at: string;
  updated_at: string;
};

export type Alias = {
  id: number;
  alias: string;
  member_id: number;
  note: string | null;
  created_at: string;
};

// One observation of a member's in-game standing, written by a roster import. A member absent from a
// capture gets NO row for that date — a gap, not a zero.
export type MemberSnapshot = {
  id: number;
  member_id: number;
  captured_on: string;              // YYYY-MM-DD
  alliance_rank: string | null;
  power: number | null;
  power_position: number | null;
};

export type NewMemberSnapshot = Omit<MemberSnapshot, "id">;

export type Event = {
  id: number;
  activity_type_id: number;
  date: string;
  week: string;
  instance: number;
  created_at: string;
  updated_at: string;
};

// An event as the list endpoint returns it: the stored row plus its participation counts, which are
// aggregated at query time rather than stored (they change whenever an ingest or recompute runs).
export type EventListRow = Event & {
  rows: number; // participations attached to this event
  unmapped: number; // of those, how many have no resolved member
};

export type Participation = {
  id: number;
  event_id: number;
  raw_name: string;
  member_id: number | null;
  value: number;
  points: number;
  notes: string | null;
};

// Insert inputs: row type minus DB-generated columns.
export type NewActivityType = Omit<ActivityType, "id">;
export type NewScoringTier = Omit<ScoringTier, "id">;
export type NewMember = Omit<Member, "id" | "created_at" | "updated_at">;
export type NewAlias = Omit<Alias, "id" | "created_at">;
export type NewEvent = Omit<Event, "id" | "created_at" | "updated_at">;
export type NewParticipation = Omit<Participation, "id">;

// Analytics payloads (Phase 5) — shaped by StatsService, consumed by the Phase 6 frontend.
export type OverallRankingRow = {
  member_id: number;
  governor: string;
  alliance_rank: string | null; // R1–R5, or null when never recorded. Travels with the member on
                                // every board so rank sits beside contribution (see 2026-07-27 spec).
  score: number; // total points in scope (one week, or all-time)
  breakdown: Record<string, number>; // activity key -> points (only activities scored in)
  attendance: number; // attendance pct (0..1) in the board's scope (its week/activity filters), same source as /api/attendance
  rank: number; // 1-based, after tie-break
};
// possible = Σ over events in scope of MAX(tier points) × activity weight — the common denominator
// for percent-of-possible display (same for every member; see 2026-07-23_percent-of-possible-ranking.md).
export type OverallRanking = { possible: number; rows: OverallRankingRow[] };

export type WeeklyRankingRow = OverallRankingRow & {
  movement: number | null; // prevRank - rank (positive = moved up); null if no prior week / not ranked prior
};
// hasEvents = the week actually has events of the requested activity (all activities when unfiltered).
// False => rows is empty and there is no board to show; consumers must render an empty state instead of a
// zero board. It is not derivable from `possible === 0` (an activity with no scoring tiers has real events
// but a zero denominator) nor from `rows.length` (boards are roster-seeded, so zero rows are normal).
export type WeeklyRanking = {
  week: string;
  possible: number;
  hasEvents: boolean;
  rows: WeeklyRankingRow[];
};

export type MemberProfile = {
  member: { id: number; governor: string; alliance_rank: string | null; active: number };
  totals: { score: number; appearances: number; possible: number }; // possible = all-time denominator
  perActivity: Record<string, { points: number; appearances: number }>; // keyed by activity key
  // ordered by week asc. byActivity: activity key -> points that week (drives the stacked composition).
  series: { week: string; score: number; possible: number; byActivity: Record<string, number> }[];
};

export type AttendanceRow = {
  member_id: number;
  governor: string;
  alliance_rank: string | null; // R1–R5, or null when never recorded
  attended: number; // X
  total: number; // Y (same for every member = total distinct event-days)
  pct: number; // attended/total, 0..1 (0 when total is 0)
  // Weekly view only (absent on all-time): pct(W) − pct(prior in-scope event-week). null when the
  // target week has no in-scope event-days, or no prior in-scope event-week exists. Caveats
  // (accepted, see 2026-07-31 spec): tiny denominators differ week to week, and members added
  // after the prior week read a spurious full-positive delta.
  delta?: number | null;
  active: number; // 0/1, mirrors Member.active — lets callers exclude soft-deleted members
};
export type Attendance = { total_event_days: number; rows: AttendanceRow[] };

export type Overview = {
  members: number; // total
  activeMembers: number;
  events: number;
  eventDays: number; // distinct (activity_type_id, date)
  weeks: number; // distinct event weeks
  latestWeek: string | null;
  unmappedNames: number; // distinct raw_name with member_id NULL
};

// Roster bulk import (Phase 4). The frontend classifies a pasted roster TSV whose columns are
// Governor·Rank·Power·Position — note those are the screenshot's labels; they map to governor /
// alliance_rank / power / power_position here. It classifies against the current members + aliases
// and lets the operator decide each unrecognized name; this ALREADY-DECIDED batch is what reaches
// the backend. The backend never guesses identity — it only applies explicit decisions atomically,
// then recomputes once. An `aliases` row is a name the operator marked as a rename of an existing
// member: it creates the alias AND updates that member's meta from the row. Membership is decided the
// same way — the backend never guesses that absence means departure; deactivations and reactivations
// arrive as explicit id lists.
export type RosterImportBatch = {
  captured_on: string;                          // YYYY-MM-DD, the date this screen was captured
  updates: Array<{ member_id: number; alliance_rank?: string | null; power?: number | null; power_position?: number | null }>;
  creates: Array<{ governor: string; alliance_rank?: string | null; power?: number | null; power_position?: number | null }>;
  // `promote_to_governor` makes this a rename: the member's governor becomes the pasted name and the
  // old name is kept as an alias. Defaults to false — it is the destructive reading, and the alliance
  // runs deliberate decoy renames where similar names are different people (runbook §8).
  aliases: Array<{ alias: string; member_id: number; promote_to_governor?: boolean; alliance_rank?: string | null; power?: number | null; power_position?: number | null }>;
  deactivate: number[];                         // member ids absent from the paste, operator-confirmed
  reactivate: number[];                         // inactive member ids present in the paste
};

// The delta an import returns: what changed in-game since each member's OWN last observation.
// Every change carries `governor` because the import result panel cannot resolve ids: the dialog's
// member list is fetched once when it opens and is stale for anything this import created or renamed.
// `since` is per-member, not global — gaps mean different members have different baselines.
export type RankChange = {
  member_id: number;
  governor: string;
  from: string | null;
  to: string | null;
  since: string;
};

export type PowerChange = {
  member_id: number;
  governor: string;
  from: number | null;
  to: number | null;
  delta: number;
  delta_position: number | null;    // negative = moved up the leaderboard
  since: string;
  elapsed_days: number;             // days from `since` to this capture — a % move is meaningless without it
};

export type MemberRef = { member_id: number; governor: string };

export type RosterDelta = {
  previousCapture: string | null;   // most recent capture before this one; null on the first import
  leadership: RankChange[];         // any change touching R4 or R5 on either side
  promotions: RankChange[];         // rank increased, R4/R5 excluded — those are in `leadership`
  demotions: RankChange[];          // rank decreased, R4/R5 excluded
  powerMoves: PowerChange[];        // delta != 0, sorted by magnitude descending
  verify: PowerChange[];            // implausible moves — see the spec's residual-risk section
  joined: MemberRef[];
  departed: MemberRef[];
  returned: MemberRef[];
};

export type RosterImportResult = {
  updated: number;
  created: number;
  aliased: number;
  deactivated: number;
  reactivated: number;
  recomputed: number;
  delta: RosterDelta;
};

// One row of the roster table's Δ columns: the member's latest observation against their OWN previous
// one. All three fields are null when there is nothing to compare against (a single observation), and
// a delta alone is null when either side was unreadable — an unreadable cell is unknown, not zero.
export type MemberDelta = {
  member_id: number;
  delta_power: number | null;
  delta_position: number | null;    // negative = moved UP the power leaderboard
  since: string | null;             // the capture date being compared against
  rank_from: string | null;   // previous observed rank — the pair is set together, and only
  rank_to: string | null;     //   for a real change (non-null ≠ non-null); else both null
};

// The profile's power/position history. `captures` is EVERY capture date, ascending — `rows` holds only
// the dates this member was observed on. The chart walks `captures` and emits a null point for a date
// with no row, which is what breaks the line: interpolating across an absence would draw a power
// collapse (or recovery) that never happened.
export type MemberSnapshotSeries = { captures: string[]; rows: MemberSnapshot[] };

// One entry of the roster time-travel select: a capture date and how many members it observed.
export type CaptureSummary = { captured_on: string; members: number };

// One row of the roster time-travel view: a member as observed on that capture date, plus their
// change vs their OWN previous observation. Same null rule as MemberDelta: unreadable = unknown,
// not zero. `governor` is the member's CURRENT name, not the name pasted that day.
export type CaptureRosterRow = {
  member_id: number;
  governor: string;
  alliance_rank: string | null;
  power: number | null;
  power_position: number | null;
  delta_power: number | null;
  delta_position: number | null; // negative = moved UP the power leaderboard
  since: string | null;          // baseline capture date, null = first observation
};

// ---- Reward allocations (2026-08-07 spec) -----------------------------------

export type AllocationMetric = "points" | "attendance";
export type AllocationStrategy = "top_n" | "proportional" | "proportional_top" | "tiered";

/** One tiered-strategy band: ranks fromRank..toRank (1-based, inclusive) each get amountEach. */
export type TierBand = { fromRank: number; toRank: number; amountEach: number };

// A per-member amount, snapshotted at save time. `governor` is joined at read time (lines store
// member_id so history follows renames); rank/metric_value/amount are frozen as computed.
// `attendance` (0..1, over the selected weeks) is PREVIEW-ONLY display context — never stored,
// absent on saved lines.
export type AllocationLine = {
  member_id: number;
  governor: string;
  rank: number;
  metric_value: number;
  amount: number;
  attendance?: number;
};

export type Allocation = {
  id: number;
  title: string;
  quantity: number;
  metric: AllocationMetric;
  weeks: string[]; // the selected event weeks, auditable later
  strategy: AllocationStrategy;
  tiers: TierBand[] | null; // null unless strategy = tiered
  top_count: number | null; // null unless strategy = proportional_top
  created_at: string;
};

export type AllocationWithLines = Allocation & { lines: AllocationLine[] };

/** Preview/create request body. `title` is required on create only. */
export type AllocationInput = {
  title?: string;
  quantity: number;
  metric: AllocationMetric;
  weeks: string[];
  strategy: AllocationStrategy;
  tiers?: TierBand[];
  topCount?: number;
};

export type AllocationPreview = { lines: AllocationLine[]; warnings: string[] };

// Worker bindings.
export type Env = {
  DB: D1Database;
  API_KEY: string;
  ADMIN_API_KEY: string;
  VIEWER_API_KEY: string;
  ASSETS: Fetcher;
  API_RATE_LIMIT: RateLimit;
};

// ---- Settings (2026-08-03 rank-bands spec) ----------------------------------

/** Rank-band sizes for the boards: first `top` counted members, then `mid`, remainder "rest". */
export type RankBands = { top: number; mid: number };

/** Served whenever a settings row is missing or unparseable; never seeded into the DB. */
export const DEFAULT_RANK_BANDS: RankBands = { top: 30, mid: 20 };
