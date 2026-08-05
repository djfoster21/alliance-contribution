import { SELF } from "cloudflare:test";
import { VIEWER } from "./keys";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { AliasRepo } from "../../src/repositories/alias-repo";
import { MemberRepo } from "../../src/repositories/member-repo";
import { SnapshotRepo } from "../../src/repositories/snapshot-repo";
import { createServices } from "../../src/services";
import type { UpdateMemberInput } from "../../src/services/member-service";
import type { CaptureRosterRow, CaptureSummary, MemberDelta, MemberSnapshotSeries } from "../../shared/types";

const { DB, SEED_STATEMENTS } = env;

const AUTH = { "X-Api-Key": "test-key" };
const ADMIN_AUTH = { "X-Api-Key": "test-admin-key" };

// Fresh migrated D1 per file; storage NOT reset between `it` blocks — every test uses distinct member
// governors and aliases so writes from one test never collide with another. Seed default scoring config
// so the rename/recompute tests can score real participations.
beforeAll(async () => {
  for (const stmt of SEED_STATEMENTS) {
    await DB.prepare(stmt).run();
  }
});

describe("MemberService", () => {
  it("creates + gets + lists (active filter) and deactivate sets active=0", async () => {
    const { memberService } = createServices(DB);

    const created = await memberService.create({ governor: "MemCreate", alliance_rank: "R4", power: 1000 });
    expect(created.id).toBeGreaterThan(0);
    expect(created.governor).toBe("MemCreate");
    expect(created.alliance_rank).toBe("R4");
    expect(created.power).toBe(1000);
    expect(created.active).toBe(1);

    const found = await memberService.get(created.id);
    expect(found).toEqual(created);

    const inactive = await memberService.create({ governor: "MemInactive", active: 0 });

    const actives = await memberService.list({ active: true });
    expect(actives.map((m) => m.governor)).toContain("MemCreate");
    expect(actives.map((m) => m.governor)).not.toContain("MemInactive");

    const inactives = await memberService.list({ active: false });
    expect(inactives.map((m) => m.governor)).toContain("MemInactive");

    const all = await memberService.list();
    expect(all.map((m) => m.governor)).toEqual(
      expect.arrayContaining([created.governor, inactive.governor]),
    );

    await memberService.deactivate(created.id);
    expect((await memberService.get(created.id))?.active).toBe(0);
  });

  it("updates partial fields and returns null for an unknown id", async () => {
    const { memberService } = createServices(DB);

    const created = await memberService.create({ governor: "MemUpdate", alliance_rank: "R3" });
    const updated = await memberService.update(created.id, { alliance_rank: "R5", power: 5000 });
    expect(updated?.alliance_rank).toBe("R5");
    expect(updated?.power).toBe(5000);
    expect(updated?.governor).toBe("MemUpdate");

    expect(await memberService.update(999999, { alliance_rank: "R1" })).toBeNull();
  });

  it("rejects an unknown field instead of silently applying zero assignments", async () => {
    const { memberService } = createServices(DB);
    const created = await memberService.create({ governor: "MemUnknownField", alliance_rank: "R3" });

    await expect(
      memberService.update(created.id, { role: "R4" } as unknown as UpdateMemberInput),
    ).rejects.toThrow(/unknown field/);
    await expect(
      memberService.update(created.id, { rank_snapshot: "R4" } as unknown as UpdateMemberInput),
    ).rejects.toThrow(/unknown field/);

    // A valid patch still succeeds after the rejected ones.
    const updated = await memberService.update(created.id, { alliance_rank: "R5" });
    expect(updated?.alliance_rank).toBe("R5");
  });

  it("rejects an empty governor on create", async () => {
    const { memberService } = createServices(DB);
    await expect(memberService.create({ governor: "  " })).rejects.toThrow(
      /governor must be a non-empty string/,
    );
  });

  // members.alliance_rank has no CHECK but member_snapshots.alliance_rank does, so an out-of-set rank
  // stored here would not blow up until the NEXT import — mid-apply, after other writes had committed.
  it("rejects an alliance_rank outside R1-R5 on create and on update", async () => {
    const { memberService } = createServices(DB);

    await expect(
      memberService.create({ governor: "BadRankCreate", alliance_rank: "R6" }),
    ).rejects.toThrow(/alliance_rank/);
    expect(await new MemberRepo(DB).getByGovernor("BadRankCreate")).toBeNull();

    const member = await memberService.create({ governor: "BadRankUpdate", alliance_rank: "R3" });
    await expect(memberService.update(member.id, { alliance_rank: "R6" })).rejects.toThrow(/alliance_rank/);
    expect((await memberService.get(member.id))?.alliance_rank).toBe("R3");

    // null stays legal — it is how an unreadable badge is recorded.
    expect((await memberService.update(member.id, { alliance_rank: null }))?.alliance_rank).toBeNull();
  });

  it("rejects a duplicate governor (UNIQUE constraint)", async () => {
    const { memberService } = createServices(DB);
    await memberService.create({ governor: "MemDup" });
    await expect(memberService.create({ governor: "MemDup" })).rejects.toThrow(/UNIQUE/i);
  });

  it("shadowing guard: create/rename to a governor equal to an existing alias is rejected", async () => {
    const { memberService } = createServices(DB);

    const owner = await memberService.create({ governor: "ShadowOwner" });
    await new AliasRepo(DB).insert({ alias: "ShadowAlias", member_id: owner.id, note: null });

    await expect(memberService.create({ governor: "ShadowAlias" })).rejects.toThrow(/shadow|conflict/);

    const renameTarget = await memberService.create({ governor: "ShadowRenameTarget" });
    await expect(memberService.rename(renameTarget.id, "ShadowAlias")).rejects.toThrow(/shadow|conflict/);
  });

  it("rejects a governor change via update — rename is the only governor path", async () => {
    const { memberService } = createServices(DB);

    const member = await memberService.create({ governor: "NoPatchGovernor" });
    await expect(
      memberService.update(member.id, { governor: "PatchedName" } as UpdateMemberInput),
    ).rejects.toThrow(/governor cannot be changed/);
    expect((await memberService.get(member.id))?.governor).toBe("NoPatchGovernor");
  });

  it("shadowing guard compares on the normalized key (NFD governor vs NFC alias)", async () => {
    const { memberService } = createServices(DB);

    // The alias is stored in NFC ("é" = U+00E9); the attempted governor uses the NFD form
    // ("e" + combining acute U+0301). They are not byte-identical but normalize to the same key.
    const nfcAlias = "Caf\u00e9Shadow"; // \u00e9 = composed (NFC)
    const nfdGovernor = "Cafe\u0301Shadow"; // e + \u0301 combining acute = decomposed (NFD)

    const owner = await memberService.create({ governor: "NormShadowOwner" });
    await new AliasRepo(DB).insert({ alias: nfcAlias, member_id: owner.id, note: null });

    await expect(memberService.create({ governor: nfdGovernor })).rejects.toThrow(/shadow|conflict/);

    const renameTarget = await memberService.create({ governor: "NormShadowRenameTarget" });
    await expect(memberService.rename(renameTarget.id, nfdGovernor)).rejects.toThrow(/shadow|conflict/);
  });

  // members.governor UNIQUE is BYTE-exact but resolution compares on the normalized key, so without a
  // normalized gate "Zeta" and "[ABC]Zeta" both insert and every row logged under the first silently
  // resolves to the second — two people merged into one identity, no error anywhere.
  it("rejects a create whose governor normalizes onto an existing governor (alliance tag)", async () => {
    const { memberService, resolveService } = createServices(DB);

    const first = await memberService.create({ governor: "MergeZeta" });
    await expect(memberService.create({ governor: "[ABC]MergeZeta" })).rejects.toThrow(
      /duplicates an existing member/,
    );

    expect(await new MemberRepo(DB).getByGovernor("[ABC]MergeZeta")).toBeNull();
    expect(await resolveService.resolve("MergeZeta")).toBe(first.id);
  });

  it("rejects a create whose governor normalizes onto an existing governor (NFC vs NFD)", async () => {
    const { memberService, resolveService } = createServices(DB);

    const nfc = "MergeRen\u00e9"; // \u00e9 = composed (NFC)
    const nfd = "MergeRene\u0301"; // e + \u0301 combining acute = decomposed (NFD)

    const first = await memberService.create({ governor: nfc });
    await expect(memberService.create({ governor: nfd })).rejects.toThrow(
      /duplicates an existing member/,
    );

    expect(await new MemberRepo(DB).getByGovernor(nfd)).toBeNull();
    expect(await resolveService.resolve(nfd)).toBe(first.id);
  });

  it("rejects a create whose governor normalizes to an empty name", async () => {
    const { memberService } = createServices(DB);
    await expect(memberService.create({ governor: "[ABC]" })).rejects.toThrow(
      /normalizes to an empty name/,
    );
  });

  // The alliance deliberately cycles names, so reverting to a name this member used before is routine —
  // and the old name is by then one of their OWN aliases. That must not read as a shadowing conflict.
  it("allows renaming a member back to one of their own aliases", async () => {
    const { memberService, eventService } = createServices(DB);

    const member = await memberService.create({ governor: "CycleA" });
    const event = await eventService.create({
      activity: "contribution",
      date: "2026-09-28",
      rows: [{ raw_name: "CycleA", value: 25000 }],
    });
    expect(event.rows[0].member_id).toBe(member.id);

    // A -> B leaves "CycleA" as an alias of this member.
    await memberService.rename(member.id, "CycleB");
    expect(await new AliasRepo(DB).getByAlias("CycleA")).not.toBeNull();

    // B -> A: "CycleA" is an alias, but it is THIS member's alias, so it is a rename-back, not a merge.
    const back = await memberService.rename(member.id, "CycleA");
    expect(back.member.governor).toBe("CycleA");
    expect(back.addedAlias).toBe(true);
    expect(back.warning).toBeUndefined();

    // "CycleB" was kept as the alias this time; the redundant re-insert of "CycleA" was skipped.
    expect(await new AliasRepo(DB).getByAlias("CycleB")).not.toBeNull();
    expect((await new AliasRepo(DB).list({ member_id: member.id })).filter((a) => a.alias === "CycleA"))
      .toHaveLength(1);

    // A -> B again: now BOTH names are already this member's aliases, so the old-governor insert must be
    // skipped rather than tripping aliases.alias UNIQUE. This is the leg that keeps cycling possible.
    const again = await memberService.rename(member.id, "CycleB");
    expect(again.member.governor).toBe("CycleB");
    expect(again.addedAlias).toBe(true);
    expect((await new AliasRepo(DB).list({ member_id: member.id })).filter((a) => a.alias === "CycleA"))
      .toHaveLength(1);

    // The history logged under the original name survives the round trip with unchanged points.
    const after = await eventService.get(event.event.id);
    expect(after?.participations[0].member_id).toBe(member.id);
    expect(after?.participations[0].points).toBe(1);
  });

  it("canonical rename keeps historical scores intact (old name becomes an alias by default)", async () => {
    const { memberService, eventService } = createServices(DB);

    const member = await memberService.create({ governor: "RenameOld" });

    // Log a contribution under the current governor — it resolves to the member and scores.
    const event = await eventService.create({
      activity: "contribution",
      date: "2026-09-07",
      rows: [{ raw_name: "RenameOld", value: 25000 }],
    });
    expect(event.rows[0].member_id).toBe(member.id);
    expect(event.rows[0].points).toBe(1);

    const result = await memberService.rename(member.id, "RenameNew");
    expect(result.member.governor).toBe("RenameNew");
    expect(result.addedAlias).toBe(true);
    expect(result.warning).toBeUndefined();

    // The historical row still resolves to the same member (old name is now an alias) with unchanged points.
    const after = await eventService.get(event.event.id);
    expect(after?.participations[0].member_id).toBe(member.id);
    expect(after?.participations[0].points).toBe(1);
    expect(after?.participations[0].raw_name).toBe("RenameOld");
  });

  it("rename opt-out warns and sends historical rows logged under the old governor to unmapped", async () => {
    const { memberService, eventService } = createServices(DB);

    const member = await memberService.create({ governor: "OptOutOld" });
    const event = await eventService.create({
      activity: "contribution",
      date: "2026-09-14",
      rows: [{ raw_name: "OptOutOld", value: 25000 }],
    });
    expect(event.rows[0].member_id).toBe(member.id);

    const result = await memberService.rename(member.id, "OptOutNew", { addAlias: false });
    expect(result.addedAlias).toBe(false);
    expect(result.warning).toBeTruthy();

    // No alias was added, so the row logged under the old governor is now NULL/unmapped.
    const after = await eventService.get(event.event.id);
    expect(after?.participations[0].member_id).toBeNull();
    // The old governor is not an alias.
    expect(await new AliasRepo(DB).getByAlias("OptOutOld")).toBeNull();
  });

  it("throws member not found when renaming a missing member", async () => {
    const { memberService } = createServices(DB);
    // Anchored: a rename that failed for any OTHER reason and happened to mention a missing member
    // (an alias owner, a post-write reread) would satisfy a bare /not found/.
    await expect(memberService.rename(999999, "Whoever")).rejects.toThrow(/^member not found$/);
  });
});

describe("MemberService.importRoster", () => {
  it("updates an existing member's meta from an updates entry", async () => {
    const { memberService } = createServices(DB);

    const member = await memberService.create({ governor: "ImpUpdate", alliance_rank: "R3", power: 100 });
    const result = await memberService.importRoster({
      captured_on: "2026-07-20",
      updates: [{ member_id: member.id, alliance_rank: "R5", power: 9000, power_position: 4 }],
      creates: [],
      aliases: [],
      deactivate: [],
      reactivate: [],
    });
    expect(result.updated).toBe(1);

    const after = await memberService.get(member.id);
    expect(after?.alliance_rank).toBe("R5");
    expect(after?.power).toBe(9000);
    expect(after?.power_position).toBe(4);
  });

  it("creates a brand-new active member from a creates entry", async () => {
    const { memberService } = createServices(DB);

    const result = await memberService.importRoster({
      captured_on: "2026-07-20",
      updates: [],
      creates: [{ governor: "ImpCreate", alliance_rank: "R4", power: 2500, power_position: 12 }],
      aliases: [],
      deactivate: [],
      reactivate: [],
    });
    expect(result.created).toBe(1);

    const found = await new MemberRepo(DB).getByGovernor("ImpCreate");
    expect(found).not.toBeNull();
    expect(found?.active).toBe(1);
    expect(found?.alliance_rank).toBe("R4");
    expect(found?.power).toBe(2500);
  });

  it("aliases a renamed name onto an existing member: recompute resolves the row and meta updates", async () => {
    const { memberService, eventService } = createServices(DB);

    const member = await memberService.create({ governor: "ImpAliasMember", alliance_rank: "R4", power: 1000 });

    // A participation is logged under a name the member now goes by — currently unmapped (NULL member).
    const event = await eventService.create({
      activity: "contribution",
      date: "2026-09-21",
      rows: [{ raw_name: "ImpAliasRenamed", value: 25000 }],
    });
    expect(event.rows[0].member_id).toBeNull();

    const result = await memberService.importRoster({
      captured_on: "2026-07-20",
      updates: [],
      creates: [],
      aliases: [{ alias: "ImpAliasRenamed", member_id: member.id, alliance_rank: "R5", power: 7777, power_position: 3 }],
      deactivate: [],
      reactivate: [],
    });
    expect(result.aliased).toBe(1);
    expect(result.recomputed).toBeGreaterThan(0);

    // The previously-unmapped row now resolves to the member via the new alias, with its points re-scored.
    const after = await eventService.get(event.event.id);
    expect(after?.participations[0].member_id).toBe(member.id);
    expect(after?.participations[0].points).toBe(1);

    // The member's own meta was updated from the roster row.
    const fresh = await memberService.get(member.id);
    expect(fresh?.alliance_rank).toBe("R5");
    expect(fresh?.power).toBe(7777);
    expect(fresh?.power_position).toBe(3);
  });

  it("rejects the whole batch when a create governor shadows an existing alias — nothing is written", async () => {
    const { memberService } = createServices(DB);

    const owner = await memberService.create({ governor: "ImpShadowOwner" });
    await new AliasRepo(DB).insert({ alias: "ImpShadowAlias", member_id: owner.id, note: null });

    const memberCountBefore = await new MemberRepo(DB).count();
    const aliasCountBefore = await new AliasRepo(DB).count();

    await expect(
      memberService.importRoster({
        captured_on: "2026-07-20",
        updates: [],
        // Second create is valid on its own; it must NOT be written because the batch is all-or-nothing.
        creates: [{ governor: "ImpShadowAlias" }, { governor: "ImpShadowUnwritten" }],
        aliases: [],
        deactivate: [],
        reactivate: [],
      }),
    ).rejects.toThrow(/rejected/);

    expect(await new MemberRepo(DB).count()).toBe(memberCountBefore);
    expect(await new AliasRepo(DB).count()).toBe(aliasCountBefore);
    expect(await new MemberRepo(DB).getByGovernor("ImpShadowUnwritten")).toBeNull();
  });

  it("rejects a create duplicating an existing governor and an alias equal to an existing governor", async () => {
    const { memberService } = createServices(DB);

    const existing = await memberService.create({ governor: "ImpDupGovernor" });

    await expect(
      memberService.importRoster({
        captured_on: "2026-07-20",
        updates: [],
        creates: [{ governor: "ImpDupGovernor" }],
        aliases: [],
        deactivate: [],
        reactivate: [],
      }),
    ).rejects.toThrow(/rejected/);

    await expect(
      memberService.importRoster({
        captured_on: "2026-07-20",
        updates: [],
        creates: [],
        aliases: [{ alias: "ImpDupGovernor", member_id: existing.id }],
        deactivate: [],
        reactivate: [],
      }),
    ).rejects.toThrow(/rejected/);
  });

  it("rejects a reference to a member that does not exist", async () => {
    const { memberService } = createServices(DB);
    await expect(
      memberService.importRoster({
        captured_on: "2026-07-20",
        updates: [{ member_id: 999999, alliance_rank: "R1" }],
        creates: [],
        aliases: [],
        deactivate: [],
        reactivate: [],
      }),
    ).rejects.toThrow(/member 999999 not found/);
  });

  it("normalized guard: a create governor whose NFD form normalizes to an existing NFC alias is rejected", async () => {
    const { memberService } = createServices(DB);

    // Same name in two Unicode forms: the alias is stored NFC ("\u00f1"); the attempted governor uses
    // the NFD form ("n" + combining tilde U+0303). Not byte-identical, but normalize to the same key.
    const nfcAlias = "ImpN\u00f1oAlias"; // \u00f1 = composed (NFC)
    const nfdGovernor = "ImpNn\u0303oAlias"; // n + \u0303 combining tilde = decomposed (NFD)

    const owner = await memberService.create({ governor: "ImpNormOwner" });
    await new AliasRepo(DB).insert({ alias: nfcAlias, member_id: owner.id, note: null });

    await expect(
      memberService.importRoster({
        captured_on: "2026-07-20",
        updates: [],
        creates: [{ governor: nfdGovernor }],
        aliases: [],
        deactivate: [],
        reactivate: [],
      }),
    ).rejects.toThrow(/rejected/);
  });

  it("rejects batch-internal collisions (two creates, and a create equal to an alias in the same batch)", async () => {
    const { memberService } = createServices(DB);

    const memberCountBefore = await new MemberRepo(DB).count();

    // Two creates whose governors normalize to the same key (NFC vs NFD form of "ñ").
    await expect(
      memberService.importRoster({
        captured_on: "2026-07-20",
        updates: [],
        creates: [{ governor: "ImpDupN\u00f1o" }, { governor: "ImpDupNn\u0303o" }],
        aliases: [],
        deactivate: [],
        reactivate: [],
      }),
    ).rejects.toThrow(/rejected/);
    expect(await new MemberRepo(DB).count()).toBe(memberCountBefore);

    // A create governor equal (normalized) to an alias's alias in the SAME batch.
    const target = await memberService.create({ governor: "ImpBatchAliasTarget" });
    await expect(
      memberService.importRoster({
        captured_on: "2026-07-20",
        updates: [],
        creates: [{ governor: "ImpBatchClash" }],
        aliases: [{ alias: "ImpBatchClash", member_id: target.id }],
        deactivate: [],
        reactivate: [],
      }),
    ).rejects.toThrow(/rejected/);
    expect(await new MemberRepo(DB).getByGovernor("ImpBatchClash")).toBeNull();
  });

  it("rejects an alias that normalizes to an empty name (tag-only paste)", async () => {
    const { memberService } = createServices(DB);

    const target = await memberService.create({ governor: "ImpEmptyAliasTarget" });
    const aliasCountBefore = await new AliasRepo(DB).count();

    await expect(
      memberService.importRoster({
        captured_on: "2026-07-20",
        updates: [],
        creates: [],
        aliases: [{ alias: "[ABC]", member_id: target.id }],
        deactivate: [],
        reactivate: [],
      }),
    ).rejects.toThrow(/rejected/);
    expect(await new AliasRepo(DB).count()).toBe(aliasCountBefore);
  });

  it("metaFields: an omitted field is left untouched, an explicit null is applied", async () => {
    const { memberService } = createServices(DB);

    const member = await memberService.create({ governor: "ImpMeta", alliance_rank: "R4", power: 8000 });

    // Only `alliance_rank` is provided (as null) — `power` is omitted entirely and must survive unchanged.
    await memberService.importRoster({
      captured_on: "2026-07-20",
      updates: [{ member_id: member.id, alliance_rank: null }],
      creates: [],
      aliases: [],
      deactivate: [],
      reactivate: [],
    });

    const after = await memberService.get(member.id);
    expect(after?.alliance_rank).toBeNull();
    expect(after?.power).toBe(8000);
  });

  it("rejects an alias entry whose member_id does not exist", async () => {
    const { memberService } = createServices(DB);
    await expect(
      memberService.importRoster({
        captured_on: "2026-07-20",
        updates: [],
        creates: [],
        aliases: [{ alias: "ImpOrphanAlias", member_id: 999999 }],
        deactivate: [],
        reactivate: [],
      }),
    ).rejects.toThrow(/member 999999 not found/);
  });

  it("rejects a batch whose rows resolve two names to the same member", async () => {
    const { memberService, aliasService, resolveService } = createServices(DB);

    const m = await memberService.create({ governor: "DupTarget" });
    await aliasService.add({ alias: "DupTargetAlias", member_id: m.id });

    // Both pasted names really do land on one member, which is why name-level dedup in the client
    // cannot catch this: the two lines are different STRINGS.
    expect(await resolveService.resolve("DupTarget")).toBe(m.id);
    expect(await resolveService.resolve("DupTargetAlias")).toBe(m.id);

    // The classified batch: the governor line and the alias line, both resolved to `m` by the client and
    // therefore both sent as `updates` of the same member.
    await expect(
      memberService.importRoster({
        captured_on: "2026-07-20",
        updates: [{ member_id: m.id, power: 10 }, { member_id: m.id, power: 20 }],
        creates: [], aliases: [], deactivate: [], reactivate: [],
      }),
    ).rejects.toThrow(/twice/);

    // The shape the production comment actually describes: a governor row AND an alias row naming the
    // same member. Two rows, two lists, one member — one snapshot slot, so it must be rejected too.
    await expect(
      memberService.importRoster({
        captured_on: "2026-07-20",
        updates: [{ member_id: m.id, power: 10 }],
        creates: [],
        aliases: [{ alias: "DupTargetSecondName", member_id: m.id }],
        deactivate: [], reactivate: [],
      }),
    ).rejects.toThrow(/twice/);

    const fresh = await memberService.get(m.id);
    expect(fresh?.power).toBeNull(); // nothing written by either batch
    expect(await new AliasRepo(DB).getByAlias("DupTargetSecondName")).toBeNull();
  });

  it("rejects a malformed capture date", async () => {
    const { memberService } = createServices(DB);
    await expect(
      memberService.importRoster({
        captured_on: "20-07-2026",
        updates: [], creates: [], aliases: [], deactivate: [], reactivate: [],
      }),
    ).rejects.toThrow(/captured_on/);
  });

  it("rejects an alliance_rank outside R1-R5", async () => {
    const { memberService } = createServices(DB);
    const m = await memberService.create({ governor: "BadRank" });
    await expect(
      memberService.importRoster({
        captured_on: "2026-07-20",
        updates: [{ member_id: m.id, alliance_rank: "R6" }],
        creates: [], aliases: [], deactivate: [], reactivate: [],
      }),
    ).rejects.toThrow(/alliance_rank/);
  });

  it("rejects deactivating a member who is already inactive", async () => {
    const { memberService } = createServices(DB);
    const m = await memberService.create({ governor: "AlreadyGone", active: 0 });
    await expect(
      memberService.importRoster({
        captured_on: "2026-07-20",
        updates: [], creates: [], aliases: [], deactivate: [m.id], reactivate: [],
      }),
    ).rejects.toThrow(/not active/);
  });

  it("deactivates, reactivates, snapshots, and reports a delta", async () => {
    const { memberService } = createServices(DB);

    const stay = await memberService.create({ governor: "StayPut", alliance_rank: "R2", power: 100, power_position: 4 });
    const leaver = await memberService.create({ governor: "Leaver", alliance_rank: "R1", power: 50, power_position: 9 });
    const returner = await memberService.create({ governor: "Returner", alliance_rank: "R1", power: 60, power_position: 8, active: 0 });

    // First capture — baseline. Dated after the 2026-07-20 fixtures earlier in this file (not 2026-07-01/08
    // as the scenario would otherwise read) so this capture is not itself backdated against the newest
    // capture already on record by the time this test runs against the shared DB.
    await memberService.importRoster({
      captured_on: "2026-07-21",
      updates: [{ member_id: stay.id, alliance_rank: "R2", power: 100, power_position: 4 }],
      creates: [], aliases: [], deactivate: [], reactivate: [],
    });

    // Second capture — StayPut promoted to R3 and gained power; Leaver absent; Returner is back.
    const result = await memberService.importRoster({
      captured_on: "2026-07-22",
      updates: [
        { member_id: stay.id, alliance_rank: "R3", power: 105, power_position: 3 },
        { member_id: returner.id, alliance_rank: "R1", power: 60, power_position: 8 },
      ],
      creates: [], aliases: [],
      deactivate: [leaver.id],
      reactivate: [returner.id],
    });

    expect(result.deactivated).toBe(1);
    expect(result.reactivated).toBe(1);
    expect((await memberService.get(leaver.id))?.active).toBe(0);
    expect((await memberService.get(returner.id))?.active).toBe(1);

    expect(result.delta.previousCapture).toBe("2026-07-21");
    expect(result.delta.promotions).toEqual([
      { member_id: stay.id, governor: "StayPut", from: "R2", to: "R3", since: "2026-07-21" },
    ]);
    expect(result.delta.powerMoves[0]).toMatchObject({ member_id: stay.id, delta: 5, delta_position: -1 });
    expect(result.delta.departed).toEqual([{ member_id: leaver.id, governor: "Leaver" }]);
    expect(result.delta.returned).toEqual([{ member_id: returner.id, governor: "Returner" }]);
  });

  it("writes no snapshot row for a member absent from the capture", async () => {
    const { memberService } = createServices(DB);

    const present = await memberService.create({ governor: "GapPresent", power: 10 });
    const absent = await memberService.create({ governor: "GapAbsent", power: 20 });
    await memberService.importRoster({
      captured_on: "2026-08-01",
      updates: [{ member_id: present.id, power: 11 }],
      creates: [], aliases: [], deactivate: [], reactivate: [],
    });

    const row = await DB.prepare(
      "SELECT COUNT(*) AS c FROM member_snapshots WHERE member_id = ? AND captured_on = '2026-08-01'",
    ).bind(absent.id).first<{ c: number }>();
    expect(row?.c).toBe(0);
  });

  it("renames the governor when an alias row promotes it", async () => {
    const { memberService, aliasService } = createServices(DB);

    const m = await memberService.create({ governor: "OldName" });
    await memberService.importRoster({
      captured_on: "2026-08-02",
      updates: [],
      creates: [],
      aliases: [{ alias: "NewName", member_id: m.id, promote_to_governor: true, power: 1 }],
      deactivate: [], reactivate: [],
    });

    const fresh = await memberService.get(m.id);
    expect(fresh?.governor).toBe("NewName");
    const aliases = await aliasService.list();
    expect(aliases.some((a) => a.alias === "OldName" && a.member_id === m.id)).toBe(true);
  });

  // replaceForDate is delete-then-insert, so calling it with nothing observed would wipe the date. An
  // import that saw nobody (deactivations only) has no business rewriting snapshot history.
  it("an import that observes nobody leaves an existing capture intact", async () => {
    const { memberService } = createServices(DB);

    const seen = await memberService.create({ governor: "NoObsSeen", power: 5 });
    const goner = await memberService.create({ governor: "NoObsGoner", power: 6 });

    await memberService.importRoster({
      captured_on: "2026-10-01",
      updates: [{ member_id: seen.id, power: 7 }],
      creates: [], aliases: [], deactivate: [], reactivate: [],
    });

    await memberService.importRoster({
      captured_on: "2026-10-01",
      updates: [], creates: [], aliases: [], deactivate: [goner.id], reactivate: [],
    });

    const row = await DB.prepare(
      "SELECT COUNT(*) AS c, MAX(power) AS power FROM member_snapshots WHERE captured_on = '2026-10-01'",
    ).first<{ c: number; power: number }>();
    expect(row?.c).toBe(1);
    expect(row?.power).toBe(7);
    expect((await memberService.get(goner.id))?.active).toBe(0); // the deactivation still applied
  });

  // Fix 1a. `members.alliance_rank` has no CHECK (0004 could not add one without a table rebuild) but
  // `member_snapshots.alliance_rank` does, and the snapshot takes the member's EFFECTIVE rank — the batch
  // value when the row carries one, otherwise whatever is stored. Validating only the ranks PRESENT in the
  // batch let a stored out-of-set value blow up replaceForDate mid-apply, after the member updates and
  // deactivations had committed and before the snapshot, delta or recompute ran.
  it("rejects an update row that omits alliance_rank when the member's STORED rank is out of set", async () => {
    const { memberService } = createServices(DB);

    // Straight through the repo — the service's own guard is exactly what this member got in without.
    const bad = await new MemberRepo(DB).insert({
      governor: "StoredBadRank",
      alliance_rank: "Leader",
      power: 100,
      power_position: 1,
      active: 1,
    });
    const collateral = await memberService.create({ governor: "StoredBadRankBystander", power: 1 });

    await expect(
      memberService.importRoster({
        captured_on: "2026-11-01",
        // No alliance_rank: metaFields leaves the stored "Leader" alone, and the snapshot inherits it.
        updates: [{ member_id: bad.id, power: 200 }],
        creates: [],
        aliases: [],
        deactivate: [collateral.id],
        reactivate: [],
      }),
    ).rejects.toThrow(/stored alliance_rank "Leader"/);

    // Nothing applied: not the update, not the deactivation, and no snapshot for the date.
    expect((await memberService.get(bad.id))?.power).toBe(100);
    expect((await memberService.get(collateral.id))?.active).toBe(1);
    const row = await DB.prepare(
      "SELECT COUNT(*) AS c FROM member_snapshots WHERE captured_on = '2026-11-01'",
    ).first<{ c: number }>();
    expect(row?.c).toBe(0);
  });

  it("accepts an update row that REPLACES an out-of-set stored rank with a valid one", async () => {
    const { memberService } = createServices(DB);

    const bad = await new MemberRepo(DB).insert({
      governor: "StoredBadRankFixable",
      alliance_rank: "Leader",
      power: 100,
      power_position: 1,
      active: 1,
    });

    await memberService.importRoster({
      captured_on: "2026-11-02",
      updates: [{ member_id: bad.id, alliance_rank: "R4", power: 200 }],
      creates: [], aliases: [], deactivate: [], reactivate: [],
    });

    expect((await memberService.get(bad.id))?.alliance_rank).toBe("R4");
    const row = await DB.prepare(
      "SELECT alliance_rank FROM member_snapshots WHERE member_id = ? AND captured_on = '2026-11-02'",
    ).bind(bad.id).first<{ alliance_rank: string }>();
    expect(row?.alliance_rank).toBe("R4");
  });

  // Fix 1b. A promote row inserts the member's OLD governor as the alias — a name validation never looked
  // at. If another member already owns that alias key, aliases.alias UNIQUE fires mid-apply.
  it("rejects a promote whose OLD governor is already another member's alias", async () => {
    const { memberService } = createServices(DB);

    const renamer = await memberService.create({ governor: "PromoOldName", power: 1 });
    const other = await memberService.create({ governor: "PromoAliasOwner" });
    // Inserted straight through the repo: this is the shape a decoy rename leaves behind, and the alias
    // CRUD path would have refused it while "PromoOldName" is a live governor.
    await new AliasRepo(DB).insert({ alias: "PromoOldName", member_id: other.id, note: null });

    await expect(
      memberService.importRoster({
        captured_on: "2026-11-03",
        updates: [],
        creates: [],
        aliases: [{ alias: "PromoNewName", member_id: renamer.id, promote_to_governor: true, power: 2 }],
        deactivate: [], reactivate: [],
      }),
    ).rejects.toThrow(/alias "PromoOldName" duplicates an existing name/);

    // Nothing applied — the governor swap in particular did not happen.
    expect((await memberService.get(renamer.id))?.governor).toBe("PromoOldName");
    expect((await memberService.get(renamer.id))?.power).toBe(1);
    expect(await new AliasRepo(DB).getByAlias("PromoNewName")).toBeNull();
  });

  // Fix 2, import side. The alliance cycles names deliberately, so a promote back to a name this member
  // already owns is routine — and then the old governor is already one of their aliases too.
  it("allows a promote back to one of the member's own aliases", async () => {
    const { memberService, eventService, aliasService } = createServices(DB);

    const member = await memberService.create({ governor: "ImpCycleA", power: 1 });
    const event = await eventService.create({
      activity: "contribution",
      date: "2026-10-05",
      rows: [{ raw_name: "ImpCycleA", value: 25000 }],
    });
    expect(event.rows[0].member_id).toBe(member.id);

    // A -> B. "ImpCycleA" becomes an alias of this member.
    await memberService.importRoster({
      captured_on: "2026-11-04",
      updates: [], creates: [],
      aliases: [{ alias: "ImpCycleB", member_id: member.id, promote_to_governor: true, power: 2 }],
      deactivate: [], reactivate: [],
    });
    expect((await memberService.get(member.id))?.governor).toBe("ImpCycleB");

    // B -> A. The pasted name is this member's own alias and the old governor "ImpCycleB" is not yet one,
    // so the swap happens and "ImpCycleB" is added; "ImpCycleA" is NOT re-inserted.
    await memberService.importRoster({
      captured_on: "2026-11-05",
      updates: [], creates: [],
      aliases: [{ alias: "ImpCycleA", member_id: member.id, promote_to_governor: true, power: 3 }],
      deactivate: [], reactivate: [],
    });

    expect((await memberService.get(member.id))?.governor).toBe("ImpCycleA");
    const own = await aliasService.list({ member_id: member.id });
    expect(own.filter((a) => a.alias === "ImpCycleA")).toHaveLength(1);
    expect(own.some((a) => a.alias === "ImpCycleB")).toBe(true);

    // A -> B a second time: now BOTH the pasted name and the old governor are already this member's
    // aliases, so the redundant alias insert must be skipped rather than tripping UNIQUE.
    await memberService.importRoster({
      captured_on: "2026-11-06",
      updates: [], creates: [],
      aliases: [{ alias: "ImpCycleB", member_id: member.id, promote_to_governor: true, power: 4 }],
      deactivate: [], reactivate: [],
    });
    expect((await memberService.get(member.id))?.governor).toBe("ImpCycleB");

    // Through all of it the original participation stays attached, with unchanged points.
    const after = await eventService.get(event.event.id);
    expect(after?.participations[0].member_id).toBe(member.id);
    expect(after?.participations[0].points).toBe(1);
  });

  // Fix 6. The import runs ONE recompute after the writes; a rename applied through it must leave history
  // resolving exactly as a rename() through the service would.
  it("participation history survives an import-path rename", async () => {
    const { memberService, eventService } = createServices(DB);

    const member = await memberService.create({ governor: "ImpHistOld", power: 1 });
    const event = await eventService.create({
      activity: "contribution",
      date: "2026-10-12",
      rows: [{ raw_name: "ImpHistOld", value: 25000 }],
    });
    expect(event.rows[0].member_id).toBe(member.id);
    expect(event.rows[0].points).toBe(1);

    await memberService.importRoster({
      captured_on: "2026-11-07",
      updates: [], creates: [],
      aliases: [{ alias: "ImpHistNew", member_id: member.id, promote_to_governor: true, power: 2 }],
      deactivate: [], reactivate: [],
    });

    const after = await eventService.get(event.event.id);
    expect(after?.participations[0].raw_name).toBe("ImpHistOld");
    expect(after?.participations[0].member_id).toBe(member.id);
    expect(after?.participations[0].points).toBe(1);
  });

  // Fix 5.
  it("rejects a member who is both observed in the capture and marked for deactivation", async () => {
    const { memberService } = createServices(DB);

    const m = await memberService.create({ governor: "BothWays", power: 1 });
    await expect(
      memberService.importRoster({
        captured_on: "2026-11-08",
        updates: [{ member_id: m.id, power: 2 }],
        creates: [], aliases: [], deactivate: [m.id], reactivate: [],
      }),
    ).rejects.toThrow(/both observed in this capture and marked for deactivation/);

    expect((await memberService.get(m.id))?.active).toBe(1);
    expect((await memberService.get(m.id))?.power).toBe(1);
  });

  it("rejects a duplicate id in deactivate or in reactivate", async () => {
    const { memberService } = createServices(DB);

    const gone = await memberService.create({ governor: "DupDeactivate", power: 1 });
    await expect(
      memberService.importRoster({
        captured_on: "2026-11-09",
        updates: [], creates: [], aliases: [], deactivate: [gone.id, gone.id], reactivate: [],
      }),
    ).rejects.toThrow(/appears twice in deactivate/);
    expect((await memberService.get(gone.id))?.active).toBe(1);

    const back = await memberService.create({ governor: "DupReactivate", active: 0 });
    await expect(
      memberService.importRoster({
        captured_on: "2026-11-09",
        updates: [], creates: [], aliases: [], deactivate: [], reactivate: [back.id, back.id],
      }),
    ).rejects.toThrow(/appears twice in reactivate/);
    expect((await memberService.get(back.id))?.active).toBe(0);
  });

  it("rejects a well-shaped but impossible calendar date", async () => {
    const { memberService } = createServices(DB);
    const m = await memberService.create({ governor: "ImpossibleDate", power: 1 });

    for (const captured_on of ["2026-13-45", "2026-02-30", "2026-00-10", "2026-04-31"]) {
      await expect(
        memberService.importRoster({
          captured_on,
          updates: [{ member_id: m.id, power: 2 }],
          creates: [], aliases: [], deactivate: [], reactivate: [],
        }),
      ).rejects.toThrow(/captured_on/);
    }

    // A real leap day is still accepted — the check must not be a blunt month/day range.
    await memberService.importRoster({
      captured_on: "2028-02-29",
      updates: [{ member_id: m.id, power: 2 }],
      creates: [], aliases: [], deactivate: [], reactivate: [],
    });
    expect(await memberService.captureCount("2028-02-29")).toBe(1);
  });

  it("replaces a capture on re-import rather than appending to it", async () => {
    const { memberService } = createServices(DB);

    const m = await memberService.create({ governor: "Idem", power: 1 });
    const batch = {
      captured_on: "2026-09-01",
      updates: [{ member_id: m.id, power: 2 }],
      creates: [], aliases: [], deactivate: [], reactivate: [],
    };
    await memberService.importRoster(batch);
    await memberService.importRoster(batch);

    const row = await DB.prepare(
      "SELECT COUNT(*) AS c FROM member_snapshots WHERE member_id = ? AND captured_on = '2026-09-01'",
    ).bind(m.id).first<{ c: number }>();
    expect(row?.c).toBe(1);
  });
});

describe("members HTTP routes", () => {
  it("POST creates (201) and round-trips, then GET / lists it", async () => {
    const res = await SELF.fetch("https://example.com/api/members", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ governor: "HttpMember", alliance_rank: "R4" }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: number; governor: string };
    expect(created.id).toBeGreaterThan(0);
    expect(created.governor).toBe("HttpMember");

    const listRes = await SELF.fetch("https://example.com/api/members", { headers: VIEWER });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { governor: string }[];
    expect(list.map((m) => m.governor)).toContain("HttpMember");
  });

  it("POST with a duplicate governor returns 409", async () => {
    const first = await SELF.fetch("https://example.com/api/members", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ governor: "HttpDup" }),
    });
    expect(first.status).toBe(201);

    const dup = await SELF.fetch("https://example.com/api/members", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ governor: "HttpDup" }),
    });
    expect(dup.status).toBe(409);
  });

  it("POST /:id/rename renames and adds the old name as an alias by default", async () => {
    const create = await SELF.fetch("https://example.com/api/members", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ governor: "HttpRenameOld" }),
    });
    const member = (await create.json()) as { id: number };

    const rename = await SELF.fetch(`https://example.com/api/members/${member.id}/rename`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ governor: "HttpRenameNew" }),
    });
    expect(rename.status).toBe(200);
    const result = (await rename.json()) as {
      member: { governor: string };
      addedAlias: boolean;
    };
    expect(result.member.governor).toBe("HttpRenameNew");
    expect(result.addedAlias).toBe(true);
    expect(await new AliasRepo(DB).getByAlias("HttpRenameOld")).not.toBeNull();
  });

  it("PATCH governor returns 400 and leaves the member untouched", async () => {
    const create = await SELF.fetch("https://example.com/api/members", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ governor: "HttpNoPatchGovernor" }),
    });
    const member = (await create.json()) as { id: number };

    const res = await SELF.fetch(`https://example.com/api/members/${member.id}`, {
      method: "PATCH",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ governor: "HttpPatchedGovernor", alliance_rank: "R5" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/rename/);

    // Neither the governor nor the alliance_rank in the same rejected body was written.
    const after = await new MemberRepo(DB).getByGovernor("HttpNoPatchGovernor");
    expect(after).not.toBeNull();
    expect(after?.alliance_rank).toBeNull();
    expect(await new MemberRepo(DB).getByGovernor("HttpPatchedGovernor")).toBeNull();
  });

  it("PATCH with an alliance_rank outside R1-R5 returns 400", async () => {
    const create = await SELF.fetch("https://example.com/api/members", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ governor: "HttpBadRank", alliance_rank: "R3" }),
    });
    const member = (await create.json()) as { id: number };

    const res = await SELF.fetch(`https://example.com/api/members/${member.id}`, {
      method: "PATCH",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ alliance_rank: "R6" }),
    });
    expect(res.status).toBe(400);
    expect((await new MemberRepo(DB).getByGovernor("HttpBadRank"))?.alliance_rank).toBe("R3");
  });

  it("PATCH unknown id returns 404, GET /:id with a non-numeric id returns 400", async () => {
    const missing = await SELF.fetch("https://example.com/api/members/999999", {
      method: "PATCH",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ alliance_rank: "R1" }),
    });
    expect(missing.status).toBe(404);

    const bad = await SELF.fetch("https://example.com/api/members/not-a-number", { headers: VIEWER });
    expect(bad.status).toBe(400);
  });

  it("POST /import applies a batch (200 + counts) with the admin key, 403 with the manager key, and 401 without one", async () => {
    const body = JSON.stringify({
      captured_on: "2026-07-20",
      updates: [],
      creates: [{ governor: "HttpImport", alliance_rank: "R4", power: 3000, power_position: 7 }],
      aliases: [],
      deactivate: [],
      reactivate: [],
    });

    const noKey = await SELF.fetch("https://example.com/api/members/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(noKey.status).toBe(401);

    const managerKey = await SELF.fetch("https://example.com/api/members/import", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body,
    });
    expect(managerKey.status).toBe(403);

    const ok = await SELF.fetch("https://example.com/api/members/import", {
      method: "POST",
      headers: { ...ADMIN_AUTH, "Content-Type": "application/json" },
      body,
    });
    expect(ok.status).toBe(200);
    const result = (await ok.json()) as {
      updated: number;
      created: number;
      aliased: number;
      recomputed: number;
    };
    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.aliased).toBe(0);
    expect(await new MemberRepo(DB).getByGovernor("HttpImport")).not.toBeNull();
  });

  it("reports how many snapshots a capture date already holds", async () => {
    const { memberService } = createServices(DB);
    const m = await memberService.create({ governor: "CaptureCount", power: 5 });
    await memberService.importRoster({
      captured_on: "2026-10-01",
      updates: [{ member_id: m.id, power: 6 }],
      creates: [], aliases: [], deactivate: [], reactivate: [],
    });

    const res = await SELF.fetch("https://example.com/api/members/captures/2026-10-01", {
      headers: ADMIN_AUTH,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ captured_on: "2026-10-01", count: 1 });
  });

  it("returns zero for a capture date with no snapshots", async () => {
    const res = await SELF.fetch("https://example.com/api/members/captures/2026-12-25", {
      headers: ADMIN_AUTH,
    });
    expect(await res.json()).toMatchObject({ captured_on: "2026-12-25", count: 0 });
  });

  it("rejects a malformed capture date", async () => {
    const res = await SELF.fetch("https://example.com/api/members/captures/25-12-2026", {
      headers: ADMIN_AUTH,
    });
    expect(res.status).toBe(400);
  });

  it("allows a viewer key to read the capture count — it's a GET, like the other routes on this router", async () => {
    const res = await SELF.fetch("https://example.com/api/members/captures/2026-12-25", {
      headers: VIEWER,
    });
    expect(res.status).toBe(200);
  });

  it("reports the newest capture on record alongside the count", async () => {
    // 2028-03-01, not the plan's 2027-02-07: an earlier test in this file ("rejects a well-shaped
    // but impossible calendar date") already writes a 2028-02-29 capture into the shared DB, so a
    // 2027 date would no longer be the newest on record by the time this test runs.
    const { memberService } = createServices(DB);
    const m = await memberService.create({ governor: "CaptureInfo_Ann" });
    await memberService.importRoster({
      captured_on: "2028-03-01",
      updates: [{ member_id: m.id, power: 10, power_position: 1 }],
      creates: [], aliases: [], deactivate: [], reactivate: [],
    });

    const res = await SELF.fetch("https://example.com/api/members/captures/2028-02-23", { headers: AUTH });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ captured_on: "2028-02-23", count: 0, latest: "2028-03-01" });
  });
});

describe("GET /api/members/deltas", () => {
  it("returns each member's move since their own previous capture", async () => {
    const { memberService } = createServices(DB);
    const a = await memberService.create({ governor: "Delta_Mover" });
    const b = await memberService.create({ governor: "Delta_Fresh" });

    // Two captures for a, one for b.
    await memberService.importRoster({
      captured_on: "2026-05-04",
      updates: [{ member_id: a.id, power: 1000, power_position: 6 }],
      creates: [],
      aliases: [],
      deactivate: [],
      reactivate: [],
    });
    await memberService.importRoster({
      captured_on: "2026-05-11",
      updates: [
        { member_id: a.id, power: 1200, power_position: 4 },
        { member_id: b.id, power: 900, power_position: 9 },
      ],
      creates: [],
      aliases: [],
      deactivate: [],
      reactivate: [],
    });

    const res = await SELF.fetch("https://example.com/api/members/deltas", { headers: AUTH });
    expect(res.status).toBe(200);
    const deltas = (await res.json()) as MemberDelta[];

    const mover = deltas.find((d) => d.member_id === a.id);
    expect(mover).toEqual({
      member_id: a.id,
      delta_power: 200,
      delta_position: -2,
      since: "2026-05-04",
      rank_from: null,
      rank_to: null,
    });

    const fresh = deltas.find((d) => d.member_id === b.id);
    expect(fresh).toEqual({
      member_id: b.id,
      delta_power: null,
      delta_position: null,
      since: null,
      rank_from: null,
      rank_to: null,
    });
  });
});

describe("GET /api/members/:id/snapshots", () => {
  it("returns the member's observations plus every capture date, so gaps are visible", async () => {
    const { memberService } = createServices(DB);
    const present = await memberService.create({ governor: "Snap_Present" });
    const absent = await memberService.create({ governor: "Snap_Absent" });

    await memberService.importRoster({
      captured_on: "2026-06-01",
      updates: [
        { member_id: present.id, power: 1000, power_position: 3 },
        { member_id: absent.id, power: 500, power_position: 9 },
      ],
      creates: [],
      aliases: [],
      deactivate: [],
      reactivate: [],
    });
    // Second capture observes only `present` — `absent` gets NO row for this date.
    await memberService.importRoster({
      captured_on: "2026-06-08",
      updates: [{ member_id: present.id, power: 1100, power_position: 2 }],
      creates: [],
      aliases: [],
      deactivate: [],
      reactivate: [],
    });

    const res = await SELF.fetch(`https://example.com/api/members/${absent.id}/snapshots`, { headers: AUTH });
    expect(res.status).toBe(200);
    const series = (await res.json()) as MemberSnapshotSeries;

    // Both capture dates are on the axis...
    expect(series.captures).toEqual(expect.arrayContaining(["2026-06-01", "2026-06-08"]));
    // ...but this member only has a row for the first.
    expect(series.rows.map((r) => r.captured_on)).toEqual(["2026-06-01"]);
    expect(series.rows[0].power).toBe(500);
  });

  it("404s for a member that does not exist", async () => {
    const res = await SELF.fetch("https://example.com/api/members/999999/snapshots", { headers: AUTH });
    expect(res.status).toBe(404);
  });
});

describe("MemberService.importRoster — backdated captures", () => {
  it("writes the old capture without moving the member's current standing backwards", async () => {
    const { memberService } = createServices(DB);
    const m = await memberService.create({ governor: "Backdate_Ann" });

    // Newest capture first, then an older one — the order an operator backfilling history uses.
    await memberService.importRoster({
      captured_on: "2026-09-20",
      updates: [{ member_id: m.id, alliance_rank: "R4", power: 2000, power_position: 2 }],
      creates: [], aliases: [], deactivate: [], reactivate: [],
    });
    await memberService.importRoster({
      captured_on: "2026-09-06",
      updates: [{ member_id: m.id, alliance_rank: "R2", power: 1000, power_position: 9 }],
      creates: [], aliases: [], deactivate: [], reactivate: [],
    });

    // Current standing still the NEWEST capture's.
    const current = await memberService.get(m.id);
    expect(current?.power).toBe(2000);
    expect(current?.power_position).toBe(2);
    expect(current?.alliance_rank).toBe("R4");

    // The old capture still recorded what the old paste actually said.
    const series = await memberService.snapshots(m.id);
    const old = series?.rows.find((r) => r.captured_on === "2026-09-06");
    expect(old?.power).toBe(1000);
    expect(old?.power_position).toBe(9);
    expect(old?.alliance_rank).toBe("R2");
  });

  it("still updates a member the newer captures never observed", async () => {
    const { memberService } = createServices(DB);
    const seen = await memberService.create({ governor: "Backdate_Seen" });
    const gap = await memberService.create({ governor: "Backdate_Gap" });

    await memberService.importRoster({
      captured_on: "2026-10-18",
      updates: [{ member_id: seen.id, power: 5000, power_position: 1 }],
      creates: [], aliases: [], deactivate: [], reactivate: [],
    });
    // `gap` was absent from the newer capture, so nothing has been observed about them since.
    await memberService.importRoster({
      captured_on: "2026-10-04",
      updates: [{ member_id: gap.id, power: 700, power_position: 40 }],
      creates: [], aliases: [], deactivate: [], reactivate: [],
    });

    const filled = await memberService.get(gap.id);
    expect(filled?.power).toBe(700);
    expect(filled?.power_position).toBe(40);
  });

  it("rejects membership changes on a backdated capture", async () => {
    const { memberService } = createServices(DB);
    const m = await memberService.create({ governor: "Backdate_Member" });

    await memberService.importRoster({
      captured_on: "2026-11-15",
      updates: [{ member_id: m.id, power: 100, power_position: 5 }],
      creates: [], aliases: [], deactivate: [], reactivate: [],
    });

    await expect(
      memberService.importRoster({
        captured_on: "2026-11-10",
        updates: [], creates: [], aliases: [],
        deactivate: [m.id], reactivate: [],
      }),
    ).rejects.toThrow(/backdated/i);

    // Rejected before any write: still active.
    expect((await memberService.get(m.id))?.active).toBe(1);
  });

  it("leaves the newest import writing meta as before", async () => {
    const { memberService } = createServices(DB);
    const m = await memberService.create({ governor: "Backdate_Forward" });

    await memberService.importRoster({
      captured_on: "2026-12-06",
      updates: [{ member_id: m.id, power: 100, power_position: 50 }],
      creates: [], aliases: [], deactivate: [], reactivate: [],
    });
    await memberService.importRoster({
      captured_on: "2026-12-13",
      updates: [{ member_id: m.id, power: 900, power_position: 3 }],
      creates: [], aliases: [], deactivate: [], reactivate: [],
    });

    const current = await memberService.get(m.id);
    expect(current?.power).toBe(900);
    expect(current?.power_position).toBe(3);
  });
});

describe("MemberService time-travel", () => {
  it("rosterForDate returns as-of rows with per-member deltas; listCaptures lists the dates", async () => {
    const { memberService } = createServices(DB);
    const snapshots = new SnapshotRepo(DB);

    const a = await memberService.create({ governor: "TtAlpha" });
    const b = await memberService.create({ governor: "TtBravo" });
    const c = await memberService.create({ governor: "TtCharlie" });

    // Capture 1: a + b. Capture 2: a (changed) + c (first observation). b absent from 2.
    await snapshots.replaceForDate("2031-01-01", [
      { member_id: a.id, captured_on: "2031-01-01", alliance_rank: "R2", power: 100, power_position: 2 },
      { member_id: b.id, captured_on: "2031-01-01", alliance_rank: "R3", power: 200, power_position: 1 },
    ]);
    await snapshots.replaceForDate("2031-01-08", [
      { member_id: a.id, captured_on: "2031-01-08", alliance_rank: "R3", power: 150, power_position: 1 },
      { member_id: c.id, captured_on: "2031-01-08", alliance_rank: null, power: null, power_position: null },
    ]);

    const view = await memberService.rosterForDate("2031-01-08");
    expect(view).not.toBeNull();
    const rows = new Map(view!.rows.map((r) => [r.member_id, r]));

    // a: observed with deltas vs 01-01.
    expect(rows.get(a.id)).toEqual({
      member_id: a.id,
      governor: "TtAlpha",
      alliance_rank: "R3",
      power: 150,
      power_position: 1,
      delta_power: 50,
      delta_position: -1,
      since: "2031-01-01",
    });
    // b: absent — a gap, not a zero.
    expect(rows.has(b.id)).toBe(false);
    // c: first observation — null deltas, null since.
    expect(rows.get(c.id)).toMatchObject({ delta_power: null, delta_position: null, since: null });

    // Earliest capture: rows exist, no baselines.
    const first = await memberService.rosterForDate("2031-01-01");
    expect(first!.rows.every((r) => r.since === null)).toBe(true);

    // Capture list includes both dates, newest first, with counts.
    const captures: CaptureSummary[] = await memberService.listCaptures();
    const mine = captures.filter((s) => s.captured_on.startsWith("2031-01-"));
    expect(mine).toEqual([
      { captured_on: "2031-01-08", members: 2 },
      { captured_on: "2031-01-01", members: 2 },
    ]);
  });

  it("rosterForDate: null for an unknown date, throws on a malformed one", async () => {
    const { memberService } = createServices(DB);
    expect(await memberService.rosterForDate("1899-01-01")).toBeNull();
    await expect(memberService.rosterForDate("not-a-date")).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("serves capture list and as-of roster over HTTP", async () => {
    const { memberService } = createServices(DB);
    const snapshots = new SnapshotRepo(DB);

    const m = await memberService.create({ governor: "TtHttp" });
    const n = await memberService.create({ governor: "TtHttpNullBase" });
    await snapshots.replaceForDate("2031-02-01", [
      { member_id: m.id, captured_on: "2031-02-01", alliance_rank: "R2", power: 100, power_position: 5 },
      { member_id: n.id, captured_on: "2031-02-01", alliance_rank: "R2", power: null, power_position: null },
    ]);
    await snapshots.replaceForDate("2031-02-08", [
      { member_id: m.id, captured_on: "2031-02-08", alliance_rank: "R2", power: 130, power_position: 4 },
      { member_id: n.id, captured_on: "2031-02-08", alliance_rank: "R2", power: 500, power_position: 9 },
    ]);

    const listRes = await SELF.fetch("https://x/api/members/captures", { headers: AUTH });
    expect(listRes.status).toBe(200);
    const { captures } = (await listRes.json()) as { captures: CaptureSummary[] };
    const mine = captures.filter((s) => s.captured_on.startsWith("2031-02-"));
    expect(mine).toEqual([
      { captured_on: "2031-02-08", members: 2 },
      { captured_on: "2031-02-01", members: 2 },
    ]);

    const rosterRes = await SELF.fetch("https://x/api/members/captures/2031-02-08/roster", {
      headers: AUTH,
    });
    expect(rosterRes.status).toBe(200);
    const { rows } = (await rosterRes.json()) as { rows: CaptureRosterRow[] };
    const byId = new Map(rows.map((r) => [r.member_id, r]));
    expect(byId.get(m.id)).toEqual({
      member_id: m.id,
      governor: "TtHttp",
      alliance_rank: "R2",
      power: 130,
      power_position: 4,
      delta_power: 30,
      delta_position: -1,
      since: "2031-02-01",
    });
    // Null on the BASELINE side: baseline exists (since set) but deltas stay null — unknown, not zero.
    expect(byId.get(n.id)).toMatchObject({
      power: 500,
      delta_power: null,
      delta_position: null,
      since: "2031-02-01",
    });

    // The pre-existing capture-count endpoint still answers beside the two new routes.
    const countRes = await SELF.fetch("https://x/api/members/captures/2031-02-08", { headers: AUTH });
    expect(countRes.status).toBe(200);
    expect(((await countRes.json()) as { count: number }).count).toBe(2);
  });

  it("as-of roster: 404 unknown date, 400 malformed date", async () => {
    const missing = await SELF.fetch("https://x/api/members/captures/1899-01-01/roster", {
      headers: AUTH,
    });
    expect(missing.status).toBe(404);

    const malformed = await SELF.fetch("https://x/api/members/captures/not-a-date/roster", {
      headers: AUTH,
    });
    expect(malformed.status).toBe(400);
  });
});
