import { describe, expect, it } from "vitest";
import {
  BackupValidationError,
  buildBackup,
  INSERT_ORDER,
  SCHEMA_VERSION,
  validateBackup,
  type BackupFile,
} from "../../src/domain/backup";

function validFile(): BackupFile {
  return {
    format: "alliance-backup",
    version: 1,
    schema: SCHEMA_VERSION,
    exported_at: "2026-07-24T00:00:00.000Z",
    tables: {
      activity_types: [
        { id: 1, key: "bear_trap", name: "Bear Trap", unit_label: "Damage", weight: 1, max_instance: 2, min_value: 0, active: 1, sort: 0, color: "slate" },
      ],
      scoring_tiers: [{ id: 1, activity_type_id: 1, min_value: 0, points: 1 }],
      members: [
        { id: 1, governor: "Alice;Bob", alliance_rank: null, power: null, power_position: null, active: 1, created_at: "2026-01-01 00:00:00", updated_at: "2026-01-01 00:00:00" },
      ],
      aliases: [{ id: 1, alias: "Ali--as", member_id: 1, note: "x'y", created_at: "2026-01-01 00:00:00" }],
      member_snapshots: [{ id: 1, member_id: 1, captured_on: "2026-01-05", alliance_rank: null, power: null, power_position: null }],
      events: [{ id: 1, activity_type_id: 1, date: "2026-01-05", week: "2026-W01", instance: 1, created_at: "2026-01-01 00:00:00", updated_at: "2026-01-01 00:00:00" }],
      participations: [{ id: 1, event_id: 1, raw_name: "Alice\n[ABC]", member_id: 1, value: 5, points: 1, notes: null }],
      allocations: [
        { id: 1, title: "KvK chests", quantity: 2, metric: "points", weeks: '["2026-W01"]', strategy: "top_n", tiers: null, top_count: null, created_at: "2026-01-06 00:00:00" },
      ],
      allocation_lines: [{ id: 1, allocation_id: 1, member_id: 1, amount: 1, rank: 1, metric_value: 3 }],
    },
  };
}

describe("buildBackup", () => {
  it("wraps tables in the envelope with format/version/schema/exported_at", () => {
    const tables = validFile().tables;
    const file = buildBackup(tables, "2026-07-24T00:00:00.000Z");
    expect(file.format).toBe("alliance-backup");
    expect(file.version).toBe(1);
    expect(file.schema).toBe(SCHEMA_VERSION);
    expect(file.exported_at).toBe("2026-07-24T00:00:00.000Z");
    expect(file.tables).toBe(tables);
  });
});

describe("INSERT_ORDER", () => {
  it("is the 9 tables in FK dependency order", () => {
    expect(INSERT_ORDER).toEqual([
      "activity_types", "scoring_tiers", "members", "aliases", "member_snapshots", "events", "participations",
      "allocations", "allocation_lines",
    ]);
  });
});

describe("validateBackup", () => {
  it("accepts a clean payload and returns the typed file", () => {
    const result = validateBackup(validFile());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.tables.members).toHaveLength(1);
  });

  it("rejects a wrong format", () => {
    const f = validFile();
    f.format = "nope";
    const r = validateBackup(f);
    expect(r.ok).toBe(false);
  });

  it("rejects a schema-version mismatch (drift guard)", () => {
    const f = validFile();
    f.schema = "9999";
    const r = validateBackup(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/schema/i);
  });

  it("rejects a missing table", () => {
    const f = validFile() as unknown as { tables: Record<string, unknown> };
    delete f.tables.aliases;
    expect(validateBackup(f).ok).toBe(false);
  });

  it("rejects a row with an unknown column", () => {
    const f = validFile();
    (f.tables.members[0] as Record<string, unknown>).evil = 1;
    expect(validateBackup(f).ok).toBe(false);
  });

  it("rejects a row with a missing column", () => {
    const f = validFile();
    delete (f.tables.members[0] as Record<string, unknown>).governor;
    expect(validateBackup(f).ok).toBe(false);
  });

  it("rejects a duplicate unique key within a table", () => {
    const f = validFile();
    f.tables.members.push({ ...f.tables.members[0], id: 2, governor: "Alice;Bob" });
    const r = validateBackup(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/governor|unique|duplicate/i);
  });

  it("rejects a duplicate composite unique key in scoring_tiers (activity_type_id, min_value)", () => {
    const f = validFile();
    f.tables.scoring_tiers.push({ ...f.tables.scoring_tiers[0], id: 2 });
    const r = validateBackup(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unique|duplicate/i);
  });

  it("rejects a duplicate composite unique key in events (activity_type_id, date, instance)", () => {
    const f = validFile();
    f.tables.events.push({ ...f.tables.events[0], id: 2 });
    const r = validateBackup(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unique|duplicate/i);
  });

  it("rejects a dangling foreign key", () => {
    const f = validFile();
    f.tables.aliases[0].member_id = 999;
    const r = validateBackup(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/references missing/i);
  });

  it("rejects an allocations row whose weeks or tiers column is not parseable JSON", () => {
    for (const patch of [{ weeks: "2026-W30" }, { weeks: 42 }, { tiers: "{broken" }, { tiers: "1" }]) {
      const f = validFile();
      Object.assign(f.tables.allocations[0], patch);
      const r = validateBackup(f);
      expect(r.ok, JSON.stringify(patch)).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/weeks|tiers/);
    }
    // null tiers stays valid (non-tiered allocations store NULL).
    const f = validFile();
    f.tables.allocations[0].tiers = null;
    expect(validateBackup(f).ok).toBe(true);
  });

  it("rejects an allocation line pointing at a missing allocation or member", () => {
    for (const column of ["allocation_id", "member_id"]) {
      const f = validFile();
      f.tables.allocation_lines[0][column] = 999;
      const r = validateBackup(f);
      expect(r.ok, column).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/references missing/i);
    }
  });

  it("allows a null nullable FK (participation with unmapped member)", () => {
    const f = validFile();
    f.tables.participations[0].member_id = null;
    expect(validateBackup(f).ok).toBe(true);
  });

  it("rejects null input", () => {
    expect(validateBackup(null).ok).toBe(false);
  });

  it("rejects a string input", () => {
    expect(validateBackup("string").ok).toBe(false);
  });

  it("rejects a null tables field", () => {
    const f = validFile() as unknown as Record<string, unknown>;
    f.tables = null;
    expect(validateBackup(f).ok).toBe(false);
  });

  it("rejects an unknown extra top-level table key", () => {
    const f = validFile() as unknown as { tables: Record<string, unknown> };
    f.tables.evil_table = [];
    expect(validateBackup(f).ok).toBe(false);
  });
});

describe("BackupValidationError", () => {
  it("has name BackupValidationError", () => {
    expect(new BackupValidationError("x").name).toBe("BackupValidationError");
  });
});

describe("backup back-compat", () => {
  const legacyMember = {
    id: 1, governor: "Alpha", role: "r4", power: 100, rank_snapshot: 3,
    active: 1, created_at: "2026-07-01 00:00:00", updated_at: "2026-07-01 00:00:00",
  };
  const legacyFile = (schema: string) => ({
    format: "alliance-backup",
    version: 1,
    schema,
    exported_at: "2026-07-01T00:00:00.000Z",
    tables: {
      activity_types: [], scoring_tiers: [], members: [{ ...legacyMember }],
      aliases: [], events: [], participations: [],
    },
  });

  it("upgrades a 0002 file's member columns and adds the empty post-0002 tables", () => {
    const result = validateBackup(legacyFile("0002"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.tables.members[0]).toMatchObject({
      governor: "Alpha", alliance_rank: "R4", power: 100, power_position: 3,
    });
    expect(result.file.tables.members[0]).not.toHaveProperty("role");
    expect(result.file.tables.member_snapshots).toEqual([]);
    expect(result.file.tables.allocations).toEqual([]);
    expect(result.file.tables.allocation_lines).toEqual([]);
  });

  it("upgrades a 0004 file by adding empty allocation tables, members untouched", () => {
    const file = legacyFile("0004") as unknown as { tables: Record<string, unknown> };
    file.tables.members = [{
      id: 1, governor: "Alpha", alliance_rank: "R4", power: 100, power_position: 3,
      active: 1, created_at: "2026-07-01 00:00:00", updated_at: "2026-07-01 00:00:00",
    }];
    file.tables.member_snapshots = [];
    const result = validateBackup(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.tables.members[0]).toMatchObject({ governor: "Alpha", alliance_rank: "R4" });
    expect(result.file.tables.allocations).toEqual([]);
    expect(result.file.tables.allocation_lines).toEqual([]);
  });

  it("rejects a 0004 file that already carries an allocations key", () => {
    const file = legacyFile("0004") as unknown as { tables: Record<string, unknown> };
    file.tables.member_snapshots = [];
    file.tables.allocations = [];
    const result = validateBackup(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/allocations/);
  });

  it("upgrades a 0003 file the same way", () => {
    const result = validateBackup(legacyFile("0003"));
    expect(result.ok).toBe(true);
  });

  it("normalizes out-of-set legacy rank values to null on upgrade", () => {
    const file = legacyFile("0002");
    file.tables.members[0].role = "Leader";
    const result = validateBackup(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.tables.members[0].alliance_rank).toBeNull();
  });

  it("still rejects a 0001 file", () => {
    const result = validateBackup(legacyFile("0001"));
    expect(result.ok).toBe(false);
  });

  it("rejects a 0002 file whose members table is not an array, instead of coercing it to an empty roster", () => {
    const file = legacyFile("0002") as unknown as { tables: Record<string, unknown> };
    file.tables.members = "nope";
    const result = validateBackup(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('table "members" missing or not an array');
  });

  it("rejects a 0002 file with no members key at all, instead of coercing it to an empty roster", () => {
    const file = legacyFile("0002") as unknown as { tables: Record<string, unknown> };
    delete file.tables.members;
    const result = validateBackup(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('table "members" missing or not an array');
  });

  it("rejects a 0002 file whose member row already carries a post-0004 column instead of silently nulling it", () => {
    const file = legacyFile("0002");
    (file.tables.members[0] as Record<string, unknown>).alliance_rank = "R4";
    const result = validateBackup(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/alliance_rank/);
    expect(result.error).toMatch(/0002/);
  });

  it("rejects a 0002 file whose member row already carries power_position instead of silently nulling it", () => {
    const file = legacyFile("0002");
    (file.tables.members[0] as Record<string, unknown>).power_position = 3;
    const result = validateBackup(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/power_position/);
    expect(result.error).toMatch(/0002/);
  });

  it("rejects a 0002 file that already carries a member_snapshots key instead of silently discarding it", () => {
    const file = legacyFile("0002") as unknown as { tables: Record<string, unknown> };
    file.tables.member_snapshots = [{ id: 1, member_id: 1, captured_on: "2026-07-01", alliance_rank: "R4", power: 100, power_position: 3 }];
    const result = validateBackup(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('schema "0002" file must not contain member_snapshots');
  });
});
