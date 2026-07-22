import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ActivityRepo } from "../../src/repositories/activity-repo";
import { AliasRepo } from "../../src/repositories/alias-repo";
import { EventRepo } from "../../src/repositories/event-repo";
import { MemberRepo } from "../../src/repositories/member-repo";
import { ParticipationRepo } from "../../src/repositories/participation-repo";
import { ScoringTierRepo } from "../../src/repositories/scoring-tier-repo";
import type { NewMember, NewParticipation } from "../../shared/types";

const { DB } = env;

// Isolation model (verified empirically, not assumed): this pool-workers setup gives each test FILE a
// fresh migrated D1 via test/integration/setup.ts, but does NOT reset storage between individual `it`
// blocks within that file — writes from one test are visible to later tests in this file. There is no
// per-test isolatedStorage here. Exact (non-hedged) count()/list() assertions below only work because,
// per table, they run in the FIRST test in this file that touches that table (before any later test adds
// more rows) — later tests use unique fixture names instead of relying on global counts.

describe("ActivityRepo", () => {
  const repo = new ActivityRepo(DB);

  it("inserts and round-trips an activity type", async () => {
    const inserted = await repo.insert({
      key: "bear_trap",
      name: "Bear Trap",
      unit_label: "Damage",
      weight: 1,
      max_instance: 2,
      min_value: 0,
      active: 1,
      sort: 1,
      color: "blue",
    });

    expect(inserted.id).toBeGreaterThan(0);
    expect(inserted.key).toBe("bear_trap");

    const found = await repo.getByKey("bear_trap");
    expect(found).toEqual(inserted);

    const listed = await repo.list();
    expect(listed.map((a) => a.key)).toEqual(["bear_trap"]);
  });

  it("returns null for an unknown key", async () => {
    expect(await repo.getByKey("does_not_exist")).toBeNull();
  });
});

describe("ScoringTierRepo", () => {
  it("inserts many tiers and lists them by activity, ordered by min_value", async () => {
    const activity = await new ActivityRepo(DB).insert({
      key: "contribution",
      name: "Contribution",
      unit_label: "Contribution",
      weight: 1,
      max_instance: 1,
      min_value: 0,
      active: 1,
      sort: 2,
      color: "green",
    });

    const tierRepo = new ScoringTierRepo(DB);
    await tierRepo.insertMany([
      { activity_type_id: activity.id, min_value: 500, points: 3 },
      { activity_type_id: activity.id, min_value: 0, points: 0 },
      { activity_type_id: activity.id, min_value: 100, points: 1 },
    ]);

    const tiers = await tierRepo.listByActivity(activity.id);
    expect(tiers.map((t) => t.points)).toEqual([0, 1, 3]);
  });
});

describe("MemberRepo", () => {
  const repo = new MemberRepo(DB);

  it("inserts many members and round-trips them", async () => {
    const rows: NewMember[] = [
      { governor: "RepoTest Alice", alliance_rank: "R4", power: 1000, power_position: 1, active: 1 },
      { governor: "RepoTest Bob", alliance_rank: "R3", power: 900, power_position: 2, active: 1 },
    ];
    await repo.insertMany(rows);

    const alice = await repo.getByGovernor("RepoTest Alice");
    expect(alice?.alliance_rank).toBe("R4");
    expect(alice?.power).toBe(1000);

    const all = await repo.list();
    expect(all.map((m) => m.governor)).toEqual(["RepoTest Alice", "RepoTest Bob"]);

    expect(await repo.count()).toBe(2);
  });
});

describe("AliasRepo", () => {
  it("inserts many aliases, round-trips, and rejects a duplicate alias", async () => {
    const memberRepo = new MemberRepo(DB);
    await memberRepo.insertMany([
      { governor: "RepoTest Carol", alliance_rank: null, power: null, power_position: null, active: 1 },
    ]);
    const carol = await memberRepo.getByGovernor("RepoTest Carol");
    if (!carol) throw new Error("fixture member not found");

    const aliasRepo = new AliasRepo(DB);
    await aliasRepo.insertMany([{ alias: "RepoTest_C", member_id: carol.id, note: null }]);

    const found = await aliasRepo.getByAlias("RepoTest_C");
    expect(found?.member_id).toBe(carol.id);

    expect(await aliasRepo.count()).toBe(1);

    await expect(
      aliasRepo.insertMany([{ alias: "RepoTest_C", member_id: carol.id, note: "duplicate" }]),
    ).rejects.toThrow(/UNIQUE constraint/i);
  });
});

describe("EventRepo", () => {
  it("inserts and round-trips an event", async () => {
    const activity = await new ActivityRepo(DB).insert({
      key: "mobilization",
      name: "Alliance Mobilization",
      unit_label: "Personal Points",
      weight: 2,
      max_instance: 1,
      min_value: 0,
      active: 1,
      sort: 3,
      color: "violet",
    });

    const eventRepo = new EventRepo(DB);
    const inserted = await eventRepo.insert({
      activity_type_id: activity.id,
      date: "2026-07-13",
      week: "2026-W28",
      instance: 1,
    });

    expect(inserted.id).toBeGreaterThan(0);

    const found = await eventRepo.getByKey(activity.id, "2026-07-13", 1);
    expect(found?.id).toBe(inserted.id);

    const listed = await eventRepo.list();
    expect(listed.map((e) => e.id)).toEqual([inserted.id]);

    expect(await eventRepo.count()).toBe(1);
  });
});

describe("ParticipationRepo", () => {
  it("insertMany crosses the multi-row-insert chunk boundary for 150+ rows", async () => {
    const activity = await new ActivityRepo(DB).insert({
      key: "bear_trap_chunk_test",
      name: "Bear Trap Chunk Test",
      unit_label: "Damage",
      weight: 1,
      max_instance: 2,
      min_value: 0,
      active: 1,
      sort: 99,
      color: "slate",
    });

    const event = await new EventRepo(DB).insert({
      activity_type_id: activity.id,
      date: "2026-07-20",
      week: "2026-W29",
      instance: 1,
    });

    const ROW_COUNT = 155;
    const rows: NewParticipation[] = Array.from({ length: ROW_COUNT }, (_, i) => ({
      event_id: event.id,
      raw_name: `Participant ${i}`,
      member_id: null,
      value: i + 1,
      points: 0,
      notes: null,
    }));

    const participationRepo = new ParticipationRepo(DB);
    await participationRepo.insertMany(rows);

    const listed = await participationRepo.listByEvent(event.id);
    expect(listed).toHaveLength(ROW_COUNT);

    const first = listed.find((p) => p.raw_name === "Participant 0");
    const last = listed.find((p) => p.raw_name === `Participant ${ROW_COUNT - 1}`);
    expect(first?.value).toBe(1);
    expect(last?.value).toBe(ROW_COUNT);

    expect(await participationRepo.count()).toBe(ROW_COUNT);
  });
});
