import { SELF } from "cloudflare:test";
import { VIEWER } from "./keys";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { AliasRepo } from "../../src/repositories/alias-repo";
import { createServices } from "../../src/services";

const { DB, SEED_STATEMENTS } = env;

const AUTH = { "X-Api-Key": "test-key" };
const ADMIN_AUTH = { "X-Api-Key": "test-admin-key" };

// Fresh migrated D1 per file; storage NOT reset between `it` blocks — every test uses distinct member
// governors, aliases, dates, and raw names so writes from one test never collide with another. Seed default
// scoring config so the map/unmap recompute tests can score real participations.
beforeAll(async () => {
  for (const stmt of SEED_STATEMENTS) {
    await DB.prepare(stmt).run();
  }
});

describe("AliasService", () => {
  it("add maps an unmapped appearance onto the member, recomputes scores, and clears it from the queue", async () => {
    const { aliasService, eventService, memberService } = createServices(DB);

    const member = await memberService.create({ governor: "MapMember" });

    // Logged under an unknown rename — resolves to NULL/unmapped after ingest.
    const event = await eventService.create({
      activity: "contribution",
      date: "2026-10-05",
      rows: [{ raw_name: "MapRename_xyz", value: 25000 }],
    });
    expect(event.rows[0].member_id).toBeNull();
    expect(event.rows[0].points).toBe(1); // scored regardless of resolution (contribution 20000 -> 1)

    // The unmapped queue lists it, with where it appeared.
    const queueBefore = await eventService.listUnmapped();
    const entryBefore = queueBefore.find((e) => e.raw_name === "MapRename_xyz");
    expect(entryBefore).toBeDefined();
    expect(entryBefore?.appearances).toContainEqual({
      event_id: event.event.id,
      activity: "contribution",
      date: "2026-10-05",
      instance: 1,
    });

    // Map it: the alias add triggers recompute.
    const result = await aliasService.add({ alias: "MapRename_xyz", member_id: member.id });
    expect(result.alias?.alias).toBe("MapRename_xyz");
    expect(result.recomputed).toBeGreaterThan(0);

    // The participation now resolves to the member, with unchanged points.
    const after = await eventService.get(event.event.id);
    expect(after?.participations[0].member_id).toBe(member.id);
    expect(after?.participations[0].points).toBe(1);

    // The queue no longer lists it.
    const queueAfter = await eventService.listUnmapped();
    expect(queueAfter.map((e) => e.raw_name)).not.toContain("MapRename_xyz");
  });

  it("remove reverts resolution to NULL/unmapped and recomputes", async () => {
    const { aliasService, eventService, memberService } = createServices(DB);

    const member = await memberService.create({ governor: "UnmapMember" });
    const event = await eventService.create({
      activity: "contribution",
      date: "2026-10-12",
      rows: [{ raw_name: "UnmapRename_xyz", value: 25000 }],
    });

    const added = await aliasService.add({ alias: "UnmapRename_xyz", member_id: member.id });
    expect((await eventService.get(event.event.id))?.participations[0].member_id).toBe(member.id);

    const removed = await aliasService.remove(added.alias!.id);
    expect(removed.recomputed).toBeGreaterThan(0);

    // Back to NULL/unmapped and surfaced in the queue again.
    const after = await eventService.get(event.event.id);
    expect(after?.participations[0].member_id).toBeNull();
    const queue = await eventService.listUnmapped();
    expect(queue.map((e) => e.raw_name)).toContain("UnmapRename_xyz");
  });

  it("list filters by member_id", async () => {
    const { aliasService, memberService } = createServices(DB);

    const member = await memberService.create({ governor: "ListAliasMember" });
    await aliasService.add({ alias: "ListAliasA", member_id: member.id });
    await aliasService.add({ alias: "ListAliasB", member_id: member.id });

    const mine = await aliasService.list({ member_id: member.id });
    expect(mine.map((a) => a.alias).sort()).toEqual(["ListAliasA", "ListAliasB"]);
    expect(mine.every((a) => a.member_id === member.id)).toBe(true);
  });

  it("rejects an alias equal to an existing governor or another alias (409 conflict)", async () => {
    const { aliasService, memberService } = createServices(DB);

    const member = await memberService.create({ governor: "ConflictGovernor" });

    // Equal to an existing governor.
    await expect(aliasService.add({ alias: "ConflictGovernor", member_id: member.id })).rejects.toThrow(
      /conflict/,
    );

    // Equal to another existing alias.
    await aliasService.add({ alias: "ConflictAlias", member_id: member.id });
    await expect(aliasService.add({ alias: "ConflictAlias", member_id: member.id })).rejects.toThrow(
      /conflict/,
    );
  });

  it("rejects an alias whose NFD form normalizes to an existing NFC governor (normalized guard)", async () => {
    const { aliasService, memberService } = createServices(DB);

    // Governor stored NFC ("é" = U+00E9); the attempted alias uses the NFD form ("e" + U+0301).
    const nfcGovernor = "Caf\u00e9AliasGov"; // composed (NFC)
    const nfdAlias = "Cafe\u0301AliasGov"; // decomposed (NFD) — same normalized key

    const member = await memberService.create({ governor: nfcGovernor });
    await expect(aliasService.add({ alias: nfdAlias, member_id: member.id })).rejects.toThrow(/conflict/);
  });

  it("rejects an alias for a non-existent member (not found)", async () => {
    const { aliasService } = createServices(DB);
    await expect(aliasService.add({ alias: "OrphanAlias", member_id: 999999 })).rejects.toThrow(
      /not found/,
    );
  });

  it("rejects an empty alias", async () => {
    const { aliasService, memberService } = createServices(DB);
    const member = await memberService.create({ governor: "EmptyAliasMember" });
    await expect(aliasService.add({ alias: "   ", member_id: member.id })).rejects.toThrow();
  });

  it("rejects a non-empty alias that normalizes to an empty name (dead mapping)", async () => {
    const { aliasService, memberService } = createServices(DB);
    const member = await memberService.create({ governor: "DeadAliasMember" });
    // "[ABC]" is non-empty but normalizeName strips the tag, leaving "" — it could never resolve.
    await expect(aliasService.add({ alias: "[ABC]", member_id: member.id })).rejects.toThrow();

    // Over HTTP it's a 400 bad request, not a conflict or not-found.
    const res = await SELF.fetch("https://example.com/api/aliases", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ alias: "[ABC]", member_id: member.id }),
    });
    expect(res.status).toBe(400);
  });

  it("throws alias not found when removing a missing alias", async () => {
    const { aliasService } = createServices(DB);
    await expect(aliasService.remove(999999)).rejects.toThrow(/not found/);
  });

  it("surfaces a retroactive within-event duplicate in the response without failing the recompute", async () => {
    const { aliasService, eventService, memberService } = createServices(DB);

    const member = await memberService.create({ governor: "RetroDup" });

    // Two rows in one event: the governor resolves to the member, the ghost is NULL — no duplicate yet.
    const event = await eventService.create({
      activity: "contribution",
      date: "2026-10-19",
      rows: [
        { raw_name: "RetroDup", value: 25000 },
        { raw_name: "RetroDupGhost", value: 30000 },
      ],
    });
    expect(event.rows.find((r) => r.raw_name === "RetroDupGhost")?.member_id).toBeNull();

    // Mapping the ghost makes both rows resolve to the same member within the event.
    const result = await aliasService.add({ alias: "RetroDupGhost", member_id: member.id });

    // Recompute did NOT fail — both rows now attach to the member.
    const after = await eventService.get(event.event.id);
    expect(after?.participations.every((p) => p.member_id === member.id)).toBe(true);

    // …and the conflict is surfaced in the response.
    const conflict = result.conflicts.find(
      (c) => c.type === "within_event_duplicate" && c.event_id === event.event.id,
    );
    expect(conflict).toBeDefined();
    if (conflict?.type === "within_event_duplicate") {
      expect(conflict.member_id).toBe(member.id);
      expect(conflict.raw_names.sort()).toEqual(["RetroDup", "RetroDupGhost"]);
    }
  });

  it("surfaces a retroactive two-trap overlap in the response without failing the recompute", async () => {
    const { aliasService, eventService, memberService } = createServices(DB);

    const member = await memberService.create({ governor: "RetroTrap" });

    // Trap 1 logs the governor; trap 2 logs an unknown ghost — resolved identities differ, so it's allowed.
    await eventService.create({
      activity: "bear_trap",
      date: "2026-10-26",
      instance: 1,
      rows: [{ raw_name: "RetroTrap", value: 100 }],
    });
    await eventService.create({
      activity: "bear_trap",
      date: "2026-10-26",
      instance: 2,
      rows: [{ raw_name: "RetroTrapGhost", value: 200 }],
    });

    // Mapping the ghost makes the same member appear in both traps on that date.
    const result = await aliasService.add({ alias: "RetroTrapGhost", member_id: member.id });

    const conflict = result.conflicts.find(
      (c) => c.type === "two_trap_overlap" && c.date === "2026-10-26",
    );
    expect(conflict).toBeDefined();
  });
});

describe("aliases HTTP routes", () => {
  it("POST creates (201) and round-trips, GET / lists it, GET ?member= filters", async () => {
    const { memberService } = createServices(DB);
    const member = await memberService.create({ governor: "HttpAliasMember" });

    const res = await SELF.fetch("https://example.com/api/aliases", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ alias: "HttpAlias", member_id: member.id }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { alias: { id: number; alias: string }; conflicts: unknown[] };
    expect(created.alias.alias).toBe("HttpAlias");

    const listRes = await SELF.fetch(`https://example.com/api/aliases?member=${member.id}`, { headers: VIEWER });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { alias: string }[];
    expect(list.map((a) => a.alias)).toContain("HttpAlias");
  });

  it("POST an alias equal to an existing governor returns 409", async () => {
    const { memberService } = createServices(DB);
    const member = await memberService.create({ governor: "HttpConflictGov" });

    const res = await SELF.fetch("https://example.com/api/aliases", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ alias: "HttpConflictGov", member_id: member.id }),
    });
    expect(res.status).toBe(409);
  });

  it("POST a conflicting alias whose text contains 'not found' still returns 409 (conflict wins)", async () => {
    const { memberService } = createServices(DB);
    // Governor is literally "not found"; adding it as an alias (for a valid member) conflicts — the 409
    // signal must win over the "not found" substring in the interpolated conflict message.
    const member = await memberService.create({ governor: "not found" });

    const res = await SELF.fetch("https://example.com/api/aliases", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ alias: "not found", member_id: member.id }),
    });
    expect(res.status).toBe(409);
  });

  it("POST an alias for a missing member returns 404", async () => {
    const res = await SELF.fetch("https://example.com/api/aliases", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ alias: "HttpOrphanAlias", member_id: 999999 }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE removes an alias; a missing id returns 404 and a non-numeric id returns 400", async () => {
    const { memberService } = createServices(DB);
    const member = await memberService.create({ governor: "HttpDelAliasMember" });
    const alias = await new AliasRepo(DB).insert({
      alias: "HttpDelAlias",
      member_id: member.id,
      note: null,
    });

    const del = await SELF.fetch(`https://example.com/api/aliases/${alias.id}`, {
      method: "DELETE",
      headers: ADMIN_AUTH,
    });
    expect(del.status).toBe(200);
    expect(await new AliasRepo(DB).getById(alias.id)).toBeNull();

    const missing = await SELF.fetch(`https://example.com/api/aliases/${alias.id}`, {
      method: "DELETE",
      headers: ADMIN_AUTH,
    });
    expect(missing.status).toBe(404);

    const bad = await SELF.fetch("https://example.com/api/aliases/not-a-number", {
      method: "DELETE",
      headers: ADMIN_AUTH,
    });
    expect(bad.status).toBe(400);
  });

  it("GET /api/unmapped lists NULL raw names with their appearances and needs no API key", async () => {
    const { eventService } = createServices(DB);
    await eventService.create({
      activity: "contribution",
      date: "2026-11-02",
      rows: [{ raw_name: "HttpUnmapped_xyz", value: 25000 }],
    });

    const res = await SELF.fetch("https://example.com/api/unmapped", { headers: VIEWER });
    expect(res.status).toBe(200);
    const queue = (await res.json()) as {
      raw_name: string;
      appearances: { activity: string; date: string }[];
    }[];
    const entry = queue.find((e) => e.raw_name === "HttpUnmapped_xyz");
    expect(entry).toBeDefined();
    expect(entry?.appearances[0].date).toBe("2026-11-02");
  });
});
