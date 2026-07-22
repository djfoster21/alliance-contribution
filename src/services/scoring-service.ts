import type { Tier } from "../domain/scoring";
import { scoreAppearance } from "../domain/scoring";
import type { ActivityRepo } from "../repositories/activity-repo";
import type { ScoringTierRepo } from "../repositories/scoring-tier-repo";
import type { RecomputeService } from "./recompute-service";

export type ScoringConfig = { weight: number; tiers: Tier[] };

// A scorer with all activities' config loaded once, then reused across many compute() calls.
export type Scorer = { compute(activityTypeId: number, value: number): number };

export class ScoringService {
  // Set after construction by the composition root — breaks the ScoringService <-> RecomputeService cycle.
  private recompute?: RecomputeService;

  constructor(
    private readonly scoringTierRepo: ScoringTierRepo,
    private readonly activityRepo: ActivityRepo,
  ) {}

  setRecompute(recompute: RecomputeService): void {
    this.recompute = recompute;
  }

  async getConfig(activityTypeId: number): Promise<ScoringConfig> {
    const activity = await this.activityRepo.getById(activityTypeId);
    if (!activity) throw new Error(`ScoringService.getConfig: activity ${activityTypeId} not found`);

    const tiers = await this.scoringTierRepo.listByActivity(activityTypeId);
    return {
      weight: activity.weight,
      tiers: tiers.map((tier) => ({ min_value: tier.min_value, points: tier.points })),
    };
  }

  async computePoints(activityTypeId: number, value: number): Promise<number> {
    const { weight, tiers } = await this.getConfig(activityTypeId);
    return scoreAppearance(tiers, weight, value);
  }

  // Loads every activity's config once. Recompute scores thousands of rows, so config is not reloaded
  // per row — compute() is a pure map lookup + scoreAppearance.
  async buildScorer(): Promise<Scorer> {
    const activities = await this.activityRepo.list();
    const configs = new Map<number, ScoringConfig>();
    for (const activity of activities) {
      const tiers = await this.scoringTierRepo.listByActivity(activity.id);
      configs.set(activity.id, {
        weight: activity.weight,
        tiers: tiers.map((tier) => ({ min_value: tier.min_value, points: tier.points })),
      });
    }

    return {
      compute: (activityTypeId, value) => {
        const config = configs.get(activityTypeId);
        if (!config) throw new Error(`Scorer.compute: unknown activity ${activityTypeId}`);
        return scoreAppearance(config.tiers, config.weight, value);
      },
    };
  }

  // Validates, persists weight + the full tier set, then recomputes all participations from the new config.
  // One combined write (see spec §3 note): the only trigger is the PUT that replaces both, so a single
  // persist + single recompute is done rather than separate updateWeight/replaceTiers each recomputing.
  async replaceScoring(
    activityTypeId: number,
    input: { weight: number; tiers: { min_value: number; points: number }[] },
  ): Promise<void> {
    if (!this.recompute) {
      throw new Error("ScoringService.replaceScoring: recompute not wired (call setRecompute first)");
    }

    validateScoringInput(input);

    // Fails with a clear error if the activity does not exist.
    await this.getConfig(activityTypeId);

    await this.activityRepo.updateWeight(activityTypeId, input.weight);
    await this.scoringTierRepo.replaceForActivity(activityTypeId, input.tiers);
    await this.recompute.run();
  }
}

function validateScoringInput(input: {
  weight: number;
  tiers: { min_value: number; points: number }[];
}): void {
  if (!Number.isFinite(input.weight) || input.weight < 0) {
    throw new Error("Invalid scoring config: weight must be a finite number >= 0");
  }

  let previousMin = -Infinity;
  for (const tier of input.tiers) {
    if (!Number.isFinite(tier.min_value) || tier.min_value < 0) {
      throw new Error("Invalid scoring config: tier min_value must be a finite number >= 0");
    }
    if (!Number.isFinite(tier.points) || tier.points < 0) {
      throw new Error("Invalid scoring config: tier points must be a finite number >= 0");
    }
    if (tier.min_value <= previousMin) {
      throw new Error("Invalid scoring config: tiers must be strictly ascending by min_value");
    }
    previousMin = tier.min_value;
  }
}
