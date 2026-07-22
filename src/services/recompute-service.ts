import type { ParticipationRepo } from "../repositories/participation-repo";
import type { ResolveService } from "./resolve-service";
import type { ScoringService } from "./scoring-service";

export class RecomputeService {
  constructor(
    private readonly participationRepo: ParticipationRepo,
    private readonly resolve: ResolveService,
    private readonly scoring: ScoringService,
  ) {}

  // Full re-resolve + re-score of every participation. Deterministic and idempotent: reads all rows,
  // computes member_id + points in memory from the current config, then writes back ONLY the rows whose
  // values actually changed. D1 bills rows written, and rewriting all of history on every alias/rename/
  // scoring edit scales write cost with total history rather than with the size of the edit.
  async run(): Promise<{ participations: number; updated: number }> {
    const resolver = await this.resolve.buildResolver();
    const scorer = await this.scoring.buildScorer();
    const rows = await this.participationRepo.listForRecompute();

    const updates: { id: number; member_id: number | null; points: number }[] = [];
    for (const row of rows) {
      const member_id = resolver.resolve(row.raw_name);
      const points = scorer.compute(row.activity_type_id, row.value);
      if (member_id !== row.member_id || points !== row.points) {
        updates.push({ id: row.id, member_id, points });
      }
    }

    await this.participationRepo.applyRecompute(updates);

    return { participations: rows.length, updated: updates.length };
  }
}
