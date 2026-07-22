import { SELF } from "cloudflare:test";
import { VIEWER } from "./keys";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { ActivityRepo } from "../../src/repositories/activity-repo";
import { ParticipationRepo } from "../../src/repositories/participation-repo";
import { createServices } from "../../src/services";

const { DB, SEED_STATEMENTS } = env;

const AUTH = { "X-Api-Key": "test-key" };

// Fresh migrated D1 per file, storage NOT reset between `it` blocks — use unique keys per test. The default
// config is seeded so the weight-change tests can ingest and score real participations.
beforeAll(async () => {
  for (const stmt of SEED_STATEMENTS) {
    await DB.prepare(stmt).run();
  }
});

function makeService() {
  return createServices(DB).activityService;
}

async function seededContribution() {
  const contribution = await new ActivityRepo(DB).getByKey("contribution");
  if (!contribution) throw new Error("seed did not create the contribution activity");
  return contribution;
}

describe("ActivityService", () => {
  it("creates a new activity type and round-trips it via getById and list", async () => {
    const service = makeService();

    const created = await service.create({ key: "at_create", name: "Create Test", unit_label: "Damage" });
    expect(created.id).toBeGreaterThan(0);
    expect(created.key).toBe("at_create");
    expect(created.weight).toBe(1);
    expect(created.max_instance).toBe(1);
    expect(created.min_value).toBe(0);
    expect(created.active).toBe(1);
    expect(created.sort).toBe(0);

    const found = await service.get(created.id);
    expect(found).toEqual(created);

    const listed = await service.list();
    expect(listed.map((a) => a.key)).toContain("at_create");
  });

  it("filters by active in list()", async () => {
    const service = makeService();

    const activeType = await service.create({ key: "at_active", name: "Active" });
    const inactiveType = await service.create({ key: "at_inactive", name: "Inactive", active: 0 });

    const actives = await service.list({ active: true });
    expect(actives.map((a) => a.key)).toContain("at_active");
    expect(actives.map((a) => a.key)).not.toContain("at_inactive");

    const inactives = await service.list({ active: false });
    expect(inactives.map((a) => a.key)).toContain("at_inactive");
    expect(inactives.map((a) => a.key)).not.toContain("at_active");

    const all = await service.list();
    const allKeys = all.map((a) => a.key);
    expect(allKeys).toEqual(expect.arrayContaining([activeType.key, inactiveType.key]));
  });

  it("updates provided fields and returns null for an unknown id", async () => {
    const service = makeService();

    const created = await service.create({ key: "at_update", name: "Before" });
    const updated = await service.update(created.id, { name: "After", weight: 5, max_instance: 2 });
    expect(updated?.name).toBe("After");
    expect(updated?.weight).toBe(5);
    expect(updated?.max_instance).toBe(2);
    expect(updated?.key).toBe("at_update");

    expect(await service.update(999999, { name: "Nope" })).toBeNull();
  });

  it("deactivates an activity type", async () => {
    const service = makeService();

    const created = await service.create({ key: "at_deactivate", name: "Deactivate" });
    expect(created.active).toBe(1);

    await service.deactivate(created.id);
    const found = await service.get(created.id);
    expect(found?.active).toBe(0);
  });

  it("rejects invalid create input", async () => {
    const service = makeService();

    await expect(service.create({ key: "", name: "Empty Key" })).rejects.toThrow();
    await expect(service.create({ key: "at_valid", name: "" })).rejects.toThrow();
    await expect(service.create({ key: "at_neg_weight", name: "Neg", weight: -1 })).rejects.toThrow();
    await expect(service.create({ key: "at_zero_instance", name: "Zero", max_instance: 0 })).rejects.toThrow();
  });

  it("rejects a duplicate key (UNIQUE constraint)", async () => {
    const service = makeService();

    await service.create({ key: "at_dup", name: "First" });
    await expect(service.create({ key: "at_dup", name: "Second" })).rejects.toThrow(/UNIQUE/i);
  });

  it("defaults color to slate when not provided on create", async () => {
    const service = makeService();

    const created = await service.create({ key: "at_color_default", name: "Color Default" });
    expect(created.color).toBe("slate");
  });

  it("rejects an invalid color on create", async () => {
    const service = makeService();

    await expect(
      service.create({ key: "at_color_invalid", name: "Color Invalid", color: "teal" }),
    ).rejects.toThrow();
  });

  it("persists a valid color on update", async () => {
    const service = makeService();

    const created = await service.create({ key: "at_color_update", name: "Color Update" });
    const updated = await service.update(created.id, { color: "sky" });
    expect(updated?.color).toBe("sky");
  });

  it("rejects an invalid color on update", async () => {
    const service = makeService();

    const created = await service.create({ key: "at_color_update_invalid", name: "Color Update Invalid" });
    await expect(service.update(created.id, { color: "teal" })).rejects.toThrow();
  });

  it("re-scores stored points when weight changes", async () => {
    const { activityService, eventService, memberService } = createServices(DB);

    await memberService.create({ governor: "WeightRecompute" });
    const contribution = await seededContribution();
    const ingest = await eventService.create({
      activity: contribution.key,
      date: "2026-10-05",
      rows: [{ raw_name: "WeightRecompute", value: 150000 }],
    });
    const before = ingest.rows[0].points;
    expect(before).toBeGreaterThan(0);

    // Points are tier x weight, so doubling the weight doubles every stored point value.
    const updated = await activityService.update(contribution.id, { weight: contribution.weight * 2 });
    expect(updated?.weight).toBe(contribution.weight * 2);
    const doubled = await eventService.get(ingest.event.id);
    expect(doubled?.participations[0].points).toBe(before * 2);

    // Restore the seeded weight (storage is shared) — which recomputes back down again.
    await activityService.update(contribution.id, { weight: contribution.weight });
    const restored = await eventService.get(ingest.event.id);
    expect(restored?.participations[0].points).toBe(before);
  });

  it("does not recompute for a non-scoring field (color), but does for weight", async () => {
    const { activityService, eventService, memberService } = createServices(DB);

    await memberService.create({ governor: "ColorNoRecompute" });
    const contribution = await seededContribution();
    const ingest = await eventService.create({
      activity: contribution.key,
      date: "2026-10-06",
      rows: [{ raw_name: "ColorNoRecompute", value: 150000 }],
    });
    const row = ingest.rows[0];

    // Deliberately store a wrong point value: only a recompute puts it back.
    await new ParticipationRepo(DB).applyRecompute([
      { id: row.id, member_id: row.member_id, points: row.points + 1 },
    ]);

    await activityService.update(contribution.id, { color: "sky" });
    const afterColor = await eventService.get(ingest.event.id);
    expect(afterColor?.participations[0].points).toBe(row.points + 1);

    // Writing weight — even the same value — re-evaluates every row against the current config, so a
    // row whose stored points had drifted is written back. Rows already correct are left untouched.
    await activityService.update(contribution.id, { weight: contribution.weight });
    const afterWeight = await eventService.get(ingest.event.id);
    expect(afterWeight?.participations[0].points).toBe(row.points);
  });

  it("rejects lowering max_instance below an instance already logged", async () => {
    const { activityService, eventService, memberService } = createServices(DB);

    const twoTrap = await activityService.create({
      key: "at_max_instance_used",
      name: "Max Instance Used",
      max_instance: 2,
    });
    await memberService.create({ governor: "MaxInstanceMember" });
    await eventService.create({
      activity: twoTrap.key,
      date: "2026-10-07",
      instance: 2,
      rows: [{ raw_name: "MaxInstanceMember", value: 100 }],
    });

    await expect(activityService.update(twoTrap.id, { max_instance: 1 })).rejects.toThrow(/max_instance/);
    expect((await activityService.get(twoTrap.id))?.max_instance).toBe(2);

    // Still allowed when nothing is logged at the instance being dropped.
    const unused = await activityService.create({
      key: "at_max_instance_unused",
      name: "Max Instance Unused",
      max_instance: 2,
    });
    expect((await activityService.update(unused.id, { max_instance: 1 }))?.max_instance).toBe(1);
  });
});

describe("activity-types HTTP routes", () => {
  it("POST creates (201) and round-trips, then GET / lists it", async () => {
    const res = await SELF.fetch("https://example.com/api/activity-types", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ key: "http_create", name: "HTTP Create", unit_label: "Damage" }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: number; key: string; name: string };
    expect(created.id).toBeGreaterThan(0);
    expect(created.key).toBe("http_create");

    const listRes = await SELF.fetch("https://example.com/api/activity-types", { headers: VIEWER });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { key: string }[];
    expect(list.map((a) => a.key)).toContain("http_create");
  });

  it("POST with a duplicate key returns 409", async () => {
    const first = await SELF.fetch("https://example.com/api/activity-types", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ key: "http_dup", name: "First" }),
    });
    expect(first.status).toBe(201);

    const dup = await SELF.fetch("https://example.com/api/activity-types", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ key: "http_dup", name: "Second" }),
    });
    expect(dup.status).toBe(409);
  });

  it("GET /:id/scoring still resolves (GET /:id does not shadow the scoring sub-route)", async () => {
    const created = await makeService().create({ key: "http_scoring", name: "HTTP Scoring", weight: 3 });

    const res = await SELF.fetch(`https://example.com/api/activity-types/${created.id}/scoring`, { headers: VIEWER });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { weight: number; tiers: unknown[] };
    expect(body.weight).toBe(3);
    expect(Array.isArray(body.tiers)).toBe(true);
  });

  it("PATCH with a duplicate key returns 409, and PATCH unknown id returns 404", async () => {
    const service = makeService();
    await service.create({ key: "http_patch_taken", name: "Taken" });
    const target = await service.create({ key: "http_patch_target", name: "Target" });

    const collide = await SELF.fetch(`https://example.com/api/activity-types/${target.id}`, {
      method: "PATCH",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ key: "http_patch_taken" }),
    });
    expect(collide.status).toBe(409);

    const missing = await SELF.fetch("https://example.com/api/activity-types/999999", {
      method: "PATCH",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    });
    expect(missing.status).toBe(404);
  });

  it("PATCH lowering max_instance below a logged instance returns 400", async () => {
    const { activityService, eventService, memberService } = createServices(DB);

    const twoTrap = await activityService.create({
      key: "http_max_instance",
      name: "HTTP Max Instance",
      max_instance: 2,
    });
    await memberService.create({ governor: "HttpMaxInstanceMember" });
    await eventService.create({
      activity: twoTrap.key,
      date: "2026-10-08",
      instance: 2,
      rows: [{ raw_name: "HttpMaxInstanceMember", value: 100 }],
    });

    const res = await SELF.fetch(`https://example.com/api/activity-types/${twoTrap.id}`, {
      method: "PATCH",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ max_instance: 1 }),
    });
    expect(res.status).toBe(400);
    expect((await activityService.get(twoTrap.id))?.max_instance).toBe(2);
  });

  it("GET /:id with a non-numeric id returns 400", async () => {
    const res = await SELF.fetch("https://example.com/api/activity-types/not-a-number", { headers: VIEWER });
    expect(res.status).toBe(400);
  });
});
