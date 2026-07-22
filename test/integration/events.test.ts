import { SELF } from "cloudflare:test";
import { VIEWER } from "./keys";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { ActivityRepo } from "../../src/repositories/activity-repo";
import { AliasRepo } from "../../src/repositories/alias-repo";
import { EventRepo } from "../../src/repositories/event-repo";
import { MemberRepo } from "../../src/repositories/member-repo";
import { ParticipationRepo } from "../../src/repositories/participation-repo";
import type { IngestRow } from "../../src/services/event-service";
import { createServices } from "../../src/services";

const { DB, SEED_STATEMENTS } = env;

const AUTH = { "X-Api-Key": "test-key" };
const ADMIN_AUTH = { "X-Api-Key": "test-admin-key" };

// Fresh migrated D1 per file; storage NOT reset between `it` blocks — every test uses distinct dates,
// member governors, and aliases so writes from one test never collide with another.
beforeAll(async () => {
  for (const stmt of SEED_STATEMENTS) {
    await DB.prepare(stmt).run();
  }
});

// Creates a member + optional aliases, returns the member id.
async function seedMember(governor: string, aliases: string[] = []): Promise<number> {
  const memberRepo = new MemberRepo(DB);
  await memberRepo.insertMany([
    { governor, alliance_rank: null, power: null, power_position: null, active: 1 },
  ]);
  const member = await memberRepo.getByGovernor(governor);
  if (!member) throw new Error(`seedMember: ${governor} not found`);
  if (aliases.length > 0) {
    await new AliasRepo(DB).insertMany(aliases.map((alias) => ({ alias, member_id: member.id, note: null })));
  }
  return member.id;
}

describe("EventService ingest", () => {
  it("creates a brand-new activity type and immediately ingests an event for it", async () => {
    const { activityService, eventService } = createServices(DB);

    const activity = await activityService.create({ key: "kvk_e2e", name: "KvK", unit_label: "Points" });

    const result = await eventService.create({
      activity: "kvk_e2e",
      date: "2026-03-02",
      rows: [
        { raw_name: "KvkAlice", value: 500 },
        { raw_name: "KvkBob", value: 300 },
      ],
    });

    expect(result.event.activity_type_id).toBe(activity.id);
    expect(result.event.week).toBe("2026-W10");
    expect(result.event.instance).toBe(1);
    expect(result.rows).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
  });

  it("re-POSTing the same key with corrected rows replaces cleanly and re-scores (idempotent)", async () => {
    const { eventService } = createServices(DB);
    const key = { activity: "contribution", date: "2026-03-09", instance: 1 };

    const first = await eventService.create({ ...key, rows: [{ raw_name: "IdemGuy", value: 25000 }] });
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0].points).toBe(1); // contribution tier: 20000 -> 1

    const second = await eventService.create({ ...key, rows: [{ raw_name: "IdemGuy", value: 65000 }] });

    // Same event, not a second one.
    expect(second.event.id).toBe(first.event.id);
    // Replaced cleanly: still exactly one row, with the corrected value + re-scored points.
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0].value).toBe(65000);
    expect(second.rows[0].points).toBe(2); // contribution tier: 60000 -> 2

    const persisted = await eventService.get(first.event.id);
    expect(persisted?.participations).toHaveLength(1);
  });

  it("rejects a bear two-trap overlap, including the same member under two different aliases", async () => {
    const { eventService } = createServices(DB);
    await seedMember("TT Canonical", ["TT Decoy"]);
    await seedMember("TT Other");

    // Trap 1 logs the canonical governor.
    await eventService.create({
      activity: "bear_trap",
      date: "2026-04-06",
      instance: 1,
      rows: [{ raw_name: "TT Canonical", value: 100 }],
    });

    // Trap 2 logs the SAME member under a decoy alias — must be rejected on resolved identity.
    await expect(
      eventService.create({
        activity: "bear_trap",
        date: "2026-04-06",
        instance: 2,
        rows: [{ raw_name: "TT Decoy", value: 200 }],
      }),
    ).rejects.toThrow(/two-trap/);

    // A legitimately different member in trap 2 (same date) is accepted.
    await eventService.create({
      activity: "bear_trap",
      date: "2026-04-13",
      instance: 1,
      rows: [{ raw_name: "TT Canonical", value: 100 }],
    });
    const accepted = await eventService.create({
      activity: "bear_trap",
      date: "2026-04-13",
      instance: 2,
      rows: [{ raw_name: "TT Other", value: 100 }],
    });
    expect(accepted.rows).toHaveLength(1);
  });

  it("rejects two rows resolving to the same member within one event", async () => {
    const { eventService } = createServices(DB);
    await seedMember("Dup Canonical", ["Dup Alias"]);

    await expect(
      eventService.create({
        activity: "contribution",
        date: "2026-04-20",
        rows: [
          { raw_name: "Dup Canonical", value: 25000 },
          { raw_name: "Dup Alias", value: 30000 },
        ],
      }),
    ).rejects.toThrow(/duplicate/);
  });

  it("rejects repeated normalized raw names (even unmapped) without writing the event", async () => {
    const { eventService } = createServices(DB);
    const date = "2026-08-03";

    // Both normalize to "Ghost" (strip the alliance tag, trim) and "Ghost" is not on the roster.
    await expect(
      eventService.create({
        activity: "contribution",
        date,
        rows: [
          { raw_name: "[ABC]Ghost", value: 100 },
          { raw_name: "Ghost ", value: 100 },
        ],
      }),
    ).rejects.toThrow(/duplicate/);

    // Rejected before any write: no event (and therefore no participations) exists for that key.
    const contribution = await new ActivityRepo(DB).getByKey("contribution");
    if (!contribution) throw new Error("contribution activity missing");
    expect(await new EventRepo(DB).getByKey(contribution.id, date, 1)).toBeNull();
  });

  it("rejects a non-numeric, null, or missing value instead of silently skipping it", async () => {
    const { eventService } = createServices(DB);
    const date = "2026-08-10";

    // Every one of these would otherwise be written as text (scoring 0 forever but still counting as an
    // appearance) or dropped as "skipped" — they are bad input, so each must be a loud rejection.
    const badRows: unknown[] = [
      { raw_name: "BadValueGuy", value: "abc" },
      { raw_name: "BadValueGuy", value: null },
      { raw_name: "BadValueGuy" }, // value missing entirely
    ];

    for (const row of badRows) {
      await expect(
        eventService.create({ activity: "contribution", date, rows: [row as IngestRow] }),
      ).rejects.toThrow(/invalid value/);
    }

    // Rejected before any write: no event (and therefore no participations) exists for that key.
    const contribution = await new ActivityRepo(DB).getByKey("contribution");
    if (!contribution) throw new Error("contribution activity missing");
    expect(await new EventRepo(DB).getByKey(contribution.id, date, 1)).toBeNull();
  });

  it("lists rows with value <= min_value as skipped and never writes them", async () => {
    const { eventService } = createServices(DB);

    const result = await eventService.create({
      activity: "contribution", // seeded min_value 0
      date: "2026-04-27",
      rows: [
        { raw_name: "KeptGuy", value: 25000 },
        { raw_name: "ZeroGuy", value: 0 },
      ],
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows.map((r) => r.raw_name)).toEqual(["KeptGuy"]);
    expect(result.skipped).toEqual([{ raw_name: "ZeroGuy", value: 0 }]);

    const stored = await new ParticipationRepo(DB).listByEvent(result.event.id);
    expect(stored.map((p) => p.raw_name)).toEqual(["KeptGuy"]);
  });

  it("deletes an event, removing its rows and recomputing", async () => {
    const { eventService, recomputeService } = createServices(DB);

    const created = await eventService.create({
      activity: "contribution",
      date: "2026-05-04",
      rows: [
        { raw_name: "DelA", value: 25000 },
        { raw_name: "DelB", value: 65000 },
      ],
    });

    const before = await recomputeService.run();

    await eventService.delete(created.event.id);

    expect(await eventService.get(created.event.id)).toBeNull();
    const rows = await new ParticipationRepo(DB).listByEvent(created.event.id);
    expect(rows).toHaveLength(0);

    const after = await recomputeService.run();
    expect(after.participations).toBe(before.participations - 2);
  });

  it("update replaces rows, re-derives week on a date change, and rejects a key collision", async () => {
    const { eventService } = createServices(DB);

    const created = await eventService.create({
      activity: "contribution",
      date: "2026-07-06",
      rows: [{ raw_name: "UpdGuy", value: 25000 }],
    });

    // Move the event to a new date and correct the roster.
    const updated = await eventService.update(created.event.id, {
      activity: "contribution",
      date: "2026-07-13",
      rows: [{ raw_name: "UpdGuy", value: 65000 }],
    });
    expect(updated.event.id).toBe(created.event.id);
    expect(updated.event.date).toBe("2026-07-13");
    expect(updated.event.week).toBe("2026-W29");
    expect(updated.rows).toHaveLength(1);
    expect(updated.rows[0].points).toBe(2);

    // A second event whose key the first would collide with if moved onto it.
    const other = await eventService.create({
      activity: "contribution",
      date: "2026-07-20",
      rows: [{ raw_name: "OtherGuy", value: 25000 }],
    });
    await expect(
      eventService.update(updated.event.id, {
        activity: "contribution",
        date: "2026-07-20",
        rows: [{ raw_name: "UpdGuy", value: 25000 }],
      }),
    ).rejects.toThrow(/conflict/);
    // The collided-with event is untouched.
    const otherAfter = await eventService.get(other.event.id);
    expect(otherAfter?.participations.map((p) => p.raw_name)).toEqual(["OtherGuy"]);
  });

  it("throws event not found when updating a missing event", async () => {
    const { eventService } = createServices(DB);
    await expect(
      eventService.update(999999, { activity: "contribution", date: "2026-07-27", rows: [] }),
    ).rejects.toThrow(/event not found/);
  });

  it("returns unknown raw names in unmapped and persists them as member_id NULL", async () => {
    const { eventService } = createServices(DB);

    const result = await eventService.create({
      activity: "contribution",
      date: "2026-05-11",
      rows: [{ raw_name: "UnknownRename_xyz", value: 25000 }],
    });

    expect(result.unmapped).toEqual(["UnknownRename_xyz"]);
    expect(result.rows[0].member_id).toBeNull();

    const persisted = await eventService.get(result.event.id);
    expect(persisted?.participations[0].member_id).toBeNull();
  });
});

describe("events HTTP routes", () => {
  it("POST creates (200), GET /:id returns the event + participations", async () => {
    const res = await SELF.fetch("https://example.com/api/ingests", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({
        activity: "mobilization",
        date: "2026-06-01",
        rows: [{ raw_name: "HttpGuy", value: 5000 }],
      }),
    });
    expect(res.status).toBe(200);
    const created = (await res.json()) as { event: { id: number }; rows: unknown[] };
    expect(created.event.id).toBeGreaterThan(0);
    expect(created.rows).toHaveLength(1);

    const getRes = await SELF.fetch(`https://example.com/api/ingests/${created.event.id}`, { headers: VIEWER });
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()) as { event: { id: number }; participations: unknown[] };
    expect(got.event.id).toBe(created.event.id);
    expect(got.participations).toHaveLength(1);
  });

  it("POST a bear two-trap overlap returns 409", async () => {
    const trap1 = await SELF.fetch("https://example.com/api/ingests", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({
        activity: "bear_trap",
        date: "2026-06-08",
        instance: 1,
        rows: [{ raw_name: "HttpTrapGuy", value: 100 }],
      }),
    });
    expect(trap1.status).toBe(200);

    const trap2 = await SELF.fetch("https://example.com/api/ingests", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({
        activity: "bear_trap",
        date: "2026-06-08",
        instance: 2,
        rows: [{ raw_name: "HttpTrapGuy", value: 200 }],
      }),
    });
    expect(trap2.status).toBe(409);
  });

  it("POST a row whose value is not a number returns 400", async () => {
    const res = await SELF.fetch("https://example.com/api/ingests", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({
        activity: "contribution",
        date: "2026-06-09",
        rows: [{ raw_name: "HttpBadValueGuy", value: "abc" }],
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: expect.stringMatching(/invalid value/),
    });
  });

  it("PATCH updates an event's rows (happy path)", async () => {
    const create = await SELF.fetch("https://example.com/api/ingests", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({
        activity: "contribution",
        date: "2026-06-22",
        rows: [{ raw_name: "HttpPatchGuy", value: 25000 }],
      }),
    });
    const created = (await create.json()) as { event: { id: number } };

    const patch = await SELF.fetch(`https://example.com/api/ingests/${created.event.id}`, {
      method: "PATCH",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({
        activity: "contribution",
        date: "2026-06-22",
        rows: [{ raw_name: "HttpPatchGuy", value: 65000 }],
      }),
    });
    expect(patch.status).toBe(200);
    const updated = (await patch.json()) as { event: { id: number }; rows: { points: number }[] };
    expect(updated.event.id).toBe(created.event.id);
    expect(updated.rows[0].points).toBe(2);
  });

  it("PATCH unknown id returns 404", async () => {
    const res = await SELF.fetch("https://example.com/api/ingests/999999", {
      method: "PATCH",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ activity: "contribution", date: "2026-06-29", rows: [] }),
    });
    expect(res.status).toBe(404);
  });

  it("GET /:id for a missing event returns 404", async () => {
    const res = await SELF.fetch("https://example.com/api/ingests/999999", { headers: VIEWER });
    expect(res.status).toBe(404);
  });

  it("DELETE removes an event and then returns 404 for it", async () => {
    const create = await SELF.fetch("https://example.com/api/ingests", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({
        activity: "contribution",
        date: "2026-06-15",
        rows: [{ raw_name: "HttpDelGuy", value: 25000 }],
      }),
    });
    const created = (await create.json()) as { event: { id: number } };

    const del = await SELF.fetch(`https://example.com/api/ingests/${created.event.id}`, {
      method: "DELETE",
      headers: ADMIN_AUTH,
    });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });

    const missing = await SELF.fetch(`https://example.com/api/ingests/${created.event.id}`, { headers: VIEWER });
    expect(missing.status).toBe(404);
  });
});

describe("EventService.list participation counts", () => {
  it("counts participation rows and unmapped rows per event", async () => {
    const { activityService, eventService } = createServices(DB);
    await activityService.create({ key: "counts_e2e", name: "Counts", unit_label: "Points" });
    await seedMember("CountsAlice");

    await eventService.create({
      activity: "counts_e2e",
      date: "2026-04-06",
      rows: [
        { raw_name: "CountsAlice", value: 100 },
        { raw_name: "CountsGhost", value: 50 },
      ],
    });

    const listed = await eventService.list({ activity: "counts_e2e" });

    expect(listed).toHaveLength(1);
    expect(listed[0].rows).toBe(2);
    expect(listed[0].unmapped).toBe(1);
  });

  it("reports zero unmapped when every name resolves", async () => {
    const { activityService, eventService } = createServices(DB);
    await activityService.create({ key: "counts_clean_e2e", name: "Counts Clean", unit_label: "Points" });
    await seedMember("CountsBob");

    await eventService.create({
      activity: "counts_clean_e2e",
      date: "2026-04-07",
      rows: [{ raw_name: "CountsBob", value: 100 }],
    });

    const listed = await eventService.list({ activity: "counts_clean_e2e" });

    expect(listed).toHaveLength(1);
    expect(listed[0].rows).toBe(1);
    expect(listed[0].unmapped).toBe(0);
  });

  it("reports zero rows for an event whose participations were all stripped", async () => {
    const { activityService, eventService } = createServices(DB);
    await activityService.create({ key: "counts_empty_e2e", name: "Counts Empty", unit_label: "Points" });

    // value must be > 0 to be logged, so a zero-value row is skipped and the event lands with none.
    await eventService.create({
      activity: "counts_empty_e2e",
      date: "2026-04-08",
      rows: [{ raw_name: "CountsNobody", value: 0 }],
    });

    const listed = await eventService.list({ activity: "counts_empty_e2e" });

    expect(listed).toHaveLength(1);
    expect(listed[0].rows).toBe(0);
    expect(listed[0].unmapped).toBe(0);
  });

  it("scopes rows/unmapped per event, not merged across events under the same activity", async () => {
    const { activityService, eventService } = createServices(DB);
    await activityService.create({ key: "counts_multi_e2e", name: "Counts Multi", unit_label: "Points" });
    await seedMember("CountsMultiAlice");
    await seedMember("CountsMultiBob");

    // Two events, different dates (default max_instance is 1, so same-date would collide on key),
    // deliberately given different row counts AND different unmapped counts so a correlation that
    // leaked across events (e.g. an unscoped subquery) would show up as identical/wrong numbers.
    await eventService.create({
      activity: "counts_multi_e2e",
      date: "2026-05-11",
      rows: [
        { raw_name: "CountsMultiAlice", value: 100 },
        { raw_name: "CountsMultiGhostOne", value: 50 },
      ],
    });
    await eventService.create({
      activity: "counts_multi_e2e",
      date: "2026-05-12",
      rows: [
        { raw_name: "CountsMultiBob", value: 100 },
        { raw_name: "CountsMultiGhostTwo", value: 50 },
        { raw_name: "CountsMultiGhostThree", value: 50 },
      ],
    });

    const listed = await eventService.list({ activity: "counts_multi_e2e" });

    expect(listed).toHaveLength(2);
    const first = listed.find((e) => e.date === "2026-05-11");
    const second = listed.find((e) => e.date === "2026-05-12");
    expect(first?.rows).toBe(2);
    expect(first?.unmapped).toBe(1);
    expect(second?.rows).toBe(3);
    expect(second?.unmapped).toBe(2);
  });
});

describe("EventService.list filters carry the counts (aliased FROM)", () => {
  it("filters by week and still returns the counts for the matching event only", async () => {
    const { activityService, eventService } = createServices(DB);
    await activityService.create({ key: "counts_week_e2e", name: "Counts Week", unit_label: "Points" });
    await seedMember("CountsWeekAlice");

    const inWeek = await eventService.create({
      activity: "counts_week_e2e",
      date: "2026-05-04",
      rows: [
        { raw_name: "CountsWeekAlice", value: 100 },
        { raw_name: "CountsWeekGhost", value: 50 },
      ],
    });
    // A second event, same activity, a different week — the week filter must exclude it.
    await eventService.create({
      activity: "counts_week_e2e",
      date: "2026-05-18",
      rows: [{ raw_name: "CountsWeekAlice", value: 100 }],
    });

    const listed = await eventService.list({ activity: "counts_week_e2e", week: inWeek.event.week });

    expect(listed).toHaveLength(1);
    expect(listed[0].date).toBe("2026-05-04");
    expect(listed[0].rows).toBe(2);
    expect(listed[0].unmapped).toBe(1);
  });

  it("filters by from/to date range and still returns the counts for the matching event only", async () => {
    const { activityService, eventService } = createServices(DB);
    await activityService.create({ key: "counts_range_e2e", name: "Counts Range", unit_label: "Points" });
    await seedMember("CountsRangeAlice");

    await eventService.create({
      activity: "counts_range_e2e",
      date: "2026-05-25",
      rows: [{ raw_name: "CountsRangeAlice", value: 100 }],
    });
    const inRange = await eventService.create({
      activity: "counts_range_e2e",
      date: "2026-06-01",
      rows: [
        { raw_name: "CountsRangeAlice", value: 100 },
        { raw_name: "CountsRangeGhost", value: 50 },
      ],
    });
    await eventService.create({
      activity: "counts_range_e2e",
      date: "2026-06-08",
      rows: [{ raw_name: "CountsRangeAlice", value: 100 }],
    });

    const listed = await eventService.list({
      activity: "counts_range_e2e",
      from: "2026-05-26",
      to: "2026-06-05",
    });

    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(inRange.event.id);
    expect(listed[0].rows).toBe(2);
    expect(listed[0].unmapped).toBe(1);
  });
});
