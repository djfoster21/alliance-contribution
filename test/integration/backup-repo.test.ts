import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { BackupRepo } from "../../src/repositories/backup-repo";
import { buildBackup, type BackupFile } from "../../src/domain/backup";
import { createServices } from "../../src/services";

const { DB, SEED_STATEMENTS } = env;

// A stand-in D1 that records the SQL of each db.batch() call and executes nothing, so batching/ordering
// can be asserted (and a later-chunk failure simulated) without touching the real database.
function recordingDb(failOnCall?: number): { db: D1Database; calls: string[][] } {
  const calls: string[][] = [];
  const stmt = (sql: string): { sql: string; bind: () => unknown } => ({ sql, bind: () => stmt(sql) });
  const db = {
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: { sql: string }[]) => {
      calls.push(stmts.map((s) => s.sql));
      if (calls.length === failOnCall) throw new Error("D1_ERROR: connection lost");
      return [];
    },
  };
  return { db: db as unknown as D1Database, calls };
}

// participations has 7 columns -> 12 rows per multi-row INSERT, so 700 rows is ~59 insert statements:
// more than one 50-statement batchChunked chunk.
function multiChunkFile(participationCount: number): BackupFile {
  const participations = Array.from({ length: participationCount }, (_, i) => ({
    id: i + 1,
    event_id: 1,
    raw_name: `Chunky${i}`,
    member_id: null,
    value: 1,
    points: 0,
    notes: null,
  }));
  return buildBackup(
    {
      activity_types: [], scoring_tiers: [], members: [], aliases: [], member_snapshots: [],
      events: [], participations, allocations: [], allocation_lines: [],
    },
    "2026-11-16T00:00:00.000Z",
  );
}

beforeAll(async () => {
  for (const stmt of SEED_STATEMENTS) await DB.prepare(stmt).run();
  const { memberService, eventService } = createServices(DB);
  const m = await memberService.create({ governor: "RepoDumpMember" });
  await eventService.create({
    activity: "contribution",
    date: "2026-11-02",
    rows: [{ raw_name: "RepoDumpMember", value: 25000 }],
  });
  expect(m.id).toBeGreaterThan(0);
});

describe("BackupRepo", () => {
  it("dumpAll returns every table keyed by name, ordered by id", async () => {
    const repo = new BackupRepo(DB);
    const tables = await repo.dumpAll();
    expect(Object.keys(tables).sort()).toEqual(
      ["activity_types", "aliases", "allocation_lines", "allocations", "events", "member_snapshots", "members", "participations", "scoring_tiers"],
    );
    expect(tables.members.some((r) => r.governor === "RepoDumpMember")).toBe(true);
    expect(tables.participations.length).toBeGreaterThan(0);
  });

  it("replaceAll wipes then reloads the exact rows from a file", async () => {
    const repo = new BackupRepo(DB);
    const before = await repo.dumpAll();
    const file = buildBackup(before, "2026-11-02T00:00:00.000Z");

    const counts = await repo.replaceAll(file);
    expect(counts.members).toBe(before.members.length);

    const after = await repo.dumpAll();
    for (const table of ["activity_types", "scoring_tiers", "members", "aliases", "events", "participations"] as const) {
      expect(after[table]).toEqual(before[table]);
    }
  });

  it("replaceAll round-trips an explicit falsy value (member_id NULL, points 0)", async () => {
    const { memberService, eventService } = createServices(DB);

    const member = await memberService.create({ governor: "FalsyRoundTripMember" });
    expect(member.id).toBeGreaterThan(0);
    const event = await eventService.create({
      activity: "contribution",
      date: "2026-11-09",
      rows: [{ raw_name: "FalsyRoundTripMember", value: 25000 }],
    });
    const participationId = event.rows[0].id;

    // Force the row into an unmapped, zero-point state directly, bypassing scoring.
    await DB.prepare("UPDATE participations SET member_id = NULL, points = 0 WHERE id = ?")
      .bind(participationId)
      .run();

    const repo = new BackupRepo(DB);
    const dump = await repo.dumpAll();
    const row = dump.participations.find((r) => r.id === participationId);
    expect(row?.member_id).toBeNull();
    expect(row?.points).toBe(0);

    await repo.replaceAll(buildBackup(dump, "2026-11-09T00:00:00.000Z"));

    const after = await repo.dumpAll();
    const afterRow = after.participations.find((r) => r.id === participationId);
    expect(afterRow?.member_id).toBeNull();
    expect(afterRow?.points).toBe(0);
  });

  it("replaceAll wipes in its own batch, never sharing a chunk with inserts", async () => {
    const { db, calls } = recordingDb();

    const counts = await new BackupRepo(db).replaceAll(multiChunkFile(700));

    expect(counts.participations).toBe(700);
    expect(calls.length).toBeGreaterThan(2); // the wipe, then more than one insert chunk
    expect(calls[0]).toEqual([
      "DELETE FROM allocation_lines",
      "DELETE FROM allocations",
      "DELETE FROM participations",
      "DELETE FROM events",
      "DELETE FROM member_snapshots",
      "DELETE FROM aliases",
      "DELETE FROM members",
      "DELETE FROM scoring_tiers",
      "DELETE FROM activity_types",
    ]);
    expect(calls.slice(1).flat().every((sql) => sql.startsWith("INSERT INTO"))).toBe(true);
  });

  it("replaceAll reports the partially-restored state when a later insert chunk fails", async () => {
    // Call 1 is the wipe, call 2 the first insert chunk, call 3 the remainder — fail the remainder.
    const { db, calls } = recordingDb(3);

    await expect(new BackupRepo(db).replaceAll(multiChunkFile(700))).rejects.toThrow(
      /PARTIALLY RESTORED[\s\S]*SAME file/,
    );
    expect(calls).toHaveLength(3);
  });

  // Wipes every table to empty — must stay last in this file.
  it("replaceAll on an empty-table file leaves all tables empty", async () => {
    const repo = new BackupRepo(DB);
    const empty = buildBackup(
      {
        activity_types: [], scoring_tiers: [], members: [], aliases: [], member_snapshots: [],
        events: [], participations: [], allocations: [], allocation_lines: [],
      },
      "2026-11-02T00:00:00.000Z",
    );
    const counts = await repo.replaceAll(empty);
    expect(counts.participations).toBe(0);
    const after = await repo.dumpAll();
    expect(after.members).toEqual([]);
    expect(after.activity_types).toEqual([]);
  });

  // Real-D1 counterpart of the recordingDb failure test: also destructive, so it stays after the wipe.
  it("replaceAll surfaces a real insert failure as a partially-restored error", async () => {
    const repo = new BackupRepo(DB);
    const bad = buildBackup(
      {
        activity_types: [],
        scoring_tiers: [],
        // governor is NOT NULL — this INSERT fails after the wipe has already committed.
        members: [
          {
            id: 1, governor: null, alliance_rank: null, power: null, power_position: null, active: 1,
            created_at: "2026-01-01 00:00:00", updated_at: "2026-01-01 00:00:00",
          },
        ],
        aliases: [],
        member_snapshots: [],
        events: [],
        participations: [],
        allocations: [],
        allocation_lines: [],
      },
      "2026-11-16T00:00:00.000Z",
    );

    await expect(repo.replaceAll(bad)).rejects.toThrow(/PARTIALLY RESTORED[\s\S]*SAME file/);
    expect((await repo.dumpAll()).members).toEqual([]);
  });
});
