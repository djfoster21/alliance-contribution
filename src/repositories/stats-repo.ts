import { all, first } from "./db";

// All analytics SQL. Every aggregate ignores participations with member_id IS NULL (unmapped rows count
// for nobody). Derived per-appearance scores live in participations.points — SUM them, never recompute.
export class StatsRepo {
  constructor(private readonly db: D1Database) {}

  // Distinct event weeks, ascending. Callers reverse for newest-first pickers.
  async distinctEventWeeks(activityKey?: string): Promise<string[]> {
    if (!activityKey) {
      const rows = await all<{ week: string }>(this.db, "SELECT DISTINCT week FROM events ORDER BY week");
      return rows.map((r) => r.week);
    }
    const rows = await all<{ week: string }>(
      this.db,
      `SELECT DISTINCT e.week
       FROM events e
       JOIN activity_types a ON a.id = e.activity_type_id
       WHERE a.key = ?
       ORDER BY e.week`,
      activityKey,
    );
    return rows.map((r) => r.week);
  }

  async latestWeek(): Promise<string | null> {
    const row = await first<{ week: string }>(
      this.db,
      "SELECT week FROM events ORDER BY week DESC LIMIT 1",
    );
    return row?.week ?? null;
  }

  // Per member+activity points for one week — the input the service folds into OverallRankingRow.
  // Optional activityKey re-ranks a single activity (attendance is scoped alongside; see stats-service).
  async weekScores(
    week: string,
    activityKey?: string,
  ): Promise<{ member_id: number; governor: string; activity_key: string; points: number }[]> {
    const filter = activityKey ? "AND a.key = ?" : "";
    const params = activityKey ? [week, activityKey] : [week];
    return all(
      this.db,
      `SELECT p.member_id, m.governor, a.key AS activity_key, SUM(p.points) AS points
       FROM participations p
       JOIN events e ON e.id = p.event_id
       JOIN activity_types a ON a.id = e.activity_type_id
       JOIN members m ON m.id = p.member_id
       WHERE e.week = ? AND p.member_id IS NOT NULL ${filter}
       GROUP BY p.member_id, e.activity_type_id`,
      ...params,
    );
  }

  // In-set roster for the ranking boards: active members OR anyone who ever scored. Seeds the zero
  // rows so boards are roster-wide instead of participants-only (zero-point inactive members hidden).
  async rankedMembers(): Promise<{ member_id: number; governor: string; alliance_rank: string | null }[]> {
    return all(
      this.db,
      `SELECT m.id AS member_id, m.governor, m.alliance_rank
       FROM members m
       WHERE m.active = 1
          OR EXISTS (SELECT 1 FROM participations p WHERE p.member_id = m.id)
       ORDER BY m.governor`,
    );
  }

  // weekScores without the week filter — per member+activity cumulative points across all events.
  async overallScores(
    activityKey?: string,
  ): Promise<{ member_id: number; governor: string; activity_key: string; points: number }[]> {
    const filter = activityKey ? "AND a.key = ?" : "";
    const params = activityKey ? [activityKey] : [];
    return all(
      this.db,
      `SELECT p.member_id, m.governor, a.key AS activity_key, SUM(p.points) AS points
       FROM participations p
       JOIN events e ON e.id = p.event_id
       JOIN activity_types a ON a.id = e.activity_type_id
       JOIN members m ON m.id = p.member_id
       WHERE p.member_id IS NOT NULL ${filter}
       GROUP BY p.member_id, e.activity_type_id`,
      ...params,
    );
  }

  // Max points possible for one week: Σ over the week's event-days of MAX(tier points) × activity weight.
  // Counted per distinct (activity_type_id, date), not per event row — a two-trap Bear day contributes
  // once, because two-trap uniqueness means a member can only appear in one of the two traps (max earned
  // per Bear day = 1, so the denominator must be 1 too). Read-time from current config — a scoring change
  // alters historical denominators by design. An activity with no tiers contributes 0 (earned is 0 too).
  async weekPossible(week: string, activityKey?: string): Promise<number> {
    const filter = activityKey ? "AND a.key = ?" : "";
    const params = activityKey ? [week, activityKey] : [week];
    const row = await first<{ possible: number }>(
      this.db,
      `SELECT COALESCE(SUM(COALESCE(t.max_points, 0) * a.weight), 0) AS possible
       FROM (SELECT DISTINCT activity_type_id, date FROM events WHERE week = ?) e
       JOIN activity_types a ON a.id = e.activity_type_id
       LEFT JOIN (
         SELECT activity_type_id, MAX(points) AS max_points
         FROM scoring_tiers GROUP BY activity_type_id
       ) t ON t.activity_type_id = e.activity_type_id
       WHERE 1 = 1 ${filter}`,
      ...params,
    );
    return row?.possible ?? 0;
  }

  // All-time possible: same as weekPossible without the week filter (still one contribution per event-day).
  async overallPossible(activityKey?: string): Promise<number> {
    const filter = activityKey ? "AND a.key = ?" : "";
    const params = activityKey ? [activityKey] : [];
    const row = await first<{ possible: number }>(
      this.db,
      `SELECT COALESCE(SUM(COALESCE(t.max_points, 0) * a.weight), 0) AS possible
       FROM (SELECT DISTINCT activity_type_id, date FROM events) e
       JOIN activity_types a ON a.id = e.activity_type_id
       LEFT JOIN (
         SELECT activity_type_id, MAX(points) AS max_points
         FROM scoring_tiers GROUP BY activity_type_id
       ) t ON t.activity_type_id = e.activity_type_id
       WHERE 1 = 1 ${filter}`,
      ...params,
    );
    return row?.possible ?? 0;
  }

  // Per-week possible for every event week — one query, used to enrich the profile week series.
  // Same per-event-day dedupe (week is a function of date, so it survives the DISTINCT).
  async possibleByWeek(): Promise<{ week: string; possible: number }[]> {
    return all(
      this.db,
      `SELECT e.week AS week, COALESCE(SUM(COALESCE(t.max_points, 0) * a.weight), 0) AS possible
       FROM (SELECT DISTINCT activity_type_id, date, week FROM events) e
       JOIN activity_types a ON a.id = e.activity_type_id
       LEFT JOIN (
         SELECT activity_type_id, MAX(points) AS max_points
         FROM scoring_tiers GROUP BY activity_type_id
       ) t ON t.activity_type_id = e.activity_type_id
       GROUP BY e.week
       ORDER BY e.week`,
    );
  }

  async memberById(
    id: number,
  ): Promise<{ id: number; governor: string; alliance_rank: string | null; active: number } | null> {
    return first(this.db, "SELECT id, governor, alliance_rank, active FROM members WHERE id = ?", id);
  }

  async memberTotals(id: number): Promise<{ score: number; appearances: number }> {
    const row = await first<{ score: number; appearances: number }>(
      this.db,
      "SELECT COALESCE(SUM(points), 0) AS score, COUNT(*) AS appearances FROM participations WHERE member_id = ?",
      id,
    );
    return { score: row?.score ?? 0, appearances: row?.appearances ?? 0 };
  }

  async memberPerActivity(
    id: number,
  ): Promise<{ activity_key: string; points: number; appearances: number }[]> {
    return all(
      this.db,
      `SELECT a.key AS activity_key, COALESCE(SUM(p.points), 0) AS points, COUNT(*) AS appearances
       FROM participations p
       JOIN events e ON e.id = p.event_id
       JOIN activity_types a ON a.id = e.activity_type_id
       WHERE p.member_id = ?
       GROUP BY e.activity_type_id`,
      id,
    );
  }

  // Per week + activity points for one member (drives the stacked composition). The service folds
  // rows into one entry per week; week total = Σ of its activity rows.
  async memberWeekSeries(
    id: number,
  ): Promise<{ week: string; activity_key: string; points: number }[]> {
    return all(
      this.db,
      `SELECT e.week AS week, a.key AS activity_key, SUM(p.points) AS points
       FROM participations p
       JOIN events e ON e.id = p.event_id
       JOIN activity_types a ON a.id = e.activity_type_id
       WHERE p.member_id = ?
       GROUP BY e.week, e.activity_type_id
       ORDER BY e.week`,
      id,
    );
  }

  // Distinct event-days = distinct (activity_type_id, date). A two-trap Bear day shares one date -> one pair.
  // Both filters are optional and scope the attendance denominator (omit both for all-time).
  async totalEventDays(week?: string, activityKey?: string): Promise<number> {
    const row = await first<{ count: number }>(
      this.db,
      `SELECT COUNT(*) AS count FROM (
         SELECT DISTINCT e.activity_type_id, e.date
         FROM events e
         JOIN activity_types a ON a.id = e.activity_type_id
         WHERE 1 = 1 ${week ? "AND e.week = ?" : ""} ${activityKey ? "AND a.key = ?" : ""}
       )`,
      ...attendanceParams(week, activityKey),
    );
    return row?.count ?? 0;
  }

  // Per member, the count of distinct event-days they appeared in. LEFT JOIN so no-shows appear with 0
  // (COUNT(DISTINCT ...) over the NULL join key yields 0). A member in either trap of a two-trap day
  // shares that day's (activity_type_id, date) key, so it counts once. The week/activity filters live in
  // the join's ON clause, not a WHERE: in a WHERE they would drop every member whose only participations
  // fall outside the filter, turning no-shows into missing rows instead of zeroes.
  async attendanceCounts(
    week?: string,
    activityKey?: string,
  ): Promise<
    { member_id: number; governor: string; alliance_rank: string | null; attended: number; active: number }[]
  > {
    return all(
      this.db,
      `SELECT m.id AS member_id, m.governor, m.alliance_rank, m.active,
              COUNT(DISTINCT e.activity_type_id || '|' || e.date) AS attended
       FROM members m
       LEFT JOIN participations p ON p.member_id = m.id
       LEFT JOIN events e ON e.id = p.event_id
         ${week ? "AND e.week = ?" : ""}
         ${activityKey ? "AND e.activity_type_id = (SELECT id FROM activity_types WHERE key = ?)" : ""}
       GROUP BY m.id`,
      ...attendanceParams(week, activityKey),
    );
  }

  async memberCounts(): Promise<{ total: number; active: number }> {
    const row = await first<{ total: number; active: number }>(
      this.db,
      "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END), 0) AS active FROM members",
    );
    return { total: row?.total ?? 0, active: row?.active ?? 0 };
  }

  async eventCount(): Promise<number> {
    const row = await first<{ count: number }>(this.db, "SELECT COUNT(*) AS count FROM events");
    return row?.count ?? 0;
  }

  async unmappedNameCount(): Promise<number> {
    const row = await first<{ count: number }>(
      this.db,
      "SELECT COUNT(*) AS count FROM (SELECT DISTINCT raw_name FROM participations WHERE member_id IS NULL)",
    );
    return row?.count ?? 0;
  }
}

// Bind order for the optional attendance filters — week first, then activity, matching the order the
// placeholders appear in both attendance queries.
function attendanceParams(week?: string, activityKey?: string): string[] {
  const params: string[] = [];
  if (week) params.push(week);
  if (activityKey) params.push(activityKey);
  return params;
}
