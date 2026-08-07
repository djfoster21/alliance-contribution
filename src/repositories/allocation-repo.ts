import type { Allocation, AllocationLine, TierBand } from "../../shared/types";
import { all, first, run } from "./db";

// The stored row: weeks/tiers are JSON text columns.
type AllocationRow = Omit<Allocation, "weeks" | "tiers"> & { weeks: string; tiers: string | null };

export type NewAllocation = {
  title: string;
  quantity: number;
  metric: Allocation["metric"];
  weeks: string[];
  strategy: Allocation["strategy"];
  tiers: TierBand[] | null;
  top_count: number | null;
};

// A line as computed (governor is joined at read time, never stored).
export type NewAllocationLine = Omit<AllocationLine, "governor">;

export class AllocationRepo {
  constructor(private readonly db: D1Database) {}

  // Allocation + lines in ONE db.batch — a single D1 transaction, so a failed line insert rolls the
  // allocation back. Lines reference the allocation via (SELECT MAX(id) FROM allocations): inside
  // this transaction that is exactly the row the first statement inserted. NOT last_insert_rowid() —
  // after line 1 lands, that points at line 1, and every later line would attach to it. One INSERT
  // per line because a single multi-row VALUES for ~86 lines exceeds D1's ~100-bound-parameter limit.
  async insertWithLines(allocation: NewAllocation, lines: NewAllocationLine[]): Promise<number> {
    const results = await this.db.batch([
      this.db
        .prepare("INSERT INTO allocations (title, quantity, metric, weeks, strategy, tiers, top_count) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(
          allocation.title,
          allocation.quantity,
          allocation.metric,
          JSON.stringify(allocation.weeks),
          allocation.strategy,
          allocation.tiers ? JSON.stringify(allocation.tiers) : null,
          allocation.top_count,
        ),
      ...lines.map((l) =>
        this.db
          .prepare(
            "INSERT INTO allocation_lines (allocation_id, member_id, amount, rank, metric_value) VALUES ((SELECT MAX(id) FROM allocations), ?, ?, ?, ?)",
          )
          .bind(l.member_id, l.amount, l.rank, l.metric_value),
      ),
    ]);
    return results[0].meta.last_row_id;
  }

  async list(): Promise<Allocation[]> {
    const rows = await all<AllocationRow>(this.db, "SELECT * FROM allocations ORDER BY id DESC");
    return rows.map(parseAllocation);
  }

  async get(id: number): Promise<Allocation | null> {
    const row = await first<AllocationRow>(this.db, "SELECT * FROM allocations WHERE id = ?", id);
    return row ? parseAllocation(row) : null;
  }

  // Current governor joined in so history follows renames. Ordered by rank; a merge can leave two
  // lines on one member (even two with the same rank never happens — ranks were distinct at save).
  async lines(allocationId: number): Promise<AllocationLine[]> {
    return all(
      this.db,
      `SELECT l.member_id, m.governor, l.rank, l.metric_value, l.amount
       FROM allocation_lines l
       JOIN members m ON m.id = l.member_id
       WHERE l.allocation_id = ?
       ORDER BY l.rank`,
      allocationId,
    );
  }

  async updateTitle(id: number, title: string): Promise<boolean> {
    const result = await run(this.db, "UPDATE allocations SET title = ? WHERE id = ?", title, id);
    return result.meta.changes > 0;
  }

  async delete(id: number): Promise<boolean> {
    const result = await run(this.db, "DELETE FROM allocations WHERE id = ?", id);
    return result.meta.changes > 0;
  }

  // Member merge support: repoint the source's lines at the surviving member. Amount/rank/metric_value
  // stay frozen — lines record what actually happened.
  async reassignMember(sourceId: number, targetId: number): Promise<number> {
    const result = await run(
      this.db,
      "UPDATE allocation_lines SET member_id = ? WHERE member_id = ?",
      targetId,
      sourceId,
    );
    return result.meta.changes;
  }
}

function parseAllocation(row: AllocationRow): Allocation {
  return {
    ...row,
    weeks: JSON.parse(row.weeks) as string[],
    tiers: row.tiers ? (JSON.parse(row.tiers) as TierBand[]) : null,
  };
}
