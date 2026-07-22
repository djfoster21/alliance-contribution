// Pure SQL builder for the config-only seed: default activity_types + scoring_tiers for a FRESH D1
// database. No I/O here. Roster, aliases, events, and participations are entered in-app, not seeded.
//
// activity_types ids (referenced by scoring_tiers' foreign key) are assigned explicitly in insertion
// order rather than relying on SQLite's implicit rowid behavior — this keeps the statement text fully
// self-contained and the id scheme obvious from reading this file.

type ActivityTypeSeed = {
  key: string;
  name: string;
  unitLabel: string;
  weight: number;
  maxInstance: number;
  minValue: number;
  sort: number;
  color: string;
  tiers: { minValue: number; points: number }[];
};

// Default config (docs/specs/02_scoring.md). Seeded once; editable in-app from here on.
const ACTIVITY_TYPES: ActivityTypeSeed[] = [
  {
    key: "bear_trap",
    name: "Bear Trap",
    unitLabel: "Damage",
    weight: 1,
    maxInstance: 2,
    minValue: 0,
    sort: 1,
    color: "blue",
    tiers: [{ minValue: 0, points: 1 }],
  },
  {
    key: "contribution",
    name: "Contribution",
    unitLabel: "Contribution",
    weight: 1,
    maxInstance: 1,
    minValue: 0,
    sort: 2,
    color: "green",
    tiers: [
      { minValue: 0, points: 0 },
      { minValue: 20000, points: 1 },
      { minValue: 60000, points: 2 },
      { minValue: 120000, points: 3 },
    ],
  },
  {
    key: "mobilization",
    name: "Alliance Mobilization",
    unitLabel: "Personal Points",
    weight: 2,
    maxInstance: 1,
    minValue: 0,
    sort: 3,
    color: "violet",
    tiers: [
      { minValue: 0, points: 0 },
      { minValue: 2000, points: 1 },
      { minValue: 5000, points: 2 },
      { minValue: 10000, points: 3 },
    ],
  },
];

function sqlStr(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNum(value: number): string {
  return String(value);
}

function buildInsert(table: string, columns: string[], rows: string[][]): string[] {
  if (rows.length === 0) return [];

  const values = rows.map((row) => `(${row.join(", ")})`).join(",\n  ");
  return [`INSERT INTO ${table} (${columns.join(", ")}) VALUES\n  ${values};`];
}

export function buildSeedSql(): string[] {
  const stmts: string[] = [];

  // --- activity_types ---------------------------------------------------
  stmts.push(
    ...buildInsert(
      "activity_types",
      ["id", "key", "name", "unit_label", "weight", "max_instance", "min_value", "active", "sort", "color"],
      ACTIVITY_TYPES.map((a, i) => [
        sqlNum(i + 1),
        sqlStr(a.key),
        sqlStr(a.name),
        sqlStr(a.unitLabel),
        sqlNum(a.weight),
        sqlNum(a.maxInstance),
        sqlNum(a.minValue),
        sqlNum(1),
        sqlNum(a.sort),
        sqlStr(a.color),
      ]),
    ),
  );

  // --- scoring_tiers -------------------------------------------------------
  const tierRows: string[][] = [];
  ACTIVITY_TYPES.forEach((a, i) => {
    for (const tier of a.tiers) {
      tierRows.push([sqlNum(i + 1), sqlNum(tier.minValue), sqlNum(tier.points)]);
    }
  });
  stmts.push(...buildInsert("scoring_tiers", ["activity_type_id", "min_value", "points"], tierRows));

  return stmts;
}
