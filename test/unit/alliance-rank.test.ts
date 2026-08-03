import { describe, expect, it } from "vitest";
import { assignBands, rankTone } from "../../web/src/lib/alliance-rank";

describe("rankTone", () => {
  it("returns null for an unrecorded rank so callers render nothing", () => {
    expect(rankTone(null)).toBeNull();
  });

  it("gives each rank its own tone (R5 bold leadership, R4 lighter leadership)", () => {
    expect(rankTone("R5")).toBe("bg-rank5-bg text-rank5-fg");
    expect(rankTone("R4")).toBe("bg-rank4-bg text-rank4-fg");
    expect(rankTone("R3")).toBe("bg-rank3-bg text-rank3-fg");
    expect(rankTone("R2")).toBe("bg-rank2-bg text-rank2-fg");
    expect(rankTone("R1")).toBe("bg-rank1-bg text-rank1-fg");
  });

  it("treats an unknown value as neutral rather than throwing", () => {
    // Migration 0004 constrains the column, but a restored backup or hand-run SQL can still land
    // something else in the payload. Rendering it plainly beats crashing the board.
    expect(rankTone("R9")).toBe("bg-muted-surface text-muted");
  });
});

// Small sizes keep fixtures readable; boundary logic is identical at 30/20.
const B = { top: 2, mid: 2 };
const m = (value: number, rank: string | null = null) => ({ alliance_rank: rank, value });

describe("assignBands", () => {
  it("bands by counted position: top, then mid, then rest", () => {
    expect(assignBands([m(9), m(8), m(7), m(6), m(5)], B)).toEqual(["top", "top", "mid", "mid", "rest"]);
  });

  it("marks R4/R5 leadership and skips them from the count", () => {
    expect(assignBands([m(9, "R5"), m(8), m(7, "R4"), m(6), m(5)], B)).toEqual([
      "leadership", "top", "leadership", "top", "mid",
    ]);
  });

  it("forces zero-value rows to rest even inside the top window", () => {
    // Boards are roster-seeded: the zero tail is alphabetical noise, never "Top N".
    expect(assignBands([m(5), m(0), m(0)], B)).toEqual(["top", "rest", "rest"]);
  });

  it("keeps a tie group in one band across a boundary", () => {
    // Ties share display order only by the alphabetical tiebreak; the band must not split them.
    expect(assignBands([m(9), m(7), m(7), m(7), m(5)], B)).toEqual(["top", "top", "top", "top", "rest"]);
  });

  it("treats a null rank as bandable, not leadership", () => {
    expect(assignBands([m(9, null)], B)).toEqual(["top"]);
  });

  it("handles all-leadership input", () => {
    expect(assignBands([m(9, "R5"), m(8, "R4")], B)).toEqual(["leadership", "leadership"]);
  });

  it("pushes everyone to rest with zero-size bands", () => {
    expect(assignBands([m(9), m(8)], { top: 0, mid: 0 })).toEqual(["rest", "rest"]);
  });

  it("keeps a tie group intact across an interrupting leadership row", () => {
    expect(assignBands([m(7), m(7, "R4"), m(7)], { top: 1, mid: 1 })).toEqual(["top", "leadership", "top"]);
  });
});
