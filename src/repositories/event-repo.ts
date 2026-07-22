import type { Event, EventListRow, NewEvent } from "../../shared/types";
import { all, first, run } from "./db";

export class EventRepo {
  constructor(private readonly db: D1Database) {}

  async insert(row: NewEvent): Promise<Event> {
    const inserted = await first<Event>(
      this.db,
      `INSERT INTO events (activity_type_id, date, week, instance)
       VALUES (?, ?, ?, ?)
       RETURNING *`,
      row.activity_type_id,
      row.date,
      row.week,
      row.instance,
    );

    if (!inserted) throw new Error("EventRepo.insert: insert did not return a row");
    return inserted;
  }

  async getByKey(activityTypeId: number, date: string, instance: number): Promise<Event | null> {
    return first<Event>(
      this.db,
      "SELECT * FROM events WHERE activity_type_id = ? AND date = ? AND instance = ?",
      activityTypeId,
      date,
      instance,
    );
  }

  async getById(id: number): Promise<Event | null> {
    return first<Event>(this.db, "SELECT * FROM events WHERE id = ?", id);
  }

  async list(filter?: {
    activity_type_id?: number;
    week?: string;
    from?: string;
    to?: string;
  }): Promise<EventListRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.activity_type_id !== undefined) {
      conditions.push("activity_type_id = ?");
      params.push(filter.activity_type_id);
    }
    if (filter?.week !== undefined) {
      conditions.push("week = ?");
      params.push(filter.week);
    }
    if (filter?.from !== undefined) {
      conditions.push("date >= ?");
      params.push(filter.from);
    }
    if (filter?.to !== undefined) {
      conditions.push("date <= ?");
      params.push(filter.to);
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    // `rows` is quoted because ROWS is a SQLite keyword (window-frame syntax); quoting removes any
    // doubt about how it's parsed as a bare identifier. The WHERE conditions stay unqualified —
    // participations only appears in the correlated subqueries, so no column is ambiguous.
    return all<EventListRow>(
      this.db,
      `SELECT e.*,
              (SELECT COUNT(*) FROM participations p WHERE p.event_id = e.id) AS "rows",
              (SELECT COUNT(*) FROM participations p WHERE p.event_id = e.id AND p.member_id IS NULL) AS unmapped
         FROM events e${where}
        ORDER BY e.date DESC, e.instance`,
      ...params,
    );
  }

  async updateKey(
    id: number,
    fields: { activity_type_id: number; date: string; week: string; instance: number },
  ): Promise<Event> {
    const updated = await first<Event>(
      this.db,
      `UPDATE events
       SET activity_type_id = ?, date = ?, week = ?, instance = ?, updated_at = datetime('now')
       WHERE id = ?
       RETURNING *`,
      fields.activity_type_id,
      fields.date,
      fields.week,
      fields.instance,
      id,
    );

    if (!updated) throw new Error("EventRepo.updateKey: update did not return a row");
    return updated;
  }

  async delete(id: number): Promise<void> {
    await run(this.db, "DELETE FROM events WHERE id = ?", id);
  }

  async count(): Promise<number> {
    const row = await first<{ count: number }>(this.db, "SELECT COUNT(*) AS count FROM events");
    return row?.count ?? 0;
  }

  // Highest `instance` in use for one activity type; 0 when it has no events (MAX returns NULL).
  async maxInstance(activityTypeId: number): Promise<number> {
    const row = await first<{ max_instance: number | null }>(
      this.db,
      "SELECT MAX(instance) AS max_instance FROM events WHERE activity_type_id = ?",
      activityTypeId,
    );
    return row?.max_instance ?? 0;
  }
}
