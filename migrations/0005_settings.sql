-- Generic app-settings KV (first use: rank-band sizes, 2026-08-03 spec). No seeded rows:
-- readers fall back to code defaults so existing deployments need only the migration.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
