import type {
  Attendance,
  AttendanceRow,
  MemberProfile,
  OverallRanking,
  OverallRankingRow,
  Overview,
  WeeklyRanking,
} from "../../shared/types";
import type { StatsRepo } from "../repositories/stats-repo";

// Read-side temporal views, composed from StatsRepo's SQL and shaped to shared/types. No cache — every
// read is current the moment the last recompute committed.
export class StatsService {
  constructor(private readonly statsRepo: StatsRepo) {}

  // Members ranked by Participation Score for a week (default: latest with events). Tie-break: score desc,
  // then governor asc — deterministic, so recompute idempotency is verifiable. Movement = prevRank - rank
  // (positive = moved up); null when there is no prior week with events or the member wasn't ranked then.
  async weeklyRanking(week?: string, activityKey?: string): Promise<WeeklyRanking> {
    // Activity-aware week set (ascending) — the source for BOTH the default week and the prior week.
    // A week without events of the filtered activity has no board at all: the roster-seeded zero rows
    // ranked alphabetically would otherwise be served as a real leaderboard (hasEvents = false instead).
    const weeks = await this.statsRepo.distinctEventWeeks(activityKey);
    const target = week ?? weeks[weeks.length - 1] ?? null;
    if (target === null || !weeks.includes(target)) {
      return { week: target ?? "", possible: 0, hasEvents: false, rows: [] };
    }

    const attendance = await this.attendanceMap(target, activityKey);
    const possible = await this.statsRepo.weekPossible(target, activityKey);
    const rows = await this.buildRanking(target, activityKey, attendance);

    // Prior week = the greatest distinct event-week strictly before target. Activity-aware for the same
    // reason: a week the activity skipped would yield an all-zero board and bogus (zero) movement.
    const priorWeek = [...weeks].reverse().find((w) => w < target) ?? null;

    if (priorWeek === null) {
      return { week: target, possible, hasEvents: true, rows: rows.map((r) => ({ ...r, movement: null })) };
    }

    // Reuses the TARGET week's attendance map: prior rows exist only to derive priorRank below —
    // their attendance values are wrong-scope on purpose and must never be returned or sorted on.
    const priorRows = await this.buildRanking(priorWeek, activityKey, attendance);
    const priorRank = new Map<number, number>();
    for (const r of priorRows) priorRank.set(r.member_id, r.rank);

    return {
      week: target,
      possible,
      hasEvents: true,
      rows: rows.map((r) => {
        const prev = priorRank.get(r.member_id);
        return { ...r, movement: prev !== undefined ? prev - r.rank : null };
      }),
    };
  }

  // All-time board: cumulative points over every event, same member set / ordering / tie-break as
  // weekly. No movement — an all-time total has no prior period.
  async overallRanking(activityKey?: string): Promise<OverallRanking> {
    return {
      possible: await this.statsRepo.overallPossible(activityKey),
      rows: this.foldRanking(
        await this.statsRepo.rankedMembers(),
        await this.statsRepo.overallScores(activityKey),
        await this.attendanceMap(undefined, activityKey),
      ),
    };
  }

  async memberProfile(memberId: number): Promise<MemberProfile | null> {
    const member = await this.statsRepo.memberById(memberId);
    if (!member) return null;

    const [totals, perActivityRows, seriesRows, possibleWeeks, overallPossible] = await Promise.all([
      this.statsRepo.memberTotals(memberId),
      this.statsRepo.memberPerActivity(memberId),
      this.statsRepo.memberWeekSeries(memberId),
      this.statsRepo.possibleByWeek(),
      this.statsRepo.overallPossible(),
    ]);

    const perActivity: Record<string, { points: number; appearances: number }> = {};
    for (const r of perActivityRows) {
      perActivity[r.activity_key] = { points: r.points, appearances: r.appearances };
    }
    const possibleByWeek = new Map(possibleWeeks.map((r) => [r.week, r.possible]));

    // Fold per-week+activity rows into one series entry per week; week score = Σ of its activity points.
    const seriesByWeek = new Map<string, { week: string; score: number; byActivity: Record<string, number> }>();
    for (const r of seriesRows) {
      let entry = seriesByWeek.get(r.week);
      if (!entry) {
        entry = { week: r.week, score: 0, byActivity: {} };
        seriesByWeek.set(r.week, entry);
      }
      entry.score += r.points;
      entry.byActivity[r.activity_key] = (entry.byActivity[r.activity_key] ?? 0) + r.points;
    }

    return {
      member: { id: member.id, governor: member.governor, alliance_rank: member.alliance_rank, active: member.active },
      totals: { ...totals, possible: overallPossible },
      perActivity,
      series: [...seriesByWeek.values()].map((s) => ({
        ...s,
        possible: possibleByWeek.get(s.week) ?? 0,
      })),
    };
  }

  // Y = total distinct event-days in scope (all-time by default; accepted simplification: mid-season
  // joiners are penalized). X = the distinct in-scope event-days the member appeared in. Ordered pct
  // desc, then governor asc. Both filters narrow numerator AND denominator together, so a scoped board
  // still reads 0–100%. A week/activity combination with no events gives total 0 -> every row 0%; callers
  // distinguish that from a genuine all-absent board via total_event_days.
  async attendance(week?: string, activityKey?: string): Promise<Attendance> {
    const total = await this.statsRepo.totalEventDays(week, activityKey);
    const counts = await this.statsRepo.attendanceCounts(week, activityKey);

    const rows: AttendanceRow[] = counts
      .map((c) => ({
        member_id: c.member_id,
        governor: c.governor,
        alliance_rank: c.alliance_rank,
        attended: c.attended,
        total,
        pct: total ? c.attended / total : 0,
        active: c.active,
      }))
      .sort((a, b) => b.pct - a.pct || compareGovernor(a.governor, b.governor));

    return { total_event_days: total, rows };
  }

  // member_id -> attendance pct (0..1) in the given scope. Same source as attendance(), reused to
  // embed a per-member attendance figure in every ranking row. Scope must match the board's scope:
  // the caller's week/activity filters narrow numerator and denominator together.
  private async attendanceMap(week?: string, activityKey?: string): Promise<Map<number, number>> {
    const total = await this.statsRepo.totalEventDays(week, activityKey);
    const counts = await this.statsRepo.attendanceCounts(week, activityKey);
    return new Map(counts.map((c) => [c.member_id, total ? c.attended / total : 0]));
  }

  // Distinct event weeks, newest first (for pickers).
  async weeks(): Promise<string[]> {
    const weeks = await this.statsRepo.distinctEventWeeks();
    return weeks.reverse();
  }

  async overview(): Promise<Overview> {
    const [memberCounts, events, eventDays, weeks, latestWeek, unmappedNames] = await Promise.all([
      this.statsRepo.memberCounts(),
      this.statsRepo.eventCount(),
      this.statsRepo.totalEventDays(),
      this.statsRepo.distinctEventWeeks(),
      this.statsRepo.latestWeek(),
      this.statsRepo.unmappedNameCount(),
    ]);

    return {
      members: memberCounts.total,
      activeMembers: memberCounts.active,
      events,
      eventDays,
      weeks: weeks.length,
      latestWeek,
      unmappedNames,
    };
  }

  // Folds per member+activity rows into ranked rows (without movement): seed a zero row for every
  // in-set member, add scores (sum -> score, map -> breakdown), sort by score desc then governor asc,
  // assign 1-based rank.
  private async buildRanking(
    week: string,
    activityKey: string | undefined,
    attendance: Map<number, number>,
  ): Promise<OverallRankingRow[]> {
    return this.foldRanking(
      await this.statsRepo.rankedMembers(),
      await this.statsRepo.weekScores(week, activityKey),
      attendance,
    );
  }

  private foldRanking(
    members: { member_id: number; governor: string; alliance_rank: string | null }[],
    scores: { member_id: number; governor: string; activity_key: string; points: number }[],
    attendance: Map<number, number>,
  ): OverallRankingRow[] {
    const byMember = new Map<
      number,
      { member_id: number; governor: string; alliance_rank: string | null; score: number; breakdown: Record<string, number> }
    >();
    for (const m of members) {
      byMember.set(m.member_id, {
        member_id: m.member_id,
        governor: m.governor,
        alliance_rank: m.alliance_rank,
        score: 0,
        breakdown: {},
      });
    }
    for (const s of scores) {
      const row = byMember.get(s.member_id);
      if (!row) continue; // scored members always satisfy the EXISTS in rankedMembers
      row.score += s.points;
      row.breakdown[s.activity_key] = (row.breakdown[s.activity_key] ?? 0) + s.points;
    }
    return [...byMember.values()]
      .sort((a, b) => b.score - a.score || compareGovernor(a.governor, b.governor))
      .map((r, i) => ({ ...r, rank: i + 1, attendance: attendance.get(r.member_id) ?? 0 }));
  }
}

// Codepoint-ordered governor comparison (matches SQL ASC), deterministic for the tie-break.
function compareGovernor(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
