// Pure backup domain: table metadata + envelope builder + validator. No DB access.
// SCHEMA_VERSION is the latest migration that shapes the BACKED-UP tables; bump it when such a
// migration lands so a dump taken under a different schema is rejected before any destructive
// import step. Migrations that only touch BACKUP_EXCLUDED_TABLES do not move it.
export const SCHEMA_VERSION = "0004";
export const BACKUP_FORMAT = "alliance-backup";
export const BACKUP_VERSION = 1;

export type TableName =
  | "activity_types"
  | "scoring_tiers"
  | "members"
  | "aliases"
  | "member_snapshots"
  | "events"
  | "participations";

/** Tables deliberately NOT in the backup format. `settings` (migration 0005) holds cosmetic
 *  presentation config with code defaults — nothing here needs to survive a restore. Adding a
 *  table to the schema means adding it either to INSERT_ORDER or, deliberately, to this set. */
export const BACKUP_EXCLUDED_TABLES = new Set<string>(["settings"]);

// FK dependency order for inserts; reverse for deletes. NEVER trust row order from the file.
export const INSERT_ORDER: TableName[] = [
  "activity_types",
  "scoring_tiers",
  "members",
  "aliases",
  "member_snapshots",
  "events",
  "participations",
];

// Exact column set per table (from migrations 0001-0004). Import rejects any row whose keys differ.
export const TABLE_COLUMNS: Record<TableName, string[]> = {
  activity_types: ["id", "key", "name", "unit_label", "weight", "max_instance", "min_value", "active", "sort", "color"],
  scoring_tiers: ["id", "activity_type_id", "min_value", "points"],
  members: ["id", "governor", "alliance_rank", "power", "power_position", "active", "created_at", "updated_at"],
  aliases: ["id", "alias", "member_id", "note", "created_at"],
  member_snapshots: ["id", "member_id", "captured_on", "alliance_rank", "power", "power_position"],
  events: ["id", "activity_type_id", "date", "week", "instance", "created_at", "updated_at"],
  participations: ["id", "event_id", "raw_name", "member_id", "value", "points", "notes"],
};

// Unique constraints to enforce within the payload (mirrors the schema's UNIQUE/PK declarations).
const UNIQUE_KEYS: Record<TableName, string[][]> = {
  activity_types: [["id"], ["key"]],
  scoring_tiers: [["id"], ["activity_type_id", "min_value"]],
  members: [["id"], ["governor"]],
  aliases: [["id"], ["alias"]],
  member_snapshots: [["id"], ["member_id", "captured_on"]],
  events: [["id"], ["activity_type_id", "date", "instance"]],
  participations: [["id"], ["event_id", "raw_name"]],
};

// Foreign keys to check within the payload. nullable columns skip the check when the value is null.
const FOREIGN_KEYS: { table: TableName; column: string; ref: TableName; nullable: boolean }[] = [
  { table: "scoring_tiers", column: "activity_type_id", ref: "activity_types", nullable: false },
  { table: "aliases", column: "member_id", ref: "members", nullable: false },
  { table: "member_snapshots", column: "member_id", ref: "members", nullable: false },
  { table: "events", column: "activity_type_id", ref: "activity_types", nullable: false },
  { table: "participations", column: "event_id", ref: "events", nullable: false },
  { table: "participations", column: "member_id", ref: "members", nullable: true },
];

export type Row = Record<string, unknown>;

export type BackupFile = {
  format: string;
  version: number;
  schema: string;
  exported_at: string;
  tables: Record<TableName, Row[]>;
};

// Thrown by callers when validateBackup fails; routes map this name to HTTP 400.
export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupValidationError";
  }
}

export function buildBackup(tables: Record<TableName, Row[]>, exportedAt: string): BackupFile {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, schema: SCHEMA_VERSION, exported_at: exportedAt, tables };
}

export type ValidationResult =
  | { ok: true; file: BackupFile }
  | { ok: false; error: string };

// Schema versions this app can still read. Older exports are upgraded in memory before validation, so
// a backup taken before migration 0004 stays usable for disaster recovery — the only reason it exists.
const UPGRADABLE_SCHEMAS = new Set(["0002", "0003"]);
const ALLIANCE_RANKS = new Set(["R1", "R2", "R3", "R4", "R5"]);

type UpgradeResult = { ok: true; tables: Record<string, unknown> } | { ok: false; error: string };

// Mirrors migration 0004: rename the two member columns, normalize the free-text rank to the closed
// set, and introduce member_snapshots as empty (pre-0004 files cannot have had any). Never manufactures
// a valid-looking table out of missing/malformed/contradictory input — it transforms, it doesn't forgive.
function upgradeToCurrent(tables: Record<string, unknown>, schema: string): UpgradeResult {
  // A legacy-labelled file cannot legitimately carry this table (it didn't exist before 0004). Reject
  // rather than silently discard — discarding buys no protection an admin-only endpoint didn't already
  // have, and silent data loss is worse than a loud refusal.
  if ("member_snapshots" in tables) {
    return { ok: false, error: `schema "${schema}" file must not contain member_snapshots` };
  }

  if (!Array.isArray(tables.members)) {
    // Leave members exactly as-is (missing key, wrong type, whatever it is) — do not coerce it into an
    // empty array. The `members` key is re-asserted (even if undefined) so the table-count check below
    // still lets this through to the per-table loop, which reports the specific defect.
    return { ok: true, tables: { ...tables, members: tables.members, member_snapshots: [] } };
  }

  for (const row of tables.members as Row[]) {
    if (row && typeof row === "object") {
      if ("alliance_rank" in row) {
        return {
          ok: false,
          error: `schema "${schema}" member row already has "alliance_rank" — a ${schema} export cannot contain post-0004 columns`,
        };
      }
      if ("power_position" in row) {
        return {
          ok: false,
          error: `schema "${schema}" member row already has "power_position" — a ${schema} export cannot contain post-0004 columns`,
        };
      }
    }
  }

  const upgraded = (tables.members as Row[]).map((row) => {
    const { role, rank_snapshot, ...rest } = row as Row & { role?: unknown; rank_snapshot?: unknown };
    const normalized = typeof role === "string" ? role.trim().toUpperCase() : null;
    return {
      ...rest,
      alliance_rank: normalized !== null && ALLIANCE_RANKS.has(normalized) ? normalized : null,
      power_position: rank_snapshot ?? null,
    };
  });
  return { ok: true, tables: { ...tables, members: upgraded, member_snapshots: [] } };
}

export function validateBackup(parsed: unknown): ValidationResult {
  if (typeof parsed !== "object" || parsed === null) return { ok: false, error: "backup must be an object" };
  const f = parsed as Record<string, unknown>;

  if (f.format !== BACKUP_FORMAT) return { ok: false, error: `unrecognized backup format` };
  if (f.version !== BACKUP_VERSION) return { ok: false, error: `unsupported backup version` };
  const isUpgradable = typeof f.schema === "string" && UPGRADABLE_SCHEMAS.has(f.schema);
  if (f.schema !== SCHEMA_VERSION && !isUpgradable) {
    return { ok: false, error: `schema mismatch: file is "${String(f.schema)}", app is "${SCHEMA_VERSION}"` };
  }

  const rawTables = f.tables;
  if (typeof rawTables !== "object" || rawTables === null) return { ok: false, error: "tables missing" };
  let t: Record<string, unknown>;
  if (isUpgradable) {
    const upgrade = upgradeToCurrent(rawTables as Record<string, unknown>, f.schema as string);
    if (!upgrade.ok) return { ok: false, error: upgrade.error };
    t = upgrade.tables;
  } else {
    t = rawTables as Record<string, unknown>;
  }

  // Only the known tables may be present (the per-table loop below covers the required side).
  if (Object.keys(t).length !== INSERT_ORDER.length) return { ok: false, error: "unexpected tables in backup" };

  // Every table present, an array, with rows whose keys exactly match the column set.
  for (const table of INSERT_ORDER) {
    const rows = t[table];
    if (!Array.isArray(rows)) return { ok: false, error: `table "${table}" missing or not an array` };
    const columns = TABLE_COLUMNS[table];
    for (const row of rows as Row[]) {
      if (typeof row !== "object" || row === null) return { ok: false, error: `table "${table}" has a non-object row` };
      const keys = Object.keys(row);
      if (keys.length !== columns.length || !columns.every((col) => col in row)) {
        return { ok: false, error: `table "${table}" row has unexpected columns` };
      }
    }
  }

  const file = t as unknown as Record<TableName, Row[]>;

  // Unique constraints within each table.
  for (const table of INSERT_ORDER) {
    for (const key of UNIQUE_KEYS[table]) {
      const seen = new Set<string>();
      for (const row of file[table]) {
        const composite = JSON.stringify(key.map((col) => row[col]));
        if (seen.has(composite)) {
          return { ok: false, error: `duplicate ${key.join("+")} in "${table}"` };
        }
        seen.add(composite);
      }
    }
  }

  // Foreign keys resolve within the payload.
  const idSets: Partial<Record<TableName, Set<unknown>>> = {};
  const idSetFor = (table: TableName): Set<unknown> => {
    if (!idSets[table]) idSets[table] = new Set(file[table].map((row) => row.id));
    return idSets[table]!;
  };
  for (const fk of FOREIGN_KEYS) {
    const refIds = idSetFor(fk.ref);
    for (const row of file[fk.table]) {
      const value = row[fk.column];
      if (fk.nullable && value === null) continue;
      if (!refIds.has(value)) {
        return { ok: false, error: `${fk.table}.${fk.column} references missing ${fk.ref} id ${String(value)}` };
      }
    }
  }

  return { ok: true, file: buildBackup(file, String(f.exported_at ?? "")) };
}
