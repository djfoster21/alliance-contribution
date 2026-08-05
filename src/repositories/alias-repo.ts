import type { Alias, NewAlias } from "../../shared/types";
import { all, batchChunked, buildMultiRowInsert, first, run } from "./db";

const COLUMNS = ["alias", "member_id", "note"];

export class AliasRepo {
  constructor(private readonly db: D1Database) {}

  async insertMany(rows: NewAlias[]): Promise<void> {
    if (rows.length === 0) return;

    const values = rows.map((row) => [row.alias, row.member_id, row.note]);
    const stmts = buildMultiRowInsert(this.db, "aliases", COLUMNS, values);
    await batchChunked(this.db, stmts);
  }

  async insert(row: { alias: string; member_id: number; note: string | null }): Promise<Alias> {
    const inserted = await first<Alias>(
      this.db,
      `INSERT INTO aliases (alias, member_id, note)
       VALUES (?, ?, ?)
       RETURNING *`,
      row.alias,
      row.member_id,
      row.note,
    );

    if (!inserted) throw new Error("AliasRepo.insert: insert did not return a row");
    return inserted;
  }

  async getByAlias(alias: string): Promise<Alias | null> {
    return first<Alias>(this.db, "SELECT * FROM aliases WHERE alias = ?", alias);
  }

  async getById(id: number): Promise<Alias | null> {
    return first<Alias>(this.db, "SELECT * FROM aliases WHERE id = ?", id);
  }

  async delete(id: number): Promise<void> {
    await run(this.db, "DELETE FROM aliases WHERE id = ?", id);
  }

  // Move every alias of one member to another — the merge path. Returns how many moved.
  async reassignMember(from: number, to: number): Promise<number> {
    const result = await run(this.db, "UPDATE aliases SET member_id = ? WHERE member_id = ?", to, from);
    return result.meta.changes ?? 0;
  }

  async list(opts?: { member_id?: number }): Promise<Alias[]> {
    if (opts?.member_id !== undefined) {
      return all<Alias>(this.db, "SELECT * FROM aliases WHERE member_id = ? ORDER BY id", opts.member_id);
    }
    return all<Alias>(this.db, "SELECT * FROM aliases ORDER BY id");
  }

  async count(): Promise<number> {
    const row = await first<{ count: number }>(this.db, "SELECT COUNT(*) AS count FROM aliases");
    return row?.count ?? 0;
  }
}
