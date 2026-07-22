import type { ActivityType, NewActivityType } from "../../shared/types";
import { first, all, run } from "./db";

export class ActivityRepo {
  constructor(private readonly db: D1Database) {}

  async insert(row: NewActivityType): Promise<ActivityType> {
    const inserted = await first<ActivityType>(
      this.db,
      `INSERT INTO activity_types (key, name, unit_label, weight, max_instance, min_value, active, sort, color)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      row.key,
      row.name,
      row.unit_label,
      row.weight,
      row.max_instance,
      row.min_value,
      row.active,
      row.sort,
      row.color,
    );

    if (!inserted) throw new Error("ActivityRepo.insert: insert did not return a row");
    return inserted;
  }

  async getByKey(key: string): Promise<ActivityType | null> {
    return first<ActivityType>(this.db, "SELECT * FROM activity_types WHERE key = ?", key);
  }

  async getById(id: number): Promise<ActivityType | null> {
    return first<ActivityType>(this.db, "SELECT * FROM activity_types WHERE id = ?", id);
  }

  async updateWeight(id: number, weight: number): Promise<void> {
    await run(this.db, "UPDATE activity_types SET weight = ? WHERE id = ?", weight, id);
  }

  async update(
    id: number,
    fields: Partial<
      Pick<
        ActivityType,
        "key" | "name" | "unit_label" | "weight" | "max_instance" | "min_value" | "active" | "sort" | "color"
      >
    >,
  ): Promise<ActivityType | null> {
    const columns = [
      "key",
      "name",
      "unit_label",
      "weight",
      "max_instance",
      "min_value",
      "active",
      "sort",
      "color",
    ] as const;
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const column of columns) {
      if (column in fields) {
        assignments.push(`${column} = ?`);
        values.push(fields[column]);
      }
    }

    if (assignments.length === 0) return this.getById(id);

    return first<ActivityType>(
      this.db,
      `UPDATE activity_types SET ${assignments.join(", ")} WHERE id = ? RETURNING *`,
      ...values,
      id,
    );
  }

  async deactivate(id: number): Promise<void> {
    await run(this.db, "UPDATE activity_types SET active = 0 WHERE id = ?", id);
  }

  async list(opts?: { active?: boolean }): Promise<ActivityType[]> {
    if (opts?.active !== undefined) {
      return all<ActivityType>(
        this.db,
        "SELECT * FROM activity_types WHERE active = ? ORDER BY sort, id",
        opts.active ? 1 : 0,
      );
    }
    return all<ActivityType>(this.db, "SELECT * FROM activity_types ORDER BY sort, id");
  }
}
