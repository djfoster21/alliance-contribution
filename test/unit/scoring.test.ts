import { describe, expect, it } from "vitest";
import { scoreAppearance, tierPoints, type Tier } from "../../src/domain/scoring";

const CONTRIBUTION_TIERS: Tier[] = [
  { min_value: 0, points: 0 },
  { min_value: 20000, points: 1 },
  { min_value: 60000, points: 2 },
  { min_value: 120000, points: 3 },
];

const MOBILIZATION_TIERS: Tier[] = [
  { min_value: 0, points: 0 },
  { min_value: 2000, points: 1 },
  { min_value: 5000, points: 2 },
  { min_value: 10000, points: 3 },
];

describe("tierPoints", () => {
  it("uses the band when value is exactly on a band edge", () => {
    expect(tierPoints(CONTRIBUTION_TIERS, 20000)).toBe(1);
  });

  it("returns 0 below the lowest band", () => {
    const tiers: Tier[] = [{ min_value: 100, points: 5 }];
    expect(tierPoints(tiers, 50)).toBe(0);
  });

  it("returns the top band for a huge value", () => {
    expect(tierPoints(CONTRIBUTION_TIERS, 1_000_000)).toBe(3);
  });

  it("returns 0 for empty tiers", () => {
    expect(tierPoints([], 100)).toBe(0);
  });

  it("resolves the Contribution ladder just below/at/above each edge", () => {
    expect(tierPoints(CONTRIBUTION_TIERS, 0)).toBe(0);
    expect(tierPoints(CONTRIBUTION_TIERS, 19999)).toBe(0);
    expect(tierPoints(CONTRIBUTION_TIERS, 20000)).toBe(1);
    expect(tierPoints(CONTRIBUTION_TIERS, 20001)).toBe(1);
    expect(tierPoints(CONTRIBUTION_TIERS, 59999)).toBe(1);
    expect(tierPoints(CONTRIBUTION_TIERS, 60000)).toBe(2);
    expect(tierPoints(CONTRIBUTION_TIERS, 60001)).toBe(2);
    expect(tierPoints(CONTRIBUTION_TIERS, 119999)).toBe(2);
    expect(tierPoints(CONTRIBUTION_TIERS, 120000)).toBe(3);
    expect(tierPoints(CONTRIBUTION_TIERS, 120001)).toBe(3);
  });

  it("returns the correct band regardless of input order (unsorted tiers)", () => {
    const shuffled = [...CONTRIBUTION_TIERS].reverse();
    expect(tierPoints(shuffled, 20000)).toBe(1);
    expect(tierPoints(shuffled, 60001)).toBe(2);
    expect(tierPoints(shuffled, 0)).toBe(0);

    const scrambled: Tier[] = [
      { min_value: 60000, points: 2 },
      { min_value: 0, points: 0 },
      { min_value: 120000, points: 3 },
      { min_value: 20000, points: 1 },
    ];
    expect(tierPoints(scrambled, 90000)).toBe(2);
  });
});

describe("scoreAppearance", () => {
  it("multiplies tierPoints by weight for Alliance Mobilization (weight 2)", () => {
    expect(scoreAppearance(MOBILIZATION_TIERS, 2, 0)).toBe(0);
    expect(scoreAppearance(MOBILIZATION_TIERS, 2, 2000)).toBe(2);
    expect(scoreAppearance(MOBILIZATION_TIERS, 2, 5000)).toBe(4);
    expect(scoreAppearance(MOBILIZATION_TIERS, 2, 10000)).toBe(6);
  });

  it("does not round fractional weights", () => {
    const tiers: Tier[] = [{ min_value: 0, points: 1 }];
    expect(scoreAppearance(tiers, 1.5, 0)).toBe(1.5);
  });
});
