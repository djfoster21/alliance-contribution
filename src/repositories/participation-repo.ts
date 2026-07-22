import type { NewParticipation, Participation } from "../../shared/types";
import { all, batchChunked, buildMultiRowInsert, first } from "./db";

const COLUMNS = ["event_id", "raw_name", "member_id", "value", "points", "notes"];

export class ParticipationRepo {
  constructor(private readonly db: D1Database) {}

  async insertMany(rows: NewParticipation[]): Promise<void> {
    if (rows.length === 0) return;

    const values = rows.map((row) => [row.event_id, row.raw_name, row.member_id, row.value, row.points, row.notes]);
    const stmts = buildMultiRowInsert(this.db, "participations", COLUMNS, values);
    await batchChunked(this.db, stmts);
  }

  async listByEvent(eventId: number): Promise<Participation[]> {
    return all<Participation>(this.db, "SELECT * FROM participations WHERE event_id = ? ORDER BY id", eventId);
  }

  // Participations for one event, each joined to its resolved member's governor (NULL when unmapped).
  async listByEventWithMember(eventId: number): Promise<
    {
      id: number;
      raw_name: string;
      member_id: number | null;
      governor: string | null;
      value: number;
      points: number;
      notes: string | null;
    }[]
  > {
    return all(
      this.db,
      `SELECT p.id, p.raw_name, p.member_id, m.governor, p.value, p.points, p.notes
       FROM participations p
       LEFT JOIN members m ON m.id = p.member_id
       WHERE p.event_id = ?
       ORDER BY p.id`,
      eventId,
    );
  }

  // Replaces the full participation set for one event: delete existing rows, then insert the new set.
  // DELETE is prepended to the same batch so a small set commits atomically in one db.batch().
  async replaceForEvent(eventId: number, rows: NewParticipation[]): Promise<void> {
    const deleteStmt = this.db
      .prepare("DELETE FROM participations WHERE event_id = ?")
      .bind(eventId);
    const values = rows.map((row) => [
      row.event_id,
      row.raw_name,
      row.member_id,
      row.value,
      row.points,
      row.notes,
    ]);
    const insertStmts = buildMultiRowInsert(this.db, "participations", COLUMNS, values);
    await batchChunked(this.db, [deleteStmt, ...insertStmts]);
  }

  async count(): Promise<number> {
    const row = await first<{ count: number }>(this.db, "SELECT COUNT(*) AS count FROM participations");
    return row?.count ?? 0;
  }

  // Every participation joined to its event's activity_type_id — the input RecomputeService re-scores.
  // member_id + points are the CURRENT stored values: recompute compares against them so unchanged rows
  // are never rewritten (D1 bills rows written; see docs/plans/2026-07-25_d1-write-budget.md).
  async listForRecompute(): Promise<
    {
      id: number;
      raw_name: string;
      value: number;
      activity_type_id: number;
      member_id: number | null;
      points: number;
    }[]
  > {
    return all(
      this.db,
      `SELECT p.id, p.raw_name, p.value, e.activity_type_id, p.member_id, p.points
       FROM participations p
       JOIN events e ON e.id = p.event_id`,
    );
  }

  // Distinct unmapped raw names (member_id NULL), each with the events it appeared in. The join returns one
  // row per appearance; group by raw_name in TS into the queue shape the operator maps from.
  async listUnmapped(): Promise<
    {
      raw_name: string;
      appearances: { event_id: number; activity: string; date: string; instance: number }[];
    }[]
  > {
    const rows = await all<{
      raw_name: string;
      event_id: number;
      activity: string;
      date: string;
      instance: number;
    }>(
      this.db,
      `SELECT p.raw_name, e.id AS event_id, a.key AS activity, e.date, e.instance
       FROM participations p
       JOIN events e ON e.id = p.event_id
       JOIN activity_types a ON a.id = e.activity_type_id
       WHERE p.member_id IS NULL
       ORDER BY p.raw_name, e.date, e.instance`,
    );

    const byName = new Map<
      string,
      { event_id: number; activity: string; date: string; instance: number }[]
    >();
    for (const row of rows) {
      const appearance = {
        event_id: row.event_id,
        activity: row.activity,
        date: row.date,
        instance: row.instance,
      };
      const list = byName.get(row.raw_name);
      if (list) list.push(appearance);
      else byName.set(row.raw_name, [appearance]);
    }

    return [...byName].map(([raw_name, appearances]) => ({ raw_name, appearances }));
  }

  // Every participation joined to its event + activity type, with the fields the retroactive conflict scan
  // needs (max_instance selects the two-trap candidates; instance/date/activity_type_id group them).
  async listForConflictScan(): Promise<
    {
      event_id: number;
      activity_type_id: number;
      date: string;
      instance: number;
      max_instance: number;
      member_id: number | null;
      raw_name: string;
    }[]
  > {
    return all(
      this.db,
      `SELECT p.event_id, e.activity_type_id, e.date, e.instance, a.max_instance, p.member_id, p.raw_name
       FROM participations p
       JOIN events e ON e.id = p.event_id
       JOIN activity_types a ON a.id = e.activity_type_id`,
    );
  }

  // Writes recomputed member_id + points, one UPDATE per row (3 bound params), via a chunked batch.
  async applyRecompute(
    updates: { id: number; member_id: number | null; points: number }[],
  ): Promise<void> {
    if (updates.length === 0) return;

    const stmts = updates.map((update) =>
      this.db
        .prepare("UPDATE participations SET member_id = ?, points = ? WHERE id = ?")
        .bind(update.member_id, update.points, update.id),
    );
    await batchChunked(this.db, stmts);
  }
}
