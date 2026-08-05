import { describe, expect, it } from "vitest";
import {
  buildRosterRows,
  captureRosterInput,
  type CaptureRosterRowLike,
  type RosterMember,
} from "../../web/src/lib/roster-view";

/** Minimal member; every test overrides only what it cares about. */
function member(over: Partial<RosterMember> = {}): RosterMember {
  return {
    id: 1,
    governor: "Aurora",
    alliance_rank: "R4",
    power: 100,
    power_position: 3,
    active: 1,
    ...over,
  };
}

describe("buildRosterRows", () => {
  it("marks a member with no attendance data as unknown, not at risk", () => {
    const rows = buildRosterRows({ members: [member()], deltas: new Map(), attendance: null });
    expect(rows[0].status).toBe("unknown");
    expect(rows[0].attendance).toBeNull();
  });

  it("marks an inactive member inactive regardless of attendance", () => {
    const rows = buildRosterRows({
      members: [member({ active: 0 })],
      deltas: new Map(),
      attendance: new Map([[1, 0.9]]),
    });
    expect(rows[0].status).toBe("inactive");
  });

  it("marks an active member below the attendance threshold at risk", () => {
    const rows = buildRosterRows({
      members: [member()],
      deltas: new Map(),
      attendance: new Map([[1, 0.49]]),
    });
    expect(rows[0].status).toBe("at-risk");
  });

  it("treats exactly the threshold as active", () => {
    const rows = buildRosterRows({
      members: [member()],
      deltas: new Map(),
      attendance: new Map([[1, 0.5]]),
    });
    expect(rows[0].status).toBe("active");
  });

  it("treats an active member missing from a loaded attendance map as zero attendance", () => {
    const rows = buildRosterRows({ members: [member()], deltas: new Map(), attendance: new Map() });
    expect(rows[0].attendance).toBe(0);
    expect(rows[0].status).toBe("at-risk");
  });

  it("inverts delta_position into places gained", () => {
    const rows = buildRosterRows({
      members: [member()],
      deltas: new Map([[1, { member_id: 1, delta_power: 500, delta_position: -3, since: "2026-07-22" }]]),
      attendance: new Map([[1, 1]]),
    });
    expect(rows[0].move).toBe(3);
    expect(rows[0].deltaPower).toBe(500);
  });

  it("keeps a null delta null — no prior observation is not zero change", () => {
    const rows = buildRosterRows({
      members: [member()],
      deltas: new Map([[1, { member_id: 1, delta_power: null, delta_position: null, since: null }]]),
      attendance: new Map([[1, 1]]),
    });
    expect(rows[0].deltaPower).toBeNull();
    expect(rows[0].move).toBeNull();
  });

  it("keeps a zero delta as zero, distinct from null", () => {
    const rows = buildRosterRows({
      members: [member()],
      deltas: new Map([[1, { member_id: 1, delta_power: 0, delta_position: 0, since: "2026-07-22" }]]),
      attendance: new Map([[1, 1]]),
    });
    expect(rows[0].deltaPower).toBe(0);
    expect(rows[0].move).toBe(0);
  });

  it("renders a member absent from the delta map with null deltas", () => {
    const rows = buildRosterRows({ members: [member()], deltas: new Map(), attendance: new Map([[1, 1]]) });
    expect(rows[0].deltaPower).toBeNull();
    expect(rows[0].move).toBeNull();
  });

  it("preserves the caller's own member type on the row", () => {
    const rich = { ...member(), created_at: "2026-01-01", updated_at: "2026-01-02" };
    const rows = buildRosterRows({ members: [rich], deltas: new Map(), attendance: null });
    // Compile-time assertion: the extra fields must survive, or the page cannot pass rows to its
    // Member-typed action handlers.
    expect(rows[0].member.created_at).toBe("2026-01-01");
  });

  it("carries a rank change through to the row", () => {
    const deltas = new Map([[1, { member_id: 1, delta_power: 5, delta_position: 0, since: "2030-01-01", rank_from: "R3", rank_to: "R4" }]]);
    const rows = buildRosterRows({ members: [member()], deltas, attendance: null });
    expect(rows[0].rankChange).toEqual({ from: "R3", to: "R4" });
  });

  it("no rank pair → null rankChange (incl. historical adapter rows)", () => {
    const input = captureRosterInput([captureRow({})]);
    const rows = buildRosterRows({ ...input, attendance: null });
    expect(rows[0].rankChange).toBeNull();
  });
});

import { filterRows, sortRows, type RosterRow } from "../../web/src/lib/roster-view";

/** A row built by hand — these tests are about ordering, not derivation. */
function row(over: Partial<RosterMember> & { move?: number | null; deltaPower?: number | null }): RosterRow {
  const { move = null, deltaPower = null, ...memberOver } = over;
  return {
    member: member(memberOver),
    deltaPower,
    move,
    attendance: 1,
    status: memberOver.active === 0 ? "inactive" : "active",
    rankChange: null,
  };
}

describe("filterRows", () => {
  const rows = [row({ id: 1, active: 1 }), row({ id: 2, active: 0 })];

  it("keeps only active members on the active filter", () => {
    expect(filterRows(rows, "active").map((r) => r.member.id)).toEqual([1]);
  });

  it("keeps only inactive members on the inactive filter", () => {
    expect(filterRows(rows, "inactive").map((r) => r.member.id)).toEqual([2]);
  });

  it("keeps everyone on the all filter", () => {
    expect(filterRows(rows, "all").map((r) => r.member.id)).toEqual([1, 2]);
  });
});

describe("sortRows", () => {
  it("sorts by power descending", () => {
    const rows = [row({ id: 1, power: 10 }), row({ id: 2, power: 50 }), row({ id: 3, power: 30 })];
    expect(sortRows(rows, "power").map((r) => r.member.id)).toEqual([2, 3, 1]);
  });

  it("sinks a null power to the bottom of the power sort", () => {
    const rows = [row({ id: 1, power: null }), row({ id: 2, power: 10 })];
    expect(sortRows(rows, "power").map((r) => r.member.id)).toEqual([2, 1]);
  });

  it("sorts by tier R5 first, breaking ties on power", () => {
    const rows = [
      row({ id: 1, alliance_rank: "R3", power: 90 }),
      row({ id: 2, alliance_rank: "R5", power: 10 }),
      row({ id: 3, alliance_rank: "R3", power: 95 }),
    ];
    expect(sortRows(rows, "tier").map((r) => r.member.id)).toEqual([2, 3, 1]);
  });

  it("sinks an unknown rank below R1 in the tier sort", () => {
    const rows = [row({ id: 1, alliance_rank: null }), row({ id: 2, alliance_rank: "R1" })];
    expect(sortRows(rows, "tier").map((r) => r.member.id)).toEqual([2, 1]);
  });

  it("sorts movers by absolute power change, biggest first", () => {
    const rows = [
      row({ id: 1, deltaPower: 100 }),
      row({ id: 2, deltaPower: -900 }),
      row({ id: 3, deltaPower: 400 }),
    ];
    expect(sortRows(rows, "movers").map((r) => r.member.id)).toEqual([2, 3, 1]);
  });

  it("sinks a null delta below a zero delta in the movers sort", () => {
    const rows = [row({ id: 1, deltaPower: null }), row({ id: 2, deltaPower: 0 })];
    expect(sortRows(rows, "movers").map((r) => r.member.id)).toEqual([2, 1]);
  });

  it("sorts by name with a locale compare", () => {
    const rows = [row({ id: 1, governor: "zeta" }), row({ id: 2, governor: "Alpha" })];
    expect(sortRows(rows, "name").map((r) => r.member.id)).toEqual([2, 1]);
  });

  it("does not mutate the input array", () => {
    const rows = [row({ id: 1, power: 10 }), row({ id: 2, power: 50 })];
    sortRows(rows, "power");
    expect(rows.map((r) => r.member.id)).toEqual([1, 2]);
  });
});

import { rosterScales, summarizeRoster, topPowerIds } from "../../web/src/lib/roster-view";

describe("summarizeRoster", () => {
  it("sums power and deltas, skipping nulls", () => {
    const rows = [
      row({ id: 1, power: 100, deltaPower: 10 }),
      row({ id: 2, power: null, deltaPower: null }),
      row({ id: 3, power: 50, deltaPower: -4 }),
    ];
    const s = summarizeRoster(rows);
    expect(s.totalPower).toBe(150);
    expect(s.powerDelta).toBe(6);
  });

  it("excludes deactivated members from every total", () => {
    const rows = [row({ id: 1, power: 100, deltaPower: 10 }), row({ id: 2, active: 0, power: 900, deltaPower: -50 })];
    const s = summarizeRoster(rows);
    expect(s.totalPower).toBe(100);
    expect(s.powerDelta).toBe(10);
    expect(s.dropped).toBe(0);
    expect(s.tracked).toBe(1);
  });

  it("counts gained and dropped, excluding zero and null", () => {
    const rows = [
      row({ id: 1, deltaPower: 10 }),
      row({ id: 2, deltaPower: -4 }),
      row({ id: 3, deltaPower: 0 }),
      row({ id: 4, deltaPower: null }),
      row({ id: 5, deltaPower: 7 }),
    ];
    const s = summarizeRoster(rows);
    expect(s.gained).toBe(2);
    expect(s.dropped).toBe(1);
  });

  it("counts at-risk rows and tracked members", () => {
    const rows: RosterRow[] = [
      { ...row({ id: 1 }), status: "at-risk" },
      { ...row({ id: 2 }), status: "active" },
      { ...row({ id: 3 }), status: "at-risk" },
    ];
    const s = summarizeRoster(rows);
    expect(s.atRisk).toBe(2);
    expect(s.tracked).toBe(3);
  });
});

describe("rosterScales", () => {
  it("returns the largest power and the largest absolute delta", () => {
    const rows = [row({ id: 1, power: 100, deltaPower: 10 }), row({ id: 2, power: 900, deltaPower: -4000 })];
    expect(rosterScales(rows)).toEqual({ maxPower: 900, maxAbsDelta: 4000 });
  });

  it("returns zero scales for an empty roster rather than -Infinity", () => {
    expect(rosterScales([])).toEqual({ maxPower: 0, maxAbsDelta: 0 });
  });

  it("ignores nulls when finding the maxima", () => {
    const rows = [row({ id: 1, power: null, deltaPower: null }), row({ id: 2, power: 5, deltaPower: -2 })];
    expect(rosterScales(rows)).toEqual({ maxPower: 5, maxAbsDelta: 2 });
  });

  it("ignores deactivated members, whose power is frozen at whatever it was when they left", () => {
    const rows = [row({ id: 1, power: 5, deltaPower: -2 }), row({ id: 2, active: 0, power: 999, deltaPower: 999 })];
    expect(rosterScales(rows)).toEqual({ maxPower: 5, maxAbsDelta: 2 });
  });
});

describe("topPowerIds", () => {
  it("returns the ids of the n strongest active members", () => {
    const rows = [
      row({ id: 1, power: 10 }),
      row({ id: 2, power: 50 }),
      row({ id: 3, power: 30 }),
      row({ id: 4, power: 40 }),
    ];
    expect([...topPowerIds(rows, 2)]).toEqual([2, 4]);
  });

  it("skips members with no power reading rather than ranking them as zero", () => {
    const rows = [row({ id: 1, power: null }), row({ id: 2, power: 10 })];
    expect([...topPowerIds(rows, 2)]).toEqual([2]);
  });

  it("skips deactivated members so a departed whale does not hold a top slot", () => {
    const rows = [row({ id: 1, active: 0, power: 999 }), row({ id: 2, power: 10 })];
    expect([...topPowerIds(rows, 2)]).toEqual([2]);
  });
});

describe("sortRows by status", () => {
  /** `row()` derives status from the active flag, so these override it directly. */
  function statusRow(id: number, status: RosterRow["status"], power = 0): RosterRow {
    return { ...row({ id, power, active: status === "inactive" ? 0 : 1 }), status };
  }

  it("floats the members needing attention and sinks the ones who have left", () => {
    const rows = [
      statusRow(1, "inactive"),
      statusRow(2, "active"),
      statusRow(3, "at-risk"),
      statusRow(4, "unknown"),
    ];
    expect(sortRows(rows, "status").map((r) => r.member.id)).toEqual([3, 4, 2, 1]);
  });

  it("breaks ties on power, strongest first", () => {
    const rows = [statusRow(1, "at-risk", 10), statusRow(2, "at-risk", 90), statusRow(3, "at-risk", 50)];
    expect(sortRows(rows, "status").map((r) => r.member.id)).toEqual([2, 3, 1]);
  });

  it("sinks a member with no power reading below their same-status peers", () => {
    const rows = [statusRow(1, "at-risk"), statusRow(2, "at-risk", 10)];
    rows[0] = { ...rows[0], member: { ...rows[0].member, power: null } };
    expect(sortRows(rows, "status").map((r) => r.member.id)).toEqual([2, 1]);
  });

  it("does not mutate the input array", () => {
    const rows = [statusRow(1, "inactive"), statusRow(2, "at-risk")];
    sortRows(rows, "status");
    expect(rows.map((r) => r.member.id)).toEqual([1, 2]);
  });
});

const captureRow = (over: Partial<CaptureRosterRowLike>): CaptureRosterRowLike => ({
  member_id: 1,
  governor: "Alpha",
  alliance_rank: "R2",
  power: 100,
  power_position: 3,
  delta_power: 10,
  delta_position: -2,
  since: "2031-01-01",
  ...over,
});

describe("captureRosterInput", () => {
  it("adapts capture rows to buildRosterRows input", () => {
    const input = captureRosterInput([
      captureRow({}),
      captureRow({ member_id: 2, governor: "Bravo", delta_power: null, delta_position: null, since: null }),
    ]);

    expect(input.members).toEqual([
      { id: 1, governor: "Alpha", alliance_rank: "R2", power: 100, power_position: 3, active: 1 },
      { id: 2, governor: "Bravo", alliance_rank: "R2", power: 100, power_position: 3, active: 1 },
    ]);
    expect(input.deltas.get(1)).toEqual({ member_id: 1, delta_power: 10, delta_position: -2, since: "2031-01-01" });
    expect(input.deltas.get(2)).toEqual({ member_id: 2, delta_power: null, delta_position: null, since: null });
  });

  it("feeds buildRosterRows: observed row moves up, attendance null → unknown status", () => {
    const rows = buildRosterRows({ ...captureRosterInput([captureRow({})]), attendance: null });
    expect(rows).toHaveLength(1);
    expect(rows[0].deltaPower).toBe(10);
    expect(rows[0].move).toBe(2); // delta_position -2 = moved up 2 places
    expect(rows[0].status).toBe("unknown"); // renders as a dash
  });
});
