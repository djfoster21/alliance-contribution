// Config-only seed: inserts the default activity_types + scoring_tiers config into D1. Roster,
// aliases, events, and participations are entered in-app, not seeded.
//
// This assumes it runs once against a FRESH, migrated D1; it is NOT idempotent against an
// already-seeded database (start from a clean DB in dev if re-seeding).
//
// Usage: npm run seed:local  (or seed:remote, which passes --remote through to wrangler)

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildSeedSql } from "./sql";

const ROOT = path.join(import.meta.dirname, "..");
const OUT_DIR = path.join(import.meta.dirname, "out");
const OUT_FILE = path.join(OUT_DIR, "seed.sql");
const WRANGLER_BIN = path.join(ROOT, "node_modules", ".bin", "wrangler");

function main(): void {
  const remote = process.argv.includes("--remote");

  const stmts = buildSeedSql();
  if (stmts.length === 0) throw new Error("seed/run.ts: no SQL statements were built — refusing to run");

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, stmts.join("\n\n"), "utf8");

  const flag = remote ? "--remote" : "--local";
  console.log(`seed/run.ts: wrote ${stmts.length} statements to ${OUT_FILE}; executing wrangler d1 execute (${flag})...`);

  // Addressed by the "DB" binding from wrangler.toml, not by database name — that name is
  // per-deployment config and must not be hardcoded here.
  execFileSync(WRANGLER_BIN, ["d1", "execute", "DB", flag, "--file", OUT_FILE], {
    stdio: "inherit",
    cwd: ROOT,
  });
}

main();
