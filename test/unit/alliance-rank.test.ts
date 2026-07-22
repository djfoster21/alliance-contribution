import { describe, expect, it } from "vitest";
import { rankTone, LEADERSHIP_RANKS } from "../../web/src/lib/alliance-rank";

describe("rankTone", () => {
  it("returns null for an unrecorded rank so callers render nothing", () => {
    expect(rankTone(null)).toBeNull();
  });

  it("gives R4 and R5 the emphasized tone — they are appointed, not earned", () => {
    for (const rank of [...LEADERSHIP_RANKS]) {
      expect(rankTone(rank)).toBe("bg-accent-subtle text-accent");
    }
  });

  it("gives R1-R3 the neutral tone", () => {
    for (const rank of ["R1", "R2", "R3"]) {
      expect(rankTone(rank)).toBe("bg-muted-surface text-muted");
    }
  });

  it("treats an unknown value as neutral rather than throwing", () => {
    // Migration 0004 constrains the column, but a restored backup or hand-run SQL can still land
    // something else in the payload. Rendering it plainly beats crashing the board.
    expect(rankTone("R9")).toBe("bg-muted-surface text-muted");
  });
});
