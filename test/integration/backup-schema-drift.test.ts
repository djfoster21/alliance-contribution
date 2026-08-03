import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { BACKUP_EXCLUDED_TABLES, INSERT_ORDER, TABLE_COLUMNS } from "../../src/domain/backup";

const { DB } = env;

describe("backup schema drift guard", () => {
  it("INSERT_ORDER covers exactly the user tables in the schema", async () => {
    const { results } = await DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name).filter((n) => !BACKUP_EXCLUDED_TABLES.has(n)).sort()).toEqual([...INSERT_ORDER].sort());
  });

  it("TABLE_COLUMNS matches each table's real columns", async () => {
    for (const table of INSERT_ORDER) {
      const { results } = await DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      expect(new Set(results.map((r) => r.name))).toEqual(new Set(TABLE_COLUMNS[table]));
    }
  });
});
