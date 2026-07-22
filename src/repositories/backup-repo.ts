import { INSERT_ORDER, TABLE_COLUMNS, type BackupFile, type Row, type TableName } from "../domain/backup";
import { all, batchChunked, buildMultiRowInsert } from "./db";

export class BackupRepo {
  constructor(private readonly db: D1Database) {}

  // SELECT * per table in FK order, rows ordered by id. Column set comes straight from the DB.
  async dumpAll(): Promise<Record<TableName, Row[]>> {
    const out = {} as Record<TableName, Row[]>;
    for (const table of INSERT_ORDER) {
      out[table] = await all<Row>(this.db, `SELECT * FROM ${table} ORDER BY id`);
    }
    return out;
  }

  // DELETE all tables (reverse FK order), then multi-row INSERT (FK order, code-defined).
  // NOT atomic across the whole write: D1 has no BEGIN/COMMIT across awaits and batchChunked commits per
  // <=50-statement chunk, so a real-sized restore always spans several chunks. Two consequences are handled
  // here: the wipe is its own db.batch() (never sharing a chunk with inserts, so it is one all-or-nothing
  // step), and an insert failure is rethrown stating the DB is partially restored. The operation is
  // deterministic and safely re-appliable — recovery is re-running the SAME import file.
  // Table/column names are code constants (never file-derived) — safe to interpolate; row VALUES are bound.
  async replaceAll(file: BackupFile): Promise<Record<TableName, number>> {
    const deletes = [...INSERT_ORDER]
      .reverse()
      .map((table) => this.db.prepare(`DELETE FROM ${table}`));

    const inserts: D1PreparedStatement[] = [];
    const counts = {} as Record<TableName, number>;
    for (const table of INSERT_ORDER) {
      const columns = TABLE_COLUMNS[table];
      const rows = file.tables[table];
      counts[table] = rows.length;
      if (rows.length === 0) continue;
      const values = rows.map((row) => columns.map((col) => row[col] ?? null));
      inserts.push(...buildMultiRowInsert(this.db, table, columns, values));
    }

    await this.db.batch(deletes);
    try {
      await batchChunked(this.db, inserts);
    } catch (err) {
      throw new Error(
        "import failed after the wipe — the database is PARTIALLY RESTORED (all tables were cleared, " +
          "only some rows reloaded). Re-run the import with the SAME file to finish it: " +
          (err as Error).message,
      );
    }
    return counts;
  }
}
