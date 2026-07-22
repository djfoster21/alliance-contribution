import { describe, expect, it } from "vitest";
import { computeDelta, VERIFY_POWER_RATIO, type DeltaCurrentRow } from "../../src/domain/roster-delta";
import type { MemberSnapshot } from "../../shared/types";

const prev = (member_id: number, captured_on: string, alliance_rank: string | null, power: number | null, power_position: number | null): MemberSnapshot =>
  ({ id: member_id * 100, member_id, captured_on, alliance_rank, power, power_position });

const cur = (member_id: number, governor: string, alliance_rank: string | null, power: number | null, power_position: number | null): DeltaCurrentRow =>
  ({ member_id, governor, alliance_rank, power, power_position });

const empty = { joined: [], departed: [], returned: [] };

// Every verify fixture is DERIVED from VERIFY_POWER_RATIO so the threshold and these tests cannot drift:
// tuning the constant must not silently turn a "flagged" case into an unflagged one.
const BASE = 1000;
const gainOver = (weeks = 1) => Math.round(BASE * (1 + VERIFY_POWER_RATIO * weeks)) + 1;
const gainUnder = (weeks = 1) => Math.round(BASE * (1 + VERIFY_POWER_RATIO * weeks)) - 1;
const dropOver = (weeks = 1) => Math.round(BASE * (1 - VERIFY_POWER_RATIO * weeks)) - 1;

describe("computeDelta", () => {
  it("reports no previous capture on the first import", () => {
    const d = computeDelta({ captured_on: "2026-07-08", current: [cur(1, "Alpha", "R2", 100, 5)], previous: [], ...empty });
    expect(d.previousCapture).toBeNull();
    expect(d.promotions).toEqual([]);
    expect(d.powerMoves).toEqual([]);
  });

  it("classifies an ordinary promotion and demotion", () => {
    const d = computeDelta({
      captured_on: "2026-07-08",
      current: [cur(1, "Alpha", "R3", 100, 5), cur(2, "Bravo", "R1", 100, 6)],
      previous: [prev(1, "2026-07-01", "R2", 100, 5), prev(2, "2026-07-01", "R2", 100, 6)],
      ...empty,
    });
    expect(d.promotions).toEqual([{ member_id: 1, governor: "Alpha", from: "R2", to: "R3", since: "2026-07-01" }]);
    expect(d.demotions).toEqual([{ member_id: 2, governor: "Bravo", from: "R2", to: "R1", since: "2026-07-01" }]);
    expect(d.leadership).toEqual([]);
  });

  it("puts an R3 -> R4 in leadership and NOT in promotions", () => {
    const d = computeDelta({
      captured_on: "2026-07-08",
      current: [cur(1, "Alpha", "R4", 100, 5)],
      previous: [prev(1, "2026-07-01", "R3", 100, 5)],
      ...empty,
    });
    expect(d.leadership).toHaveLength(1);
    expect(d.promotions).toEqual([]);
  });

  it("puts an R5 -> R4 in leadership and NOT in demotions", () => {
    const d = computeDelta({
      captured_on: "2026-07-08",
      current: [cur(1, "Alpha", "R4", 100, 5)],
      previous: [prev(1, "2026-07-01", "R5", 100, 5)],
      ...empty,
    });
    expect(d.leadership).toHaveLength(1);
    expect(d.demotions).toEqual([]);
  });

  // An unreadable rank badge is routine input — the ingest prompt says to omit the cell rather than guess.
  // None of these transitions happened in-game, so none of them may be reported as if they had.
  it("never reports a rank change into or out of an unreadable badge", () => {
    const d = computeDelta({
      captured_on: "2026-07-08",
      current: [cur(1, "Alpha", null, 100, 5), cur(2, "Bravo", "R2", 100, 6), cur(3, "Carol", null, 100, 7)],
      previous: [
        prev(1, "2026-07-01", "R2", 100, 5),  // R2 -> null: not a demotion
        prev(2, "2026-07-01", null, 100, 6),  // null -> R2: not a promotion
        prev(3, "2026-07-01", "R4", 100, 7),  // R4 -> null: not the alliance losing an admin
      ],
      ...empty,
    });
    // soft so a regression reports all three fabrications, not just the first one.
    expect.soft(d.demotions).toEqual([]);
    expect.soft(d.promotions).toEqual([]);
    expect.soft(d.leadership).toEqual([]);
  });

  it("still reports a real change for a member whose badge was readable both times", () => {
    const d = computeDelta({
      captured_on: "2026-07-08",
      current: [cur(1, "Alpha", null, 100, 5), cur(2, "Bravo", "R3", 100, 6)],
      previous: [prev(1, "2026-07-01", "R2", 100, 5), prev(2, "2026-07-01", "R2", 100, 6)],
      ...empty,
    });
    expect(d.promotions).toEqual([{ member_id: 2, governor: "Bravo", from: "R2", to: "R3", since: "2026-07-01" }]);
  });

  it("compares against each member's own baseline across a gap", () => {
    const d = computeDelta({
      captured_on: "2026-07-15",
      current: [cur(1, "Alpha", "R2", 105, 5), cur(2, "Bravo", "R2", 210, 6)],
      previous: [prev(1, "2026-07-08", "R2", 100, 5), prev(2, "2026-07-01", "R2", 200, 6)],
      ...empty,
    });
    expect(d.previousCapture).toBe("2026-07-08");
    const bravo = d.powerMoves.find((p) => p.member_id === 2);
    expect(bravo).toMatchObject({ from: 200, to: 210, delta: 10, since: "2026-07-01", elapsed_days: 14 });
    expect(d.powerMoves.find((p) => p.member_id === 1)?.elapsed_days).toBe(7);
  });

  it("sorts power moves by magnitude and reports position direction", () => {
    const d = computeDelta({
      captured_on: "2026-07-08",
      current: [cur(1, "Alpha", "R2", 110, 3), cur(2, "Bravo", "R2", 500, 1)],
      previous: [prev(1, "2026-07-01", "R2", 100, 5), prev(2, "2026-07-01", "R2", 450, 2)],
      ...empty,
    });
    expect(d.powerMoves.map((p) => p.member_id)).toEqual([2, 1]);
    expect(d.powerMoves[1].delta_position).toBe(-2); // 5 -> 3, moved up
  });

  it("flags an implausible power move for verification without hiding it from powerMoves", () => {
    const d = computeDelta({
      captured_on: "2026-07-08",
      current: [cur(1, "Alpha", "R2", gainOver(), 5), cur(2, "Bravo", "R2", gainUnder(), 6)],
      previous: [prev(1, "2026-07-01", "R2", BASE, 5), prev(2, "2026-07-01", "R2", BASE, 6)],
      ...empty,
    });
    expect(d.verify.map((v) => v.member_id)).toEqual([1]);
    expect(d.powerMoves.map((p) => p.member_id)).toContain(1);
  });

  it("flags a large drop too", () => {
    const d = computeDelta({
      captured_on: "2026-07-08",
      current: [cur(1, "Alpha", "R2", dropOver(), 5)],
      previous: [prev(1, "2026-07-01", "R2", BASE, 5)],
      ...empty,
    });
    expect(d.verify).toHaveLength(1);
  });

  // The whole point of latestPerMemberBefore is that `since` can be many captures back. A flat threshold
  // would flag every member who missed a month and then grew at a perfectly normal rate.
  it("scales the threshold by the elapsed gap instead of assuming one capture interval", () => {
    const sixWeeks = { previous: [prev(1, "2026-07-01", "R2", BASE, 5)], captured_on: "2026-08-12", ...empty };

    const normal = computeDelta({ ...sixWeeks, current: [cur(1, "Alpha", "R2", gainOver(1), 5)] });
    expect(normal.verify).toEqual([]); // a one-week-sized move over six weeks is not suspicious
    expect(normal.powerMoves[0].elapsed_days).toBe(42);

    const wild = computeDelta({ ...sixWeeks, current: [cur(1, "Alpha", "R2", gainOver(6), 5)] });
    expect(wild.verify.map((v) => v.member_id)).toEqual([1]);
  });

  it("never flags a returning member — they were away by definition", () => {
    const d = computeDelta({
      captured_on: "2026-07-08",
      current: [cur(1, "Alpha", "R2", gainOver(), 5)],
      previous: [prev(1, "2026-07-01", "R2", BASE, 5)],
      joined: [],
      departed: [],
      returned: [{ member_id: 1, governor: "Alpha" }],
    });
    expect(d.verify).toEqual([]);
    expect(d.powerMoves).toHaveLength(1); // still reported, just not alarmed on
  });

  // The textbook identity-swap signature: a decoy with no recorded power adopts a live governor name.
  it("flags a jump up from zero power", () => {
    const d = computeDelta({
      captured_on: "2026-07-08",
      current: [cur(1, "Alpha", "R2", 800_000_000, 5)],
      previous: [prev(1, "2026-07-01", "R2", 0, 900)],
      ...empty,
    });
    expect(d.verify.map((v) => v.member_id)).toEqual([1]);
  });

  it("sorts verify by magnitude, like powerMoves", () => {
    const d = computeDelta({
      captured_on: "2026-07-08",
      current: [cur(1, "Alpha", "R2", gainOver(), 5), cur(2, "Bravo", "R2", gainOver() * 10, 6)],
      previous: [prev(1, "2026-07-01", "R2", BASE, 5), prev(2, "2026-07-01", "R2", BASE, 6)],
      ...empty,
    });
    expect(d.verify.map((v) => v.member_id)).toEqual([2, 1]);
  });

  it("never flags a member with no prior power", () => {
    const d = computeDelta({
      captured_on: "2026-07-08",
      current: [cur(1, "Alpha", "R2", 999, 5)],
      previous: [prev(1, "2026-07-01", "R2", null, 5)],
      ...empty,
    });
    expect(d.verify).toEqual([]);
    expect(d.powerMoves).toEqual([]);
  });

  it("passes membership lists straight through", () => {
    const d = computeDelta({
      captured_on: "2026-07-08",
      current: [],
      previous: [],
      joined: [{ member_id: 9, governor: "New" }],
      departed: [{ member_id: 8, governor: "Gone" }],
      returned: [{ member_id: 7, governor: "Back" }],
    });
    expect(d.joined).toEqual([{ member_id: 9, governor: "New" }]);
    expect(d.departed).toEqual([{ member_id: 8, governor: "Gone" }]);
    expect(d.returned).toEqual([{ member_id: 7, governor: "Back" }]);
  });
});
