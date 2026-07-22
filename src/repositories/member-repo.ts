import type { Member, NewMember } from "../../shared/types";
import { all, batchChunked, buildMultiRowInsert, first, run } from "./db";

const COLUMNS = ["governor", "alliance_rank", "power", "power_position", "active"] satisfies (keyof Member)[];

export class MemberRepo {
  constructor(private readonly db: D1Database) {}

  async insertMany(rows: NewMember[]): Promise<void> {
    if (rows.length === 0) return;

    const values = rows.map((row) => [row.governor, row.alliance_rank, row.power, row.power_position, row.active]);
    const stmts = buildMultiRowInsert(this.db, "members", COLUMNS, values);
    await batchChunked(this.db, stmts);
  }

  async insert(row: NewMember): Promise<Member> {
    const inserted = await first<Member>(
      this.db,
      `INSERT INTO members (governor, alliance_rank, power, power_position, active)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`,
      row.governor,
      row.alliance_rank,
      row.power,
      row.power_position,
      row.active,
    );

    if (!inserted) throw new Error("MemberRepo.insert: insert did not return a row");
    return inserted;
  }

  async getByGovernor(governor: string): Promise<Member | null> {
    return first<Member>(this.db, "SELECT * FROM members WHERE governor = ?", governor);
  }

  async getById(id: number): Promise<Member | null> {
    return first<Member>(this.db, "SELECT * FROM members WHERE id = ?", id);
  }

  async update(
    id: number,
    fields: Partial<Pick<Member, "governor" | "alliance_rank" | "power" | "power_position" | "active">>,
  ): Promise<Member | null> {
    const columns = ["governor", "alliance_rank", "power", "power_position", "active"] as const;
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const column of columns) {
      if (column in fields) {
        assignments.push(`${column} = ?`);
        values.push(fields[column]);
      }
    }

    if (assignments.length === 0) return this.getById(id);

    return first<Member>(
      this.db,
      `UPDATE members SET ${assignments.join(", ")}, updated_at = datetime('now') WHERE id = ? RETURNING *`,
      ...values,
      id,
    );
  }

  async deactivate(id: number): Promise<void> {
    await run(this.db, "UPDATE members SET active = 0, updated_at = datetime('now') WHERE id = ?", id);
  }

  async list(opts?: { active?: boolean }): Promise<Member[]> {
    if (opts?.active !== undefined) {
      return all<Member>(this.db, "SELECT * FROM members WHERE active = ? ORDER BY id", opts.active ? 1 : 0);
    }
    return all<Member>(this.db, "SELECT * FROM members ORDER BY id");
  }

  async count(): Promise<number> {
    const row = await first<{ count: number }>(this.db, "SELECT COUNT(*) AS count FROM members");
    return row?.count ?? 0;
  }
}
