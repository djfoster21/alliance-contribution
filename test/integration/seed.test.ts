import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ActivityRepo } from "../../src/repositories/activity-repo";
import { ScoringTierRepo } from "../../src/repositories/scoring-tier-repo";

const { DB, SEED_STATEMENTS } = env;

// SEED_STATEMENTS is built once, at vitest config time, by the same buildSeedSql() seed/run.ts uses
// (see vitest.integration.config.ts) — this file runs it against a fresh, migrated D1 and asserts on
// the result via the repos, the same way application code would read it back.
describe("seed pipeline", () => {
  it("seeds the default config and nothing else", async () => {
    for (const stmt of SEED_STATEMENTS) {
      await DB.prepare(stmt).run();
    }

    const activityRepo = new ActivityRepo(DB);
    const tierRepo = new ScoringTierRepo(DB);

    const activities = await activityRepo.list();
    expect(activities.map((a) => ({ key: a.key, weight: a.weight, max_instance: a.max_instance }))).toEqual([
      { key: "bear_trap", weight: 1, max_instance: 2 },
      { key: "contribution", weight: 1, max_instance: 1 },
      { key: "mobilization", weight: 2, max_instance: 1 },
    ]);

    // Exact tier bands per activity, not just a count — catches a min_value/points column swap.
    const expectedTiers = [
      { key: "bear_trap", tiers: [{ min_value: 0, points: 1 }] },
      {
        key: "contribution",
        tiers: [
          { min_value: 0, points: 0 },
          { min_value: 20000, points: 1 },
          { min_value: 60000, points: 2 },
          { min_value: 120000, points: 3 },
        ],
      },
      {
        key: "mobilization",
        tiers: [
          { min_value: 0, points: 0 },
          { min_value: 2000, points: 1 },
          { min_value: 5000, points: 2 },
          { min_value: 10000, points: 3 },
        ],
      },
    ];

    let tierCount = 0;
    for (const expected of expectedTiers) {
      const activity = await activityRepo.getByKey(expected.key);
      if (!activity) throw new Error(`expected activity_types row for "${expected.key}"`);

      const tiers = await tierRepo.listByActivity(activity.id);
      expect(tiers.map((t) => ({ min_value: t.min_value, points: t.points }))).toEqual(expected.tiers);
      tierCount += tiers.length;
    }
    expect(tierCount).toBe(9);

    // Config-only seed: roster, aliases, events, and participations are entered in-app, not seeded.
    for (const table of ["members", "aliases", "events", "participations"]) {
      const row = await DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
      expect(row?.n).toBe(0);
    }
  });
});
