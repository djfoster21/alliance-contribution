import { describe, expect, it } from "vitest";
import { buildSeedSql } from "../../seed/sql";

describe("buildSeedSql", () => {
  const stmts = buildSeedSql();

  it("builds exactly one insert per config table", () => {
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toMatch(/^INSERT INTO activity_types /);
    expect(stmts[1]).toMatch(/^INSERT INTO scoring_tiers /);
  });

  it("seeds the three default activity types with correct weights and instance caps", () => {
    const [activityTypes] = stmts;
    // (id, key, name, unit_label, weight, max_instance, min_value, active, sort, color)
    expect(activityTypes).toContain("(1, 'bear_trap', 'Bear Trap', 'Damage', 1, 2, 0, 1, 1, 'blue')");
    expect(activityTypes).toContain(
      "(2, 'contribution', 'Contribution', 'Contribution', 1, 1, 0, 1, 2, 'green')",
    );
    expect(activityTypes).toContain(
      "(3, 'mobilization', 'Alliance Mobilization', 'Personal Points', 2, 1, 0, 1, 3, 'violet')",
    );
  });

  it("seeds the nine default scoring tiers (docs/specs/02_scoring.md §1)", () => {
    const tiers = stmts[1];
    // (activity_type_id, min_value, points)
    expect(tiers).toContain("(1, 0, 1)"); // bear_trap: flat 1/appearance
    expect(tiers).toContain("(2, 0, 0)");
    expect(tiers).toContain("(2, 20000, 1)");
    expect(tiers).toContain("(2, 60000, 2)");
    expect(tiers).toContain("(2, 120000, 3)");
    expect(tiers).toContain("(3, 0, 0)");
    expect(tiers).toContain("(3, 2000, 1)");
    expect(tiers).toContain("(3, 5000, 2)");
    expect(tiers).toContain("(3, 10000, 3)");
    expect(tiers?.match(/\(\d+, \d+, \d+\)/g)).toHaveLength(9);
  });
});
