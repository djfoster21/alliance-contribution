import { describe, expect, it } from "vitest";
import { computeMemberDeltas, type SnapshotRank } from "../../src/domain/roster-delta";

const row = (
  member_id: number,
  rn: number,
  captured_on: string,
  power: number | null,
  power_position: number | null,
  alliance_rank: string | null = null,
): SnapshotRank => ({ member_id, rn, captured_on, power, power_position, alliance_rank });

describe("computeMemberDeltas", () => {
  it("diffs the latest observation against the member's own previous one", () => {
    const out = computeMemberDeltas([
      row(1, 1, "2026-07-29", 1200, 4),
      row(1, 2, "2026-07-22", 1000, 6),
    ]);
    expect(out).toEqual([
      {
        member_id: 1,
        delta_power: 200,
        delta_position: -2,
        since: "2026-07-22",
        rank_from: null,
        rank_to: null,
      },
    ]);
  });

  it("returns nulls for a member with only one observation", () => {
    const out = computeMemberDeltas([row(2, 1, "2026-07-29", 1000, 5)]);
    expect(out).toEqual([
      {
        member_id: 2,
        delta_power: null,
        delta_position: null,
        since: null,
        rank_from: null,
        rank_to: null,
      },
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
      {
        member_id: 3,
        delta_power: null,
        delta_position: null,
        since: "2026-07-22",
        rank_from: null,
        rank_to: null,
      },
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
      {
        member_id: 4,
        delta_power: 0,
        delta_position: 0,
        since: "2026-07-22",
        rank_from: null,
        rank_to: null,
      },
    ]);
  });

  it("emits the rank pair only for a real change", () => {
    const deltas = computeMemberDeltas([
      { member_id: 1, rn: 1, captured_on: "2030-01-08", alliance_rank: "R4", power: 1, power_position: 1 },
      { member_id: 1, rn: 2, captured_on: "2030-01-01", alliance_rank: "R3", power: 1, power_position: 1 },
    ]);
    expect(deltas[0]).toMatchObject({ rank_from: "R3", rank_to: "R4" });
  });

  it("null rank on either side or no change → null pair", () => {
    const rows = (latest: string | null, prev: string | null) =>
      computeMemberDeltas([
        { member_id: 1, rn: 1, captured_on: "2030-01-08", alliance_rank: latest, power: 1, power_position: 1 },
        { member_id: 1, rn: 2, captured_on: "2030-01-01", alliance_rank: prev, power: 1, power_position: 1 },
      ])[0];
    expect(rows(null, "R2")).toMatchObject({ rank_from: null, rank_to: null });
    expect(rows("R2", null)).toMatchObject({ rank_from: null, rank_to: null });
    expect(rows("R2", "R2")).toMatchObject({ rank_from: null, rank_to: null });
  });

  it("single observation → null pair", () => {
    const deltas = computeMemberDeltas([
      { member_id: 1, rn: 1, captured_on: "2030-01-08", alliance_rank: "R4", power: 1, power_position: 1 },
    ]);
    expect(deltas[0]).toMatchObject({ rank_from: null, rank_to: null });
  });
});
