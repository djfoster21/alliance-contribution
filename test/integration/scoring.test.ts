import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { ActivityRepo } from "../../src/repositories/activity-repo";
import { AliasRepo } from "../../src/repositories/alias-repo";
import { EventRepo } from "../../src/repositories/event-repo";
import { MemberRepo } from "../../src/repositories/member-repo";
import { ParticipationRepo } from "../../src/repositories/participation-repo";
import { createServices } from "../../src/services";
import type { NewParticipation } from "../../shared/types";

const { DB, SEED_STATEMENTS } = env;

// Storage is NOT reset between `it` blocks in this file (see repos.test.ts note). The default config,
// roster, alias, event, and participations are created once in beforeAll; tests operate on that shared
// state in order — the tier-edit test reverts the config so later tests still see the seeded defaults.

let contributionId: number;
let aliceId: number;
let bobId: number;
let eventId: number;

const participationRepo = new ParticipationRepo(DB);

const byValue = async (value: number) => {
  const rows = await participationRepo.listByEvent(eventId);
  const row = rows.find((p) => p.value === value);
  if (!row) throw new Error(`no participation with value ${value}`);
  return row;
};

beforeAll(async () => {
  for (const stmt of SEED_STATEMENTS) {
    await DB.prepare(stmt).run();
  }

  const activityRepo = new ActivityRepo(DB);
  const contribution = await activityRepo.getByKey("contribution");
  if (!contribution) throw new Error("seed did not create the contribution activity");
  contributionId = contribution.id;

  const memberRepo = new MemberRepo(DB);
  await memberRepo.insertMany([
    { governor: "Recompute Alice", alliance_rank: null, power: null, power_position: null, active: 1 },
    { governor: "Recompute Bob", alliance_rank: null, power: null, power_position: null, active: 1 },
  ]);
  const alice = await memberRepo.getByGovernor("Recompute Alice");
  const bob = await memberRepo.getByGovernor("Recompute Bob");
  if (!alice || !bob) throw new Error("fixture members not found");
  aliceId = alice.id;
  bobId = bob.id;

  await new AliasRepo(DB).insertMany([{ alias: "RC_Alias", member_id: bobId, note: null }]);

  const event = await new EventRepo(DB).insert({
    activity_type_id: contributionId,
    date: "2026-07-13",
    week: "2026-W28",
    instance: 1,
  });
  eventId = event.id;

  // Logged with member_id null and points 0 — recompute is responsible for filling both in.
  const rows: NewParticipation[] = [
    { event_id: eventId, raw_name: "Recompute Alice", member_id: null, value: 25000, points: 0, notes: null },
    { event_id: eventId, raw_name: "RC_Alias", member_id: null, value: 70000, points: 0, notes: null },
    { event_id: eventId, raw_name: "Unknown Governor XYZ", member_id: null, value: 150000, points: 0, notes: null },
    { event_id: eventId, raw_name: "Recompute Bob", member_id: null, value: 100, points: 0, notes: null },
  ];
  await participationRepo.insertMany(rows);
});

describe("recompute scores from config", () => {
  it("resolves members (governor + alias) and scores points from the seeded Contribution tiers", async () => {
    const { recomputeService } = createServices(DB);
    const result = await recomputeService.run();
    expect(result.participations).toBe(4);

    // Contribution tiers: 0->0, 20000->1, 60000->2, 120000->3; weight 1.
    const aliceLow = await byValue(25000);
    expect(aliceLow.points).toBe(1);
    expect(aliceLow.member_id).toBe(aliceId); // resolved by governor name

    const bobAliased = await byValue(70000);
    expect(bobAliased.points).toBe(2);
    expect(bobAliased.member_id).toBe(bobId); // resolved via alias

    const unknown = await byValue(150000);
    expect(unknown.points).toBe(3);
    expect(unknown.member_id).toBeNull(); // unresolved name -> NULL, never guessed

    const zeroPoints = await byValue(100);
    expect(zeroPoints.points).toBe(0);
    expect(zeroPoints.member_id).toBe(bobId); // resolved by governor name; below the lowest scoring tier
  });
});

describe("editing scoring via ScoringService", () => {
  it("changes stored points after recompute, and reverting restores them", async () => {
    const { scoringService } = createServices(DB);

    const original = await scoringService.getConfig(contributionId);
    expect((await byValue(25000)).points).toBe(1);

    await scoringService.replaceScoring(contributionId, {
      weight: 1,
      tiers: [
        { min_value: 0, points: 0 },
        { min_value: 20000, points: 5 },
      ],
    });
    expect((await byValue(25000)).points).toBe(5);

    await scoringService.replaceScoring(contributionId, original);
    expect((await byValue(25000)).points).toBe(1);
  });
});

describe("dynamic alias attaches on recompute", () => {
  it("recompute leaves an unknown rename unmapped, then attaches it once an alias row exists", async () => {
    const memberRepo = new MemberRepo(DB);
    await memberRepo.insertMany([
      { governor: "DynMember", alliance_rank: null, power: null, power_position: null, active: 1 },
    ]);
    const dynMember = await memberRepo.getByGovernor("DynMember");
    if (!dynMember) throw new Error("fixture member DynMember not found");

    const dynEvent = await new EventRepo(DB).insert({
      activity_type_id: contributionId,
      date: "2026-07-20",
      week: "2026-W29",
      instance: 1,
    });
    await participationRepo.insertMany([
      { event_id: dynEvent.id, raw_name: "DynRename", member_id: null, value: 25000, points: 0, notes: null },
    ]);

    const { recomputeService } = createServices(DB);

    await recomputeService.run();
    const before = (await participationRepo.listByEvent(dynEvent.id))[0];
    expect(before.member_id).toBeNull(); // unknown rename -> unmapped, never guessed
    expect(before.points).toBe(1); // still scored from value (contribution 25000 -> 1)

    await new AliasRepo(DB).insertMany([{ alias: "DynRename", member_id: dynMember.id, note: null }]);

    await recomputeService.run();
    const after = (await participationRepo.listByEvent(dynEvent.id))[0];
    expect(after.id).toBe(before.id); // same row
    expect(after.member_id).toBe(dynMember.id); // rename retroactively attached
    expect(after.points).toBe(1);
  });
});

describe("recompute idempotency", () => {
  it("yields identical stored points and member_id when run twice", async () => {
    const { recomputeService } = createServices(DB);

    await recomputeService.run();
    const first = (await participationRepo.listByEvent(eventId)).map((p) => ({
      id: p.id,
      member_id: p.member_id,
      points: p.points,
    }));

    await recomputeService.run();
    const second = (await participationRepo.listByEvent(eventId)).map((p) => ({
      id: p.id,
      member_id: p.member_id,
      points: p.points,
    }));

    expect(second).toEqual(first);
  });
});

describe("replaceScoring validation", () => {
  it("rejects non-ascending tiers", async () => {
    const { scoringService } = createServices(DB);
    await expect(
      scoringService.replaceScoring(contributionId, {
        weight: 1,
        tiers: [
          { min_value: 20000, points: 1 },
          { min_value: 20000, points: 2 },
        ],
      }),
    ).rejects.toThrow(/ascending/i);
  });

  it("rejects negative points", async () => {
    const { scoringService } = createServices(DB);
    await expect(
      scoringService.replaceScoring(contributionId, {
        weight: 1,
        tiers: [{ min_value: 0, points: -1 }],
      }),
    ).rejects.toThrow(/points/i);
  });

  it("rejects a negative weight", async () => {
    const { scoringService } = createServices(DB);
    await expect(
      scoringService.replaceScoring(contributionId, {
        weight: -1,
        tiers: [{ min_value: 0, points: 0 }],
      }),
    ).rejects.toThrow(/weight/i);
  });
});

describe("recompute writes only changed rows", () => {
  it("reports zero updates on a no-op run, and only the affected rows after an alias is added", async () => {
    const { recomputeService } = createServices(DB);

    // Converge first, so the table is known-current regardless of what earlier blocks left behind.
    await recomputeService.run();

    const noop = await recomputeService.run();
    expect(noop.participations).toBeGreaterThan(0); // still evaluates every row
    expect(noop.updated).toBe(0); // ...but writes none of them

    const memberRepo = new MemberRepo(DB);
    await memberRepo.insertMany([
      { governor: "DeltaMember", alliance_rank: null, power: null, power_position: null, active: 1 },
    ]);
    const deltaMember = await memberRepo.getByGovernor("DeltaMember");
    if (!deltaMember) throw new Error("fixture member DeltaMember not found");

    const deltaEvent = await new EventRepo(DB).insert({
      activity_type_id: contributionId,
      date: "2026-07-27",
      week: "2026-W30",
      instance: 1,
    });
    await participationRepo.insertMany([
      { event_id: deltaEvent.id, raw_name: "DeltaRename", member_id: null, value: 25000, points: 0, notes: null },
    ]);

    // One new unresolved row: points 0 -> 1 is the only change in the table.
    const afterInsert = await recomputeService.run();
    expect(afterInsert.updated).toBe(1);

    // Adding the alias changes member_id on exactly that one row, and nothing else.
    await new AliasRepo(DB).insertMany([
      { alias: "DeltaRename", member_id: deltaMember.id, note: null },
    ]);
    const afterAlias = await recomputeService.run();
    expect(afterAlias.updated).toBe(1);

    const row = (await participationRepo.listByEvent(deltaEvent.id))[0];
    expect(row.member_id).toBe(deltaMember.id);
    expect(row.points).toBe(1);
  });
});
