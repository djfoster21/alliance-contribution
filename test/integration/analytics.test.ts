import { SELF } from "cloudflare:test";
import { VIEWER } from "./keys";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { createServices } from "../../src/services";

const { DB, SEED_STATEMENTS } = env;

const AUTH = { "X-Api-Key": "test-key" };

// Fresh migrated D1 per file; storage NOT reset between `it` blocks — every test uses distinct member
// governors, dates, and raw names so writes from one test never collide with another. Seed default scoring
// config so ingested participations score. The movement-null test intentionally uses the file's earliest
// dates (2025) so its week is the globally earliest event-week; the movement test uses two consecutive
// weeks (dates 7 days apart) so the prior week is deterministic regardless of other tests' events.
beforeAll(async () => {
  for (const stmt of SEED_STATEMENTS) {
    await DB.prepare(stmt).run();
  }
});

// Creates a member and returns the id; raw_name === governor resolves directly (governor is identity).
async function seedMember(governor: string): Promise<number> {
  const { memberService } = createServices(DB);
  const member = await memberService.create({ governor });
  return member.id;
}

describe("StatsService.weeklyRanking", () => {
  it("ranks members by weekly score with a per-activity breakdown (hand check)", async () => {
    const { eventService, statsService } = createServices(DB);
    await seedMember("Rank_Alice");
    await seedMember("Rank_Bob");

    // Same date -> same ISO week; contribution (weight 1) + mobilization (weight 2).
    const date = "2027-01-11";
    const ev = await eventService.create({
      activity: "contribution",
      date,
      rows: [
        { raw_name: "Rank_Alice", value: 60000 }, // tier 2
        { raw_name: "Rank_Bob", value: 25000 }, // tier 1
      ],
    });
    await eventService.create({
      activity: "mobilization",
      date,
      rows: [{ raw_name: "Rank_Alice", value: 5000 }], // tier 2 x weight 2 = 4
    });

    const ranking = await statsService.weeklyRanking(ev.event.week);
    const alice = ranking.rows.find((r) => r.governor === "Rank_Alice");
    const bob = ranking.rows.find((r) => r.governor === "Rank_Bob");

    expect(alice?.rank).toBe(1);
    expect(alice?.score).toBe(6); // contribution 2 + mobilization 4
    expect(alice?.breakdown).toEqual({ contribution: 2, mobilization: 4 });
    expect(bob?.rank).toBe(2);
    expect(bob?.score).toBe(1);
    expect(bob?.breakdown).toEqual({ contribution: 1 });
    // Ranked order: higher score first.
    const order = ranking.rows.map((r) => r.governor);
    expect(order.indexOf("Rank_Alice")).toBeLessThan(order.indexOf("Rank_Bob"));
  });

  it("breaks ties by governor ascending", async () => {
    const { eventService, statsService } = createServices(DB);
    await seedMember("Tie_Alpha");
    await seedMember("Tie_Bravo");

    const ev = await eventService.create({
      activity: "contribution",
      date: "2027-02-08",
      rows: [
        { raw_name: "Tie_Bravo", value: 60000 }, // tier 2
        { raw_name: "Tie_Alpha", value: 60000 }, // tier 2 — equal score
      ],
    });

    const ranking = await statsService.weeklyRanking(ev.event.week);
    const tied = ranking.rows.filter((r) => r.governor.startsWith("Tie_"));
    expect(tied.map((r) => r.governor)).toEqual(["Tie_Alpha", "Tie_Bravo"]);
    expect(tied[0].rank).toBeLessThan(tied[1].rank);
    expect(tied[0].score).toBe(tied[1].score);
  });

  it("computes movement across two weeks (prevRank - rank; positive = up)", async () => {
    const { eventService, statsService } = createServices(DB);
    await seedMember("Mv_Up");
    await seedMember("Mv_Down");
    await seedMember("Mv_New");

    // Week A: Down leads (rank 1), Up trails (rank 2).
    const weekA = (
      await eventService.create({
        activity: "contribution",
        date: "2027-09-06",
        rows: [
          { raw_name: "Mv_Down", value: 60000 }, // tier 2
          { raw_name: "Mv_Up", value: 25000 }, // tier 1
        ],
      })
    ).event.week;

    // Week B (7 days later = next ISO week): they swap; Mv_New appears for the first time.
    const weekB = (
      await eventService.create({
        activity: "contribution",
        date: "2027-09-13",
        rows: [
          { raw_name: "Mv_Up", value: 60000 }, // tier 2 -> rank 1
          { raw_name: "Mv_Down", value: 25000 }, // tier 1 -> rank 2
          { raw_name: "Mv_New", value: 100 }, // tier 0 -> rank 3
        ],
      })
    ).event.week;

    expect(weekB > weekA).toBe(true);

    const ranking = await statsService.weeklyRanking(weekB);
    const up = ranking.rows.find((r) => r.governor === "Mv_Up");
    const down = ranking.rows.find((r) => r.governor === "Mv_Down");
    const fresh = ranking.rows.find((r) => r.governor === "Mv_New");

    expect(up?.rank).toBe(1);
    expect(up?.movement).toBe(1); // rank 2 -> 1, moved up
    expect(down?.rank).toBe(2);
    expect(down?.movement).toBe(-1); // rank 1 -> 2, moved down
    // Roster-wide boards: Mv_New existed during week A too, so it was ranked (at 0) and movement is a number.
    expect(typeof fresh?.movement).toBe("number");
  });

  it("returns null movement for every row of the earliest week (no prior week has events)", async () => {
    const { eventService, statsService } = createServices(DB);
    await seedMember("Early_Solo");

    // 2025 is the earliest date used in this file -> its week is the globally earliest event-week.
    const ev = await eventService.create({
      activity: "contribution",
      date: "2025-06-02",
      rows: [{ raw_name: "Early_Solo", value: 25000 }],
    });

    const ranking = await statsService.weeklyRanking(ev.event.week);
    expect(ranking.rows.length).toBeGreaterThan(0);
    expect(ranking.rows.every((r) => r.movement === null)).toBe(true);
  });

  it("defaults to the latest week when none is given", async () => {
    const { statsService } = createServices(DB);
    const ranking = await statsService.weeklyRanking();
    expect(typeof ranking.week).toBe("string");
    expect(Array.isArray(ranking.rows)).toBe(true);
  });

  it("includes active zero-point members and hides all inactive members, scorers included", async () => {
    const { eventService, statsService } = createServices(DB);
    const scorerId = await seedMember("Zr_Scorer");
    await seedMember("Zr_ActiveZero");
    const inactiveZeroId = await seedMember("Zr_InactiveZero");
    const inactiveScoredId = await seedMember("Zr_InactiveScored");

    const ev = await eventService.create({
      activity: "contribution",
      date: "2027-06-07",
      rows: [
        { raw_name: "Zr_Scorer", value: 60000 }, // tier 2
        { raw_name: "Zr_InactiveScored", value: 25000 }, // tier 1
      ],
    });
    // Deactivate directly in SQL (identity-only test setup, no service round-trip needed).
    await DB.prepare("UPDATE members SET active = 0 WHERE id IN (?, ?)")
      .bind(inactiveZeroId, inactiveScoredId)
      .run();

    const ranking = await statsService.weeklyRanking(ev.event.week);
    const governors = ranking.rows.map((r) => r.governor);

    expect(governors).toContain("Zr_Scorer");
    expect(governors).toContain("Zr_ActiveZero"); // active, zero points -> included at 0
    expect(governors).not.toContain("Zr_InactiveScored"); // inactive -> hidden even with points
    expect(governors).not.toContain("Zr_InactiveZero"); // inactive, never scored -> hidden

    const zero = ranking.rows.find((r) => r.governor === "Zr_ActiveZero");
    expect(zero?.score).toBe(0);
    expect(zero?.breakdown).toEqual({});
    expect(typeof zero?.rank).toBe("number");
    expect(scorerId).toBeGreaterThan(0);
  });

  it("filters the board to a single activity when activityKey is given", async () => {
    const { eventService, statsService } = createServices(DB);
    await seedMember("Filt_Alice");
    await seedMember("Filt_Bob");
    const date = "2027-02-08";
    await eventService.create({
      activity: "contribution",
      date,
      rows: [
        { raw_name: "Filt_Alice", value: 25000 },
        { raw_name: "Filt_Bob", value: 60000 },
      ],
    });
    const ev = await eventService.create({
      activity: "mobilization",
      date,
      rows: [{ raw_name: "Filt_Alice", value: 5000 }],
    });

    const all = await statsService.weeklyRanking(ev.event.week);
    const contribOnly = await statsService.weeklyRanking(ev.event.week, "contribution");

    const aliceAll = all.rows.find((r) => r.governor === "Filt_Alice");
    const aliceContrib = contribOnly.rows.find((r) => r.governor === "Filt_Alice");
    expect(aliceAll?.breakdown.mobilization).toBeGreaterThan(0);
    expect(aliceContrib?.breakdown.mobilization).toBeUndefined();
    expect(aliceContrib?.score).toBe(aliceContrib?.breakdown.contribution);
  });

  it("computes activity-filtered movement against the prior week that had that activity", async () => {
    const { eventService, statsService } = createServices(DB);
    await seedMember("Mv_Ann");
    await seedMember("Mv_Bo");

    // Week A: contribution — Bo outscores Ann (Bo #1, Ann #2).
    await eventService.create({
      activity: "contribution",
      date: "2027-03-01", // three distinct, consecutive ISO weeks
      rows: [
        { raw_name: "Mv_Ann", value: 25000 },
        { raw_name: "Mv_Bo", value: 60000 },
      ],
    });
    // Week B: a DIFFERENT activity only (no contribution this week).
    await eventService.create({
      activity: "mobilization",
      date: "2027-03-08",
      rows: [{ raw_name: "Mv_Ann", value: 5000 }],
    });
    // Week C: contribution again — Ann now outscores Bo (Ann #1, Bo #2) => real swap vs Week A.
    const wc = await eventService.create({
      activity: "contribution",
      date: "2027-03-15",
      rows: [
        { raw_name: "Mv_Ann", value: 60000 },
        { raw_name: "Mv_Bo", value: 25000 },
      ],
    });

    const board = await statsService.weeklyRanking(wc.event.week, "contribution");
    const ann = board.rows.find((r) => r.governor === "Mv_Ann");
    const bo = board.rows.find((r) => r.governor === "Mv_Bo");
    // Prior contribution week is Week A (NOT the intervening mobilization-only Week B).
    // Ann went 2 -> 1 (movement +1), Bo went 1 -> 2 (movement -1).
    expect(ann?.rank).toBe(1);
    expect(ann?.movement).toBe(1);
    expect(bo?.rank).toBe(2);
    expect(bo?.movement).toBe(-1);
  });

  // The 2029 dates below are the latest in this file, so the bear-only week is the globally latest
  // event-week — which is exactly what the activity-aware default must NOT pick for mobilization.
  it("flags hasEvents false (no zero-seeded board) for a week without the filtered activity", async () => {
    const { eventService, statsService } = createServices(DB);
    await seedMember("NoEv_Bear");

    const bearWeek = (
      await eventService.create({
        activity: "bear_trap",
        date: "2029-01-08",
        rows: [{ raw_name: "NoEv_Bear", value: 100 }],
      })
    ).event.week;

    const mobBoard = await statsService.weeklyRanking(bearWeek, "mobilization");
    expect(mobBoard.hasEvents).toBe(false);
    expect(mobBoard.rows).toEqual([]);
    expect(mobBoard.possible).toBe(0);
    expect(mobBoard.week).toBe(bearWeek);

    // Same week, the activity it does have -> a real board.
    const bearBoard = await statsService.weeklyRanking(bearWeek, "bear_trap");
    expect(bearBoard.hasEvents).toBe(true);
    expect(bearBoard.rows.find((r) => r.governor === "NoEv_Bear")?.score).toBe(1);
  });

  it("defaults to the latest week that has the filtered activity, not the latest week overall", async () => {
    const { eventService, statsService } = createServices(DB);
    await seedMember("DefEv_Mob");

    const mobWeek = (
      await eventService.create({
        activity: "mobilization",
        date: "2029-01-15", // the week AFTER the bear-only week above
        rows: [{ raw_name: "DefEv_Mob", value: 5000 }],
      })
    ).event.week;
    const bearOnlyWeek = (
      await eventService.create({
        activity: "bear_trap",
        date: "2029-01-22", // latest event-week in the file from here on
        rows: [{ raw_name: "DefEv_Mob", value: 100 }],
      })
    ).event.week;
    expect(bearOnlyWeek > mobWeek).toBe(true);

    // Unfiltered default = latest week overall (unchanged behaviour).
    expect((await statsService.weeklyRanking()).week).toBe(bearOnlyWeek);

    // Filtered default skips the bear-only week instead of serving an all-zero mobilization board.
    const mobDefault = await statsService.weeklyRanking(undefined, "mobilization");
    expect(mobDefault.week).toBe(mobWeek);
    expect(mobDefault.hasEvents).toBe(true);
    expect(mobDefault.rows.find((r) => r.governor === "DefEv_Mob")?.score).toBe(4); // tier 2 × weight 2
  });
});

describe("StatsService.overallRanking", () => {
  it("sums cumulative scores across weeks with per-activity breakdown and in-set zeros", async () => {
    const { eventService, statsService } = createServices(DB);
    await seedMember("Ovr_Alice");
    await seedMember("Ovr_Bob");
    await seedMember("Ovr_Zero");

    // Two different weeks — overall must sum across both.
    await eventService.create({
      activity: "contribution",
      date: "2027-07-05",
      rows: [
        { raw_name: "Ovr_Alice", value: 60000 }, // tier 2
        { raw_name: "Ovr_Bob", value: 25000 }, // tier 1
        { raw_name: "Ovr_Ghost_zz", value: 60000 }, // unmapped -> counts for nobody
      ],
    });
    await eventService.create({
      activity: "mobilization",
      date: "2027-07-12",
      rows: [{ raw_name: "Ovr_Alice", value: 5000 }], // tier 2 x weight 2 = 4
    });

    const overall = await statsService.overallRanking();
    const alice = overall.rows.find((r) => r.governor === "Ovr_Alice");
    const bob = overall.rows.find((r) => r.governor === "Ovr_Bob");
    const zero = overall.rows.find((r) => r.governor === "Ovr_Zero");

    expect(alice?.score).toBe(6); // 2 + 4 across two weeks
    expect(alice?.breakdown).toEqual({ contribution: 2, mobilization: 4 });
    expect(bob?.score).toBe(1);
    expect(zero?.score).toBe(0); // active, never scored -> included at 0
    expect(overall.rows.some((r) => r.governor === "Ovr_Ghost_zz")).toBe(false); // unmapped excluded
    expect((alice?.rank ?? Infinity) < (bob?.rank ?? 0)).toBe(true);

    // Ranks are 1-based and contiguous over the whole board.
    const ranks = overall.rows.map((r) => r.rank);
    expect(ranks).toEqual(ranks.map((_, i) => i + 1));
  });

  it("embeds an attendance pct (board-scoped) in every ranking row", async () => {
    const { statsService } = createServices(DB);
    const overall = await statsService.overallRanking();
    for (const r of overall.rows) {
      expect(typeof r.attendance).toBe("number");
      expect(r.attendance).toBeGreaterThanOrEqual(0);
      expect(r.attendance).toBeLessThanOrEqual(1);
    }
  });

  it("scopes ranking-row attendance to the activity filter", async () => {
    const { eventService, statsService } = createServices(DB);
    await seedMember("Rank_AttContribOnly");
    await seedMember("Rank_AttBearOnly");

    await eventService.create({
      activity: "contribution",
      date: "2029-09-03",
      rows: [{ raw_name: "Rank_AttContribOnly", value: 60000 }],
    });
    await eventService.create({
      activity: "bear_trap",
      date: "2029-09-04",
      rows: [{ raw_name: "Rank_AttBearOnly", value: 100 }],
    });

    const bearBoard = await statsService.overallRanking("bear_trap");
    const contribOnly = bearBoard.rows.find((r) => r.governor === "Rank_AttContribOnly");
    const bearOnly = bearBoard.rows.find((r) => r.governor === "Rank_AttBearOnly");

    // The reported bug: a member with zero bear event-days showed their global attendance here.
    expect(contribOnly?.attendance).toBe(0);
    expect(bearOnly?.attendance).toBeGreaterThan(0);
  });

  it("scopes ranking-row attendance to the week on the weekly board", async () => {
    const { eventService, statsService } = createServices(DB);
    await seedMember("Rank_AttWeekly");
    await seedMember("Rank_AttOtherWk");

    const w1 = await eventService.create({
      activity: "bear_trap",
      date: "2028-06-05",
      rows: [{ raw_name: "Rank_AttWeekly", value: 100 }],
    });
    const w2 = await eventService.create({
      activity: "bear_trap",
      date: "2028-06-12",
      rows: [{ raw_name: "Rank_AttOtherWk", value: 100 }],
    });

    const attended = await statsService.weeklyRanking(w1.event.week);
    expect(attended.rows.find((r) => r.governor === "Rank_AttWeekly")?.attendance).toBeGreaterThan(0);

    const absent = await statsService.weeklyRanking(w2.event.week);
    const stale = absent.rows.find((r) => r.governor === "Rank_AttWeekly");
    expect(stale?.attendance).toBe(0);
    // Movement still works — pins the invariant that the prior-week ranking reuses the target
    // week's attendance map for rank movement only (attendance on prior rows is never read).
    expect(typeof absent.rows.find((r) => r.governor === "Rank_AttOtherWk")?.movement).toBe("number");
  });

  it("scopes ranking-row attendance by week AND activity combined (the reported path)", async () => {
    const { eventService, statsService } = createServices(DB);
    await seedMember("Rank_AttComboMain");
    await seedMember("Rank_AttComboOther");

    // Week X: Main attends bear. Week W: Other attends bear; Main attends only contribution.
    await eventService.create({
      activity: "bear_trap",
      date: "2029-11-05",
      rows: [{ raw_name: "Rank_AttComboMain", value: 100 }],
    });
    const wW = await eventService.create({
      activity: "bear_trap",
      date: "2029-11-12",
      rows: [{ raw_name: "Rank_AttComboOther", value: 100 }],
    });
    await eventService.create({
      activity: "contribution",
      date: "2029-11-12",
      rows: [{ raw_name: "Rank_AttComboMain", value: 60000 }],
    });

    // Bear board for week W: Main attended bear in another week and contribution in W — both
    // must be excluded. Both filters thread through ONE attendanceMap call; attendanceParams
    // in stats-repo is bind-order-sensitive, so this is where a regression would hide.
    const board = await statsService.weeklyRanking(wW.event.week, "bear_trap");
    expect(board.rows.find((r) => r.governor === "Rank_AttComboMain")?.attendance).toBe(0);
    expect(board.rows.find((r) => r.governor === "Rank_AttComboOther")?.attendance).toBeGreaterThan(0);
  });
});

describe("StatsService.attendance", () => {
  it("counts Bear once per event-day even across two traps; a member in one trap gets full credit", async () => {
    const { eventService, statsService } = createServices(DB);
    await seedMember("Att_TrapA");
    await seedMember("Att_TrapB");

    const before = (await statsService.attendance()).total_event_days;

    // Two-trap Bear day: same date, two instances, different members (two-trap uniqueness).
    const date = "2027-04-05";
    await eventService.create({
      activity: "bear_trap",
      date,
      instance: 1,
      rows: [{ raw_name: "Att_TrapA", value: 100 }],
    });
    await eventService.create({
      activity: "bear_trap",
      date,
      instance: 2,
      rows: [{ raw_name: "Att_TrapB", value: 100 }],
    });

    const attendance = await statsService.attendance();
    // Two traps share one (activity_type_id, date) -> total distinct event-days grows by exactly 1.
    expect(attendance.total_event_days).toBe(before + 1);

    // Each member appears in only this one event-day -> full credit, counted once (not per trap).
    const a = attendance.rows.find((r) => r.governor === "Att_TrapA");
    const b = attendance.rows.find((r) => r.governor === "Att_TrapB");
    expect(a?.attended).toBe(1);
    expect(b?.attended).toBe(1);
    expect(a?.total).toBe(attendance.total_event_days);
    expect(a?.pct).toBeCloseTo(1 / attendance.total_event_days);
  });

  it("filters deactivated members out of the payload, keeps active no-shows at 0", async () => {
    const { eventService, memberService, statsService } = createServices(DB);
    const activeId = await seedMember("Att_ActiveMem");
    const inactiveId = await seedMember("Att_InactiveMem");
    await seedMember("Att_NoShowMem"); // active, never appears in any event -> attended === 0

    await eventService.create({
      activity: "bear_trap",
      date: "2027-11-02",
      rows: [
        { raw_name: "Att_ActiveMem", value: 100 },
        { raw_name: "Att_InactiveMem", value: 100 },
      ],
    });

    await memberService.deactivate(inactiveId);

    const attendance = await statsService.attendance();
    const active = attendance.rows.find((r) => r.governor === "Att_ActiveMem");
    const inactive = attendance.rows.find((r) => r.governor === "Att_InactiveMem");
    const noShow = attendance.rows.find((r) => r.governor === "Att_NoShowMem");

    // Deliberate contract: deactivated members are filtered out server-side, even with participations.
    expect(active).toBeDefined();
    expect(active?.active).toBe(1);
    expect(active?.member_id).toBe(activeId);
    expect(inactive).toBeUndefined();

    // Active no-show still surfaces at attended=0. Relies on the LEFT JOIN in attendanceCounts() —
    // an INNER JOIN would drop them.
    expect(noShow).toBeDefined();
    expect(noShow?.attended).toBe(0);
  });

  it("scopes numerator and denominator together when filtered by week and by activity", async () => {
    const { eventService, statsService } = createServices(DB);
    await seedMember("Att_ScopeA");
    await seedMember("Att_ScopeB");

    // Week 1: contribution, A only. Week 2 (7 days later): bear, both.
    const w1 = await eventService.create({
      activity: "contribution",
      date: "2027-06-07",
      rows: [{ raw_name: "Att_ScopeA", value: 60000 }],
    });
    const w2 = await eventService.create({
      activity: "bear_trap",
      date: "2027-06-14",
      rows: [
        { raw_name: "Att_ScopeA", value: 100 },
        { raw_name: "Att_ScopeB", value: 100 },
      ],
    });

    // Week scope: that week's single event-day is the whole denominator, so A is 100% and B — absent
    // from it but present elsewhere — is a 0% row, not a missing one.
    const week1 = await statsService.attendance(w1.event.week);
    expect(week1.total_event_days).toBe(1);
    expect(week1.rows.find((r) => r.governor === "Att_ScopeA")?.pct).toBe(1);
    expect(week1.rows.find((r) => r.governor === "Att_ScopeB")).toMatchObject({ attended: 0, pct: 0 });

    // Activity scope: A attended exactly one bear day out of every bear day in the file.
    const bear = await statsService.attendance(undefined, "bear_trap");
    expect(bear.rows.find((r) => r.governor === "Att_ScopeA")?.attended).toBe(1);
    expect(bear.rows.find((r) => r.governor === "Att_ScopeA")?.total).toBe(bear.total_event_days);

    // Both filters combined, matching no event: a zero denominator, still one row per member.
    const empty = await statsService.attendance(w2.event.week, "contribution");
    expect(empty.total_event_days).toBe(0);
    expect(empty.rows.length).toBe(week1.rows.length);
    expect(empty.rows.every((r) => r.attended === 0 && r.pct === 0)).toBe(true);
  });

  it("attaches delta vs the prior event-week on the weekly view", async () => {
    const { eventService, statsService } = createServices(DB);
    await seedMember("Dlt_Riser");
    await seedMember("Dlt_Faller");

    // Prior week: Faller attends, Riser doesn't. Target week: the reverse.
    await eventService.create({
      activity: "bear_trap",
      date: "2030-01-07",
      rows: [{ raw_name: "Dlt_Faller", value: 100 }],
    });
    const wW = await eventService.create({
      activity: "bear_trap",
      date: "2030-01-14",
      rows: [{ raw_name: "Dlt_Riser", value: 100 }],
    });
    // Second bear event-day in the same target week (2030-W03), Faller only. Makes the target
    // week's denominator 2 (not 1) so pct-based delta is distinguishable from raw-count delta.
    await eventService.create({
      activity: "bear_trap",
      date: "2030-01-15",
      rows: [{ raw_name: "Dlt_Faller", value: 100 }],
    });

    const att = await statsService.attendance(wW.event.week);
    const riser = att.rows.find((r) => r.governor === "Dlt_Riser");
    const faller = att.rows.find((r) => r.governor === "Dlt_Faller");
    expect(riser?.delta).toBe(0.5); // 1/2 this week, 0/1 prior
    expect(faller?.delta).toBe(-0.5); // 1/2 this week, 1/1 prior
  });

  it("delta is null on the earliest event-week (no prior) and absent on the all-time view", async () => {
    const { statsService } = createServices(DB);
    // weeks() returns newest-first; the last entry is the globally earliest event-week,
    // whichever test seeded it — no prior week exists before it by definition.
    const weeks = await statsService.weeks();
    const earliest = weeks[weeks.length - 1];

    const first = await statsService.attendance(earliest);
    expect(first.rows.length).toBeGreaterThan(0);
    expect(first.rows.every((r) => r.delta === null)).toBe(true);

    const allTime = await statsService.attendance();
    expect(allTime.rows.every((r) => !("delta" in r) || r.delta === undefined)).toBe(true);
  });

  it("delta is null for every row when the target week has no in-scope events", async () => {
    const { statsService } = createServices(DB);
    // A week no test seeds events into: rule 1 — total_event_days 0 must yield delta null,
    // never -pct(prior) for the whole roster.
    const empty = await statsService.attendance("2033-W07");
    expect(empty.total_event_days).toBe(0);
    expect(empty.rows.length).toBeGreaterThan(0);
    expect(empty.rows.every((r) => r.delta === null)).toBe(true);
  });

  it("activity-filtered delta compares against the last week that HAD the activity", async () => {
    const { eventService, statsService } = createServices(DB);
    await seedMember("Dlt_SkipWk");
    await seedMember("Dlt_SkipOther");

    // Bear in week 1 (SkipWk attends), contribution-only week 2, bear again in week 3 (only
    // SkipOther attends). Bear-scoped delta for week 3 must compare against week 1, not the
    // bear-less week 2 (which would read as prior pct 0 and flatten SkipWk's drop to 0).
    await eventService.create({
      activity: "bear_trap",
      date: "2030-03-04",
      rows: [{ raw_name: "Dlt_SkipWk", value: 100 }],
    });
    await eventService.create({
      activity: "contribution",
      date: "2030-03-11",
      rows: [{ raw_name: "Dlt_SkipWk", value: 60000 }],
    });
    const w3 = await eventService.create({
      activity: "bear_trap",
      date: "2030-03-18",
      rows: [{ raw_name: "Dlt_SkipOther", value: 100 }],
    });

    const att = await statsService.attendance(w3.event.week, "bear_trap");
    expect(att.rows.find((r) => r.governor === "Dlt_SkipWk")?.delta).toBe(-1); // 0/1 vs 1/1 in week 1
    expect(att.rows.find((r) => r.governor === "Dlt_SkipOther")?.delta).toBe(1);
  });
});

describe("StatsService freshness (no cache)", () => {
  it("reflects an alias mapping immediately after its recompute, with no cache step", async () => {
    const { eventService, aliasService, statsService } = createServices(DB);
    const memberId = await seedMember("Fresh_Member");

    // Logged under an unknown rename -> unmapped -> excluded from the ranking.
    const ev = await eventService.create({
      activity: "contribution",
      date: "2027-05-03",
      rows: [{ raw_name: "Fresh_Ghost_xyz", value: 60000 }],
    });

    // Unmapped rows count for nobody: the member is on the roster-wide board, but at score 0.
    const beforeMap = await statsService.weeklyRanking(ev.event.week);
    expect(beforeMap.rows.find((r) => r.governor === "Fresh_Member")?.score).toBe(0);

    // Mapping the ghost triggers a recompute; the very next read reflects it.
    await aliasService.add({ alias: "Fresh_Ghost_xyz", member_id: memberId });

    const afterMap = await statsService.weeklyRanking(ev.event.week);
    const row = afterMap.rows.find((r) => r.governor === "Fresh_Member");
    expect(row?.score).toBe(2); // contribution 60000 -> tier 2
  });
});

describe("StatsService.memberProfile", () => {
  it("returns totals, per-activity totals, and a per-week series", async () => {
    const { eventService, statsService } = createServices(DB);
    const memberId = await seedMember("Prof_Member");

    await eventService.create({
      activity: "contribution",
      date: "2027-03-01",
      rows: [{ raw_name: "Prof_Member", value: 60000 }], // 2
    });
    await eventService.create({
      activity: "mobilization",
      date: "2027-03-15",
      rows: [{ raw_name: "Prof_Member", value: 10000 }], // tier 3 x weight 2 = 6
    });

    const profile = await statsService.memberProfile(memberId);
    expect(profile?.member.governor).toBe("Prof_Member");
    expect(profile?.totals.score).toBe(8);
    expect(profile?.totals.appearances).toBe(2);
    expect(profile?.perActivity.contribution).toEqual({ points: 2, appearances: 1 });
    expect(profile?.perActivity.mobilization).toEqual({ points: 6, appearances: 1 });
    expect(profile?.series.length).toBe(2);
    // Series ordered by week ascending.
    const weeks = profile?.series.map((s) => s.week) ?? [];
    expect([...weeks].sort()).toEqual(weeks);
    // Each week carries its per-activity breakdown; week score = Σ of byActivity.
    const contribWeek = profile?.series.find((s) => s.byActivity.contribution);
    expect(contribWeek?.byActivity).toEqual({ contribution: 2 });
    expect(contribWeek?.score).toBe(2);
    const mobWeek = profile?.series.find((s) => s.byActivity.mobilization);
    expect(mobWeek?.byActivity).toEqual({ mobilization: 6 });
  });

  it("returns null for a member that does not exist", async () => {
    const { statsService } = createServices(DB);
    expect(await statsService.memberProfile(999999)).toBeNull();
  });

  it("carries per-week possible in the series and all-time possible in totals", async () => {
    const { eventService, statsService } = createServices(DB);
    const id = await seedMember("PossProf_M");

    // Two fresh weeks used only by this test.
    await eventService.create({
      activity: "contribution",
      date: "2028-03-06",
      rows: [{ raw_name: "PossProf_M", value: 60000 }], // 2 pts, week possible 3
    });
    await eventService.create({
      activity: "mobilization",
      date: "2028-03-13",
      rows: [{ raw_name: "PossProf_M", value: 10000 }], // 6 pts, week possible 6
    });

    const profile = await statsService.memberProfile(id);
    const series = profile?.series ?? [];
    expect(series.find((s) => s.score === 2)?.possible).toBe(3);
    expect(series.find((s) => s.score === 6)?.possible).toBe(6);
    // Totals carry the all-time denominator (≥ this test's 9; other tests' events add to it).
    expect(profile?.totals.possible).toBeGreaterThanOrEqual(9);
  });
});

describe("percent-of-possible denominators", () => {
  it("weekly possible = Σ max tier points × weight over the week's distinct event-days", async () => {
    const { eventService, statsService } = createServices(DB);
    await seedMember("Poss_A");
    await seedMember("Poss_B");

    // Fresh week used only by this test. Two-trap Bear day needs two members (two-trap uniqueness).
    const date = "2028-01-10";
    await eventService.create({
      activity: "bear_trap",
      date,
      instance: 1,
      rows: [{ raw_name: "Poss_A", value: 100 }],
    });
    await eventService.create({
      activity: "bear_trap",
      date,
      instance: 2,
      rows: [{ raw_name: "Poss_B", value: 100 }],
    });
    const ev = await eventService.create({
      activity: "contribution",
      date,
      rows: [{ raw_name: "Poss_A", value: 25000 }],
    });

    let ranking = await statsService.weeklyRanking(ev.event.week);
    // Two-trap Bear day counts once (a member can only be in one trap): bear 1 + contribution 3.
    expect(ranking.possible).toBe(4);

    await eventService.create({
      activity: "mobilization",
      date,
      rows: [{ raw_name: "Poss_A", value: 2000 }],
    });
    ranking = await statsService.weeklyRanking(ev.event.week);
    expect(ranking.possible).toBe(10); // + mobilization 3 × weight 2
  });

  it("overall possible grows by each new event's max × weight", async () => {
    const { eventService, statsService } = createServices(DB);
    await seedMember("Poss_C");

    const before = (await statsService.overallRanking()).possible;
    await eventService.create({
      activity: "mobilization",
      date: "2028-02-07",
      rows: [{ raw_name: "Poss_C", value: 2000 }],
    });
    const after = (await statsService.overallRanking()).possible;
    expect(after - before).toBe(6); // mobilization max 3 × weight 2
  });

  it("returns possible 0 for a week with no events", async () => {
    const { statsService } = createServices(DB);
    const ranking = await statsService.weeklyRanking("2030-W01"); // no events ever in this week
    expect(ranking.possible).toBe(0);
    expect(ranking.hasEvents).toBe(false);
    expect(ranking.rows).toEqual([]);
  });

  it("an activity with no scoring tiers contributes 0 possible", async () => {
    const { activityService, eventService, statsService } = createServices(DB);
    await seedMember("Poss_D");
    // Created without any tiers (tiers are seeded separately via scoring config).
    await activityService.create({
      key: "poss_notier",
      name: "NoTier",
      unit_label: null,
      weight: 1,
      max_instance: 1,
      min_value: 0,
      active: 1,
      sort: 99,
    });

    const before = (await statsService.overallRanking()).possible;
    await eventService.create({
      activity: "poss_notier",
      date: "2028-04-03",
      rows: [{ raw_name: "Poss_D", value: 10 }],
    });
    const after = (await statsService.overallRanking()).possible;
    expect(after - before).toBe(0);
  });
});

describe("analytics HTTP routes", () => {
  it("GET /api/rankings/weekly, /attendance, /weeks, /overview return 200 with the expected shape", async () => {
    const weekly = await SELF.fetch("https://example.com/api/rankings/weekly", { headers: VIEWER });
    expect(weekly.status).toBe(200);
    const weeklyBody = (await weekly.json()) as { week: string; rows: unknown[] };
    expect(weeklyBody).toHaveProperty("week");
    expect(Array.isArray(weeklyBody.rows)).toBe(true);

    const attendance = await SELF.fetch("https://example.com/api/attendance", { headers: VIEWER });
    expect(attendance.status).toBe(200);
    const attBody = (await attendance.json()) as { total_event_days: number; rows: unknown[] };
    expect(attBody).toHaveProperty("total_event_days");
    expect(Array.isArray(attBody.rows)).toBe(true);

    const weeks = await SELF.fetch("https://example.com/api/weeks", { headers: VIEWER });
    expect(weeks.status).toBe(200);
    expect(Array.isArray(await weeks.json())).toBe(true);

    const overview = await SELF.fetch("https://example.com/api/overview", { headers: VIEWER });
    expect(overview.status).toBe(200);
    const ovBody = (await overview.json()) as Record<string, unknown>;
    for (const key of ["members", "activeMembers", "events", "eventDays", "weeks", "unmappedNames"]) {
      expect(ovBody).toHaveProperty(key);
    }
  });

  it("GET /api/members/:id/profile returns 200 + shape, 404 for missing, 400 for non-numeric", async () => {
    const memberId = await seedMember("Http_Prof");

    const res = await SELF.fetch(`https://example.com/api/members/${memberId}/profile`, { headers: VIEWER });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { member: { governor: string }; totals: unknown };
    expect(body.member.governor).toBe("Http_Prof");
    expect(body).toHaveProperty("totals");

    expect((await SELF.fetch("https://example.com/api/members/999999/profile", { headers: VIEWER })).status).toBe(404);
    expect((await SELF.fetch("https://example.com/api/members/not-a-number/profile", { headers: VIEWER })).status).toBe(400);
  });

  it("GET /api/rankings/overall returns 200 with rows", async () => {
    const res = await SELF.fetch("https://example.com/api/rankings/overall", { headers: VIEWER });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[] };
    expect(Array.isArray(body.rows)).toBe(true);
  });

  it("POST /api/admin/recompute returns 200 with the API key and 401 without", async () => {
    const ok = await SELF.fetch("https://example.com/api/admin/recompute", {
      method: "POST",
      headers: AUTH,
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { recomputed: number };
    expect(typeof body.recomputed).toBe("number");

    const unauthorized = await SELF.fetch("https://example.com/api/admin/recompute", {
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);
  });
});

describe("alliance_rank on ranking rows", () => {
  it("carries each member's alliance rank onto the overall board, null when unrecorded", async () => {
    const { memberService, eventService, statsService } = createServices(DB);
    await memberService.create({ governor: "AR_Leader", alliance_rank: "R5" });
    await memberService.create({ governor: "AR_Plain" });

    await eventService.create({
      activity: "contribution",
      date: "2027-08-02", // unused elsewhere in this file — see the header note on fixture isolation
      rows: [
        { raw_name: "AR_Leader", value: 60000 },
        { raw_name: "AR_Plain", value: 25000 },
      ],
    });

    const board = await statsService.overallRanking();
    expect(board.rows.find((r) => r.governor === "AR_Leader")?.alliance_rank).toBe("R5");
    expect(board.rows.find((r) => r.governor === "AR_Plain")?.alliance_rank).toBeNull();
  });

  it("carries alliance_rank onto the weekly board too", async () => {
    const { memberService, eventService, statsService } = createServices(DB);
    await memberService.create({ governor: "AR_Weekly", alliance_rank: "R4" });

    const ev = await eventService.create({
      activity: "contribution",
      date: "2027-08-09", // unused elsewhere in this file — see the header note on fixture isolation
      rows: [{ raw_name: "AR_Weekly", value: 60000 }],
    });

    const board = await statsService.weeklyRanking(ev.event.week);
    expect(board.rows.find((r) => r.governor === "AR_Weekly")?.alliance_rank).toBe("R4");
  });
});

describe("alliance_rank on attendance rows", () => {
  it("carries alliance_rank onto each attendance row, null when unrecorded", async () => {
    const { memberService, eventService, statsService } = createServices(DB);
    await memberService.create({ governor: "AttRank_R3", alliance_rank: "R3" });
    await memberService.create({ governor: "AttRank_None" });

    await eventService.create({
      activity: "bear_trap",
      date: "2027-08-16", // unused elsewhere in this file — see the header note on fixture isolation
      instance: 1,
      rows: [{ raw_name: "AttRank_R3", value: 1 }],
    });

    const attendance = await statsService.attendance();
    expect(attendance.rows.find((r) => r.governor === "AttRank_R3")?.alliance_rank).toBe("R3");
    expect(attendance.rows.find((r) => r.governor === "AttRank_None")?.alliance_rank).toBeNull();
  });
});
