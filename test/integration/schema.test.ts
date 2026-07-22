import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const { DB } = env;

const EXPECTED_TABLES = [
  "activity_types",
  "scoring_tiers",
  "members",
  "aliases",
  "events",
  "participations",
  "member_snapshots",
];

const EXPECTED_INDEXES = [
  "idx_part_member",
  "idx_event_week",
  "idx_alias_member",
  "idx_snapshot_date",
];

// Dropped in 0003: each duplicated the leftmost prefix of a UNIQUE constraint's implicit index, so it
// added a write per row without adding any seek capability.
const DROPPED_INDEXES = ["idx_part_event", "idx_event_type"];

describe("migrated schema", () => {
  it("creates all 7 tables", async () => {
    const { results } = await DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();

    const tableNames = results.map((row) => row.name);
    for (const table of EXPECTED_TABLES) {
      expect(tableNames).toContain(table);
    }
  });

  it("creates all 4 indexes", async () => {
    const { results } = await DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name",
    ).all<{ name: string }>();

    const indexNames = results.map((row) => row.name);
    for (const index of EXPECTED_INDEXES) {
      expect(indexNames).toContain(index);
    }
  });

  it("leaves no index that merely duplicates a UNIQUE constraint's prefix", async () => {
    const { results } = await DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name",
    ).all<{ name: string }>();

    const indexNames = results.map((row) => row.name);
    for (const index of DROPPED_INDEXES) {
      expect(indexNames).not.toContain(index);
    }
  });

  it("rejects a participation referencing a nonexistent event_id", async () => {
    await expect(
      DB.prepare(
        "INSERT INTO participations (event_id, raw_name, value) VALUES (?, ?, ?)",
      )
        .bind(999999, "Nonexistent", 1)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint/i);
  });

  it("renames the overloaded rank columns", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(members)").all<{ name: string }>();
    const names = results.map((r) => r.name);
    expect(names).toContain("alliance_rank");
    expect(names).toContain("power_position");
    expect(names).not.toContain("role");
    expect(names).not.toContain("rank_snapshot");
  });

  it("normalizes free-text rank values to the closed set, using the real migration 0004 UPDATEs", async () => {
    const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith("0004"));
    if (!migration) throw new Error("migration 0004 not found in TEST_MIGRATIONS");
    const normalizeQueries = migration.queries.filter((q) => q.trim().startsWith("UPDATE members"));
    expect(normalizeQueries).toHaveLength(2);

    await env.DB.prepare(
      "INSERT INTO members (governor, alliance_rank, active) VALUES (?, ?, 1), (?, ?, 1), (?, ?, 1), (?, ?, 1), (?, ?, 1), (?, ?, 1)",
    )
      .bind(
        "LegacyLower",
        "r4",
        "LegacyWord",
        "Leader",
        "LegacyClean",
        "R2",
        "LegacyCRLF",
        "R3\r",
        "LegacyTab",
        "\tR1",
        "LegacyNbsp",
        "R5\u00a0", // U+00A0 non-breaking space: SQLite TRIM strips only the characters it is GIVEN
      )
      .run();

    try {
      for (const query of normalizeQueries) {
        await env.DB.prepare(query).run();
      }

      const { results } = await env.DB.prepare(
        "SELECT governor, alliance_rank FROM members WHERE governor LIKE 'Legacy%'",
      ).all<{ governor: string; alliance_rank: string | null }>();

      const byGovernor = Object.fromEntries(results.map((r) => [r.governor, r.alliance_rank]));
      expect(byGovernor).toEqual({
        LegacyLower: "R4",
        LegacyWord: null,
        LegacyClean: "R2",
        LegacyCRLF: "R3", // trailing \r (CRLF paste) must survive, not fall through to NULL
        LegacyTab: "R1", // leading tab must survive, not fall through to NULL
        // PINNED LOSS, not an endorsement. `TRIM(x, chars)` strips only the characters listed, and 0004
        // lists space/tab/LF/CR — so a non-breaking space (U+00A0), a zero-width space, or any other
        // invisible a hand-entered value picked up survives TRIM, fails the closed-set IN, and is
        // overwritten with NULL. Same for "Leader"/"4"/"Rank 4"/"". The migration is already applied and
        // is not being changed; this case exists so the loss is documented rather than discovered.
        // The spec's "Before migrating remote" note is the operator-side mitigation.
        LegacyNbsp: null,
      });
    } finally {
      await env.DB.prepare("DELETE FROM members WHERE governor LIKE 'Legacy%'").run();
    }
  });

  it("rejects a member_snapshots row with an out-of-set alliance_rank", async () => {
    const { results } = await env.DB.prepare(
      "INSERT INTO members (governor, active) VALUES ('SnapshotCheckMember', 1) RETURNING id",
    ).all<{ id: number }>();
    const memberId = results[0].id;

    try {
      await expect(
        env.DB.prepare(
          "INSERT INTO member_snapshots (member_id, captured_on, alliance_rank) VALUES (?, ?, ?)",
        )
          .bind(memberId, "2026-07-27", "Leader")
          .run(),
      ).rejects.toThrow(/CHECK constraint/i);
    } finally {
      await env.DB.prepare("DELETE FROM members WHERE id = ?").bind(memberId).run();
    }
  });

  it("rejects a second snapshot for the same member on the same date", async () => {
    const { results } = await env.DB.prepare(
      "INSERT INTO members (governor, active) VALUES ('SnapshotUniqueMember', 1) RETURNING id",
    ).all<{ id: number }>();
    const memberId = results[0].id;

    try {
      await env.DB.prepare(
        "INSERT INTO member_snapshots (member_id, captured_on, alliance_rank) VALUES (?, ?, ?)",
      )
        .bind(memberId, "2026-07-27", "R1")
        .run();

      await expect(
        env.DB.prepare(
          "INSERT INTO member_snapshots (member_id, captured_on, alliance_rank) VALUES (?, ?, ?)",
        )
          .bind(memberId, "2026-07-27", "R2")
          .run(),
      ).rejects.toThrow(/UNIQUE constraint/i);
    } finally {
      await env.DB.prepare("DELETE FROM members WHERE id = ?").bind(memberId).run();
    }
  });

  it("cascades snapshot deletion when the member is deleted", async () => {
    const { results } = await env.DB.prepare(
      "INSERT INTO members (governor, active) VALUES ('SnapshotCascadeMember', 1) RETURNING id",
    ).all<{ id: number }>();
    const memberId = results[0].id;

    await env.DB.prepare(
      "INSERT INTO member_snapshots (member_id, captured_on, alliance_rank) VALUES (?, ?, ?)",
    )
      .bind(memberId, "2026-07-27", "R1")
      .run();

    await env.DB.prepare("DELETE FROM members WHERE id = ?").bind(memberId).run();

    const { results: remaining } = await env.DB.prepare(
      "SELECT id FROM member_snapshots WHERE member_id = ?",
    )
      .bind(memberId)
      .all<{ id: number }>();
    expect(remaining).toEqual([]);
  });
});
