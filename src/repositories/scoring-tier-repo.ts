import type { NewScoringTier, ScoringTier } from "../../shared/types";
import { all, batchChunked, buildMultiRowInsert } from "./db";

const COLUMNS = ["activity_type_id", "min_value", "points"];

export class ScoringTierRepo {
  constructor(private readonly db: D1Database) {}

  async insertMany(rows: NewScoringTier[]): Promise<void> {
    if (rows.length === 0) return;

    const values = rows.map((row) => [row.activity_type_id, row.min_value, row.points]);
    const stmts = buildMultiRowInsert(this.db, "scoring_tiers", COLUMNS, values);
    await batchChunked(this.db, stmts);
  }

  async listByActivity(activityTypeId: number): Promise<ScoringTier[]> {
    return all<ScoringTier>(
      this.db,
      "SELECT * FROM scoring_tiers WHERE activity_type_id = ? ORDER BY min_value",
      activityTypeId,
    );
  }

  // Replaces the full tier set for one activity: delete existing tiers, then insert the new set.
  // DELETE is prepended to the same batch so a small set commits atomically in one db.batch().
  async replaceForActivity(
    activityTypeId: number,
    tiers: { min_value: number; points: number }[],
  ): Promise<void> {
    const deleteStmt = this.db
      .prepare("DELETE FROM scoring_tiers WHERE activity_type_id = ?")
      .bind(activityTypeId);
    const values = tiers.map((tier) => [activityTypeId, tier.min_value, tier.points]);
    const insertStmts = buildMultiRowInsert(this.db, "scoring_tiers", COLUMNS, values);
    await batchChunked(this.db, [deleteStmt, ...insertStmts]);
  }
}
