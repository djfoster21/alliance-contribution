import { describe, expect, it } from "vitest";
import { computeMemberDeltas, type SnapshotRank } from "../../src/domain/roster-delta";

const row = (
  member_id: number,
  rn: number,
  captured_on: string,
  power: number | null,
  power_position: number | null,
): SnapshotRank => ({ member_id, rn, captured_on, power, power_position });

describe("computeMemberDeltas", () => {
  it("diffs the latest observation against the member's own previous one", () => {
    const out = computeMemberDeltas([
      row(1, 1, "2026-07-29", 1200, 4),
      row(1, 2, "2026-07-22", 1000, 6),
    ]);
    expect(out).toEqual([
      { member_id: 1, delta_power: 200, delta_position: -2, since: "2026-07-22" },
    ]);
  });

  it("returns nulls for a member with only one observation", () => {
    const out = computeMemberDeltas([row(2, 1, "2026-07-29", 1000, 5)]);
    expect(out).toEqual([
      { member_id: 2, delta_power: null, delta_position: null, since: null },
    ]);
  });

  it("keeps a delta null when either side of it is unreadable", () => {
    // A null power means the cell was unreadable in that capture, NOT zero — subtracting would
    // invent a total power collapse.
    const out = computeMemberDeltas([
      row(3, 1, "2026-07-29", null, 4),
      row(3, 2, "2026-07-22", 1000, null),
    ]);
    expect(out).toEqual([
      { member_id: 3, delta_power: null, delta_position: null, since: "2026-07-22" },
    ]);
  });

  it("handles several members in one pass", () => {
    const out = computeMemberDeltas([
      row(1, 1, "2026-07-29", 1200, 4),
      row(1, 2, "2026-07-22", 1000, 6),
      row(2, 1, "2026-07-29", 900, 9),
    ]);
    expect(out.map((d) => d.member_id)).toEqual([1, 2]);
    expect(out[1].delta_power).toBeNull();
  });

  it("reports a zero delta rather than dropping an unchanged member", () => {
    const out = computeMemberDeltas([
      row(4, 1, "2026-07-29", 1000, 5),
      row(4, 2, "2026-07-22", 1000, 5),
    ]);
    expect(out).toEqual([
      { member_id: 4, delta_power: 0, delta_position: 0, since: "2026-07-22" },
    ]);
  });
});
