import { describe, expect, it } from "vitest";
import type { AttendanceLike, EventLike } from "../../web/src/lib/overview-derive";
import {
  activeRows,
  attendanceSummary,
  atRiskMembers,
  recentEvents,
} from "../../web/src/lib/overview-derive";
import type { AttendanceRow, EventListRow } from "../../shared/types";

// Compile-time pin: the structural types must stay assignable from the real payloads.
const _attendanceContract: AttendanceLike = {} as AttendanceRow;
const _eventContract: EventLike = {} as EventListRow;
void _attendanceContract;
void _eventContract;

const rows = [
  { member_id: 1, governor: "WinterSoul", pct: 1 },
  { member_id: 2, governor: "FrozenThrone", pct: 0.8 },
  { member_id: 3, governor: "CoolHand", pct: 0.14 },
  { member_id: 4, governor: "Hailstorm", pct: 0.24 },
  { member_id: 5, governor: "WinterTide", pct: 0.24 },
];

describe("activeRows", () => {
  const roster = [
    { member_id: 1, governor: "WinterSoul", pct: 1, active: 1 },
    { member_id: 2, governor: "Departed", pct: 0, active: 0 },
    { member_id: 3, governor: "CoolHand", pct: 0.25, active: 1 },
  ];

  it("drops soft-deleted members and keeps the active ones in order", () => {
    expect(activeRows(roster).map((r) => r.member_id)).toEqual([1, 3]);
  });

  it("returns an empty array when every member is deactivated", () => {
    expect(activeRows([{ member_id: 2, governor: "Departed", pct: 0, active: 0 }])).toEqual([]);
  });

  it("returns an empty array for empty input", () => {
    expect(activeRows([])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [...roster];
    activeRows(input);
    expect(input.map((r) => r.member_id)).toEqual([1, 2, 3]);
  });

  // The whole point of the helper: what it returns must drop straight into the other two.
  it("feeds attendanceSummary without the departed member skewing the average", () => {
    expect(attendanceSummary(activeRows(roster))).toEqual({ avgPct: 0.625, perfect: 1, atRisk: 1 });
  });
});

describe("attendanceSummary", () => {
  it("averages pct and counts the perfect and at-risk bands", () => {
    expect(attendanceSummary(rows)).toEqual({ avgPct: 0.484, perfect: 1, atRisk: 3 });
  });

  it("returns zeros for an empty roster rather than NaN", () => {
    expect(attendanceSummary([])).toEqual({ avgPct: 0, perfect: 0, atRisk: 0 });
  });

  it("treats exactly 50% as safe, not at risk", () => {
    const summary = attendanceSummary([{ member_id: 1, governor: "Edge", pct: 0.5 }]);
    expect(summary.atRisk).toBe(0);
  });

  // Pinned intentionally: a populated roster with zero events (stats-service.ts yields pct: 0 for
  // everyone) is the real degenerate case in production, not the empty-array guard above. This
  // module reports it as everyone-at-risk; gating that display belongs to the caller, not here.
  it("reports every member at risk when the whole roster is at 0% (no events yet)", () => {
    const noEvents = [
      { member_id: 1, governor: "A", pct: 0 },
      { member_id: 2, governor: "B", pct: 0 },
      { member_id: 3, governor: "C", pct: 0 },
    ];
    expect(attendanceSummary(noEvents)).toEqual({ avgPct: 0, perfect: 0, atRisk: 3 });
  });
});

describe("atRiskMembers", () => {
  it("returns only sub-50% members, worst first, capped at the limit", () => {
    expect(atRiskMembers(rows, 2)).toEqual([
      { member_id: 3, governor: "CoolHand", pct: 0.14 },
      { member_id: 4, governor: "Hailstorm", pct: 0.24 },
    ]);
  });

  it("breaks pct ties on governor so the list is stable across renders", () => {
    const tied = atRiskMembers(
      [
        { member_id: 5, governor: "WinterTide", pct: 0.24 },
        { member_id: 4, governor: "Hailstorm", pct: 0.24 },
      ],
      5,
    );
    expect(tied.map((r) => r.governor)).toEqual(["Hailstorm", "WinterTide"]);
  });

  it("returns an empty array when nobody is at risk", () => {
    expect(atRiskMembers([{ member_id: 1, governor: "Solid", pct: 0.9 }], 4)).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [...rows];
    atRiskMembers(input, 5);
    expect(input.map((r) => r.member_id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns an empty array when the limit is 0", () => {
    expect(atRiskMembers(rows, 0)).toEqual([]);
  });
});

describe("recentEvents", () => {
  const events = [
    { id: 1, date: "2026-07-19", instance: 1 },
    { id: 2, date: "2026-07-19", instance: 2 },
    { id: 3, date: "2026-07-21", instance: 1 },
    { id: 4, date: "2026-07-21", instance: 2 },
  ];

  it("orders newest date first, then highest instance, capped at the limit", () => {
    expect(recentEvents(events, 3).map((e) => e.id)).toEqual([4, 3, 2]);
  });

  it("does not mutate the input array", () => {
    const input = [...events];
    recentEvents(input, 2);
    expect(input.map((e) => e.id)).toEqual([1, 2, 3, 4]);
  });

  it("returns an empty array for no events", () => {
    expect(recentEvents([], 5)).toEqual([]);
  });

  it("returns an empty array when the limit is 0", () => {
    expect(recentEvents(events, 0)).toEqual([]);
  });

  // Same (date, instance) is the normal case in production: events are only UNIQUE on
  // (activity_type_id, date, instance), so a bear_trap and a contribution ingested the same day both
  // carry instance 1. The higher id (later insert) must win the tie.
  it("breaks a (date, instance) tie on id, newest insert first", () => {
    const tied = [
      { id: 10, date: "2026-07-21", instance: 1 },
      { id: 11, date: "2026-07-21", instance: 1 },
    ];
    expect(recentEvents(tied, 2).map((e) => e.id)).toEqual([11, 10]);
  });

  // A backfilled screenshot gets a high id but an old date. Ordering must key on date first, not on
  // insert order — the `events` fixture above has id and (date, instance) perfectly correlated, so
  // this is the only case that would catch a comparator collapsed to `b.id - a.id`.
  it("orders by date, not by id, when a high id lands on an old date", () => {
    const backfilled = [...events, { id: 99, date: "2026-06-01", instance: 1 }];
    expect(recentEvents(backfilled, 5).map((e) => e.id)).toEqual([4, 3, 2, 1, 99]);
  });
});
