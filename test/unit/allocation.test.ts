import { describe, expect, it } from "vitest";
import { computeAllocation, validateTiers, type MetricTotal } from "../../src/domain/allocation";

// Governor names chosen so codepoint order (the tie-break) is obvious.
function totals(...values: [string, number][]): MetricTotal[] {
  return values.map(([governor, value], i) => ({ member_id: i + 1, governor, value }));
}

describe("computeAllocation ranking", () => {
  it("filters zero-metric members, sorts value desc then governor asc, ranks 1-based", () => {
    const { lines } = computeAllocation(
      totals(["Zed", 5], ["Amy", 5], ["Bob", 9], ["Nil", 0]),
      3,
      "top_n",
    );
    expect(lines.map((l) => [l.rank, l.governor, l.metric_value, l.amount])).toEqual([
      [1, "Bob", 9, 1],
      [2, "Amy", 5, 1],
      [3, "Zed", 5, 1],
    ]);
  });

  it("returns no lines and a warning when nobody is eligible", () => {
    const { lines, warnings } = computeAllocation(totals(["Amy", 0]), 5, "top_n");
    expect(lines).toEqual([]);
    expect(warnings.some((w) => /eligible/i.test(w))).toBe(true);
  });

  it("always hands out exactly quantity whenever anyone is eligible (100% rule)", () => {
    const input = totals(["A", 7], ["B", 3], ["C", 2]);
    const cases: [Parameters<typeof computeAllocation>[2], Parameters<typeof computeAllocation>[3]][] = [
      ["top_n", undefined],
      ["proportional", undefined],
      ["tiered", { tiers: [{ fromRank: 1, toRank: 2, amountEach: 1 }] }],
      ["proportional_top", { topCount: 2 }],
    ];
    for (const [strategy, opts] of cases) {
      for (const quantity of [2, 3, 10, 86, 400]) {
        const { lines } = computeAllocation(input, quantity, strategy, opts);
        expect(lines.reduce((sum, l) => sum + l.amount, 0), `${strategy} q${quantity}`).toBe(quantity);
      }
    }
  });
});

describe("computeAllocation top_n", () => {
  it("gives exactly 1 to the top N on an exact fit, no warnings", () => {
    const { lines, warnings } = computeAllocation(totals(["A", 3], ["B", 2], ["C", 1]), 3, "top_n");
    expect(lines.map((l) => l.amount)).toEqual([1, 1, 1]);
    expect(warnings).toEqual([]);
  });

  it("cuts at the boundary and warns when a tie straddles rank N", () => {
    const { lines, warnings } = computeAllocation(
      totals(["A", 10], ["B", 5], ["C", 5], ["D", 1]),
      2,
      "top_n",
    );
    expect(lines.map((l) => [l.governor, l.amount])).toEqual([
      ["A", 1],
      ["B", 1],
    ]);
    expect(warnings.some((w) => /tie/i.test(w))).toBe(true);
  });

  it("redistributes the excess evenly from rank 1 when quantity exceeds the eligible count", () => {
    const { lines, warnings } = computeAllocation(totals(["A", 3], ["B", 2]), 10, "top_n");
    expect(lines.map((l) => l.amount)).toEqual([5, 5]);
    expect(warnings.some((w) => /8/.test(w) && /left/i.test(w))).toBe(true);
  });

  it("gives the uneven remainder of a redistribution to the higher ranks", () => {
    const { lines } = computeAllocation(totals(["A", 3], ["B", 2]), 11, "top_n");
    expect(lines.map((l) => l.amount)).toEqual([6, 5]);
  });
});

describe("computeAllocation proportional", () => {
  it("splits by metric share with largest-remainder rounding, total exactly = quantity", () => {
    // shares: 5.0, 3.333, 1.667 -> base 5+3+1, leftover 1 goes to the .667 remainder
    const { lines, warnings } = computeAllocation(totals(["A", 3], ["B", 2], ["C", 1]), 10, "proportional");
    expect(lines.map((l) => [l.governor, l.amount])).toEqual([
      ["A", 5],
      ["B", 3],
      ["C", 2],
    ]);
    expect(warnings).toEqual([]);
  });

  it("breaks equal remainders by rank ascending and drops zero-amount lines", () => {
    // Equal values: every remainder is 0.5 — ranks 1 and 2 win the two units, 3 and 4 get no line.
    const { lines } = computeAllocation(totals(["A", 5], ["B", 5], ["C", 5], ["D", 5]), 2, "proportional");
    expect(lines.map((l) => [l.rank, l.amount])).toEqual([
      [1, 1],
      [2, 1],
    ]);
  });

  it("always sums exactly to quantity", () => {
    const input = totals(["A", 7], ["B", 3], ["C", 3], ["D", 2], ["E", 1]);
    for (const quantity of [1, 5, 40, 86, 400]) {
      const { lines } = computeAllocation(input, quantity, "proportional");
      expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(quantity);
    }
  });
});

describe("computeAllocation proportional_top", () => {
  it("splits proportionally among only the top N; everyone below gets no line", () => {
    const { lines, warnings } = computeAllocation(
      totals(["A", 3], ["B", 2], ["C", 1]),
      10,
      "proportional_top",
      { topCount: 2 },
    );
    // shares among A+B only: 6, 4
    expect(lines.map((l) => [l.governor, l.amount])).toEqual([
      ["A", 6],
      ["B", 4],
    ]);
    expect(warnings).toEqual([]);
  });

  it("warns when a tie straddles the top-N cutoff", () => {
    const { lines, warnings } = computeAllocation(
      totals(["A", 5], ["B", 3], ["C", 3]),
      10,
      "proportional_top",
      { topCount: 2 },
    );
    expect(lines.map((l) => l.amount)).toEqual([6, 4]);
    expect(warnings.some((w) => /tie/i.test(w))).toBe(true);
  });

  it("truncates topCount at the eligible count and warns", () => {
    const { lines, warnings } = computeAllocation(totals(["A", 3], ["B", 1]), 8, "proportional_top", {
      topCount: 5,
    });
    expect(lines.map((l) => l.amount)).toEqual([6, 2]);
    expect(warnings.some((w) => /truncat/i.test(w))).toBe(true);
  });

  it("drops zero-amount members inside the top N while still summing exactly to quantity", () => {
    const { lines } = computeAllocation(
      totals(["A", 100], ["B", 3], ["C", 1]),
      2,
      "proportional_top",
      { topCount: 3 },
    );
    expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(2);
    expect(lines.every((l) => l.amount > 0)).toBe(true);
  });
});

describe("validateTiers", () => {
  it("accepts bands with gaps under the quantity", () => {
    expect(validateTiers([{ fromRank: 1, toRank: 2, amountEach: 3 }, { fromRank: 5, toRank: 6, amountEach: 1 }], 10)).toEqual([]);
  });

  it("rejects overlapping bands", () => {
    const errors = validateTiers(
      [{ fromRank: 1, toRank: 5, amountEach: 1 }, { fromRank: 5, toRank: 10, amountEach: 1 }],
      20,
    );
    expect(errors.some((e) => /overlap/i.test(e))).toBe(true);
  });

  it("rejects out-of-bounds ranks and non-positive or fractional amounts", () => {
    expect(validateTiers([{ fromRank: 0, toRank: 2, amountEach: 1 }], 10)).not.toEqual([]);
    expect(validateTiers([{ fromRank: 3, toRank: 2, amountEach: 1 }], 10)).not.toEqual([]);
    expect(validateTiers([{ fromRank: 1, toRank: 2, amountEach: 0 }], 10)).not.toEqual([]);
    expect(validateTiers([{ fromRank: 1, toRank: 2, amountEach: 1.5 }], 10)).not.toEqual([]);
    expect(validateTiers([{ fromRank: 1.2, toRank: 2, amountEach: 1 }], 10)).not.toEqual([]);
  });

  it("rejects a nominal total above the quantity", () => {
    // 2 ranks x 3 each = 6 > 5
    const errors = validateTiers([{ fromRank: 1, toRank: 2, amountEach: 3 }], 5);
    expect(errors.some((e) => /quantity/i.test(e))).toBe(true);
  });

  it("rejects an empty band list", () => {
    expect(validateTiers([], 5)).not.toEqual([]);
  });
});

describe("computeAllocation tiered", () => {
  const BANDS = [
    { fromRank: 1, toRank: 2, amountEach: 3 },
    { fromRank: 3, toRank: 5, amountEach: 1 },
  ];

  it("applies bands in rank order and redistributes leftover items from rank 1", () => {
    // 2x3 + 3x1 = 9 handed of 10 -> 1 leftover topped up onto rank 1
    const { lines, warnings } = computeAllocation(
      totals(["A", 9], ["B", 7], ["C", 5], ["D", 3], ["E", 2]),
      10,
      "tiered",
      { tiers: BANDS },
    );
    expect(lines.map((l) => l.amount)).toEqual([4, 3, 1, 1, 1]);
    expect(warnings.some((w) => /1/.test(w) && /left/i.test(w))).toBe(true);
  });

  it("truncates a band past the eligible count, warns, and redistributes the shortfall", () => {
    // band pays 4 of 10 -> leftover 6 spread as +2,+2,+1,+1 from rank 1
    const { lines, warnings } = computeAllocation(
      totals(["A", 9], ["B", 7], ["C", 5], ["D", 3]),
      10,
      "tiered",
      { tiers: [{ fromRank: 1, toRank: 10, amountEach: 1 }] },
    );
    expect(lines.map((l) => l.amount)).toEqual([3, 3, 2, 2]);
    expect(warnings.some((w) => /truncat/i.test(w))).toBe(true);
    expect(warnings.some((w) => /6/.test(w) && /left/i.test(w))).toBe(true);
  });

  it("warns when a tie straddles a band edge", () => {
    // rank 2 and rank 3 share value 5 but land in different bands (3 vs 1 each); 2x3+2x1=8 of 10
    // -> leftover 2 topped up on ranks 1 and 2
    const { lines, warnings } = computeAllocation(
      totals(["A", 9], ["B", 5], ["C", 5], ["D", 2]),
      10,
      "tiered",
      {
        tiers: [
          { fromRank: 1, toRank: 2, amountEach: 3 },
          { fromRank: 3, toRank: 4, amountEach: 1 },
        ],
      },
    );
    expect(lines.map((l) => l.amount)).toEqual([4, 4, 1, 1]);
    expect(warnings.some((w) => /tie/i.test(w))).toBe(true);
  });

  it("warns when a tie straddles the edge of the last band (paid vs unpaid)", () => {
    const { lines, warnings } = computeAllocation(totals(["A", 9], ["B", 5], ["C", 5]), 2, "tiered", {
      tiers: [{ fromRank: 1, toRank: 2, amountEach: 1 }],
    });
    expect(lines.map((l) => [l.governor, l.amount])).toEqual([
      ["A", 1],
      ["B", 1],
    ]);
    expect(warnings.some((w) => /tie/i.test(w))).toBe(true);
  });

  it("leaves items unallocated only when there is nobody to receive them", () => {
    // Bands entirely past the eligible count: zero lines, leftover reported, no top-up possible.
    const { lines, warnings } = computeAllocation(totals(["A", 9], ["B", 5]), 10, "tiered", {
      tiers: [{ fromRank: 5, toRank: 8, amountEach: 1 }],
    });
    expect(lines).toEqual([]);
    expect(warnings.some((w) => /nobody|no recipients/i.test(w))).toBe(true);
  });
});
