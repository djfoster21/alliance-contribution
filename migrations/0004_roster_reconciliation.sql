-- Roster reconciliation: disambiguate the two "rank" columns and add dated snapshot history.
-- `role` was overloaded (it also names the auth tier in the SPA) and `rank_snapshot` is a power
-- leaderboard position, not the R1-R5 alliance rank.
ALTER TABLE members RENAME COLUMN role TO alliance_rank;
ALTER TABLE members RENAME COLUMN rank_snapshot TO power_position;

-- The column was free text and the add/edit dialogs accepted anything. This is a point-in-time
-- cleanup of what is already there, not durable enforcement: `members` cannot gain a CHECK without
-- a table rebuild, so the closed-set contract still needs service-level validation (later task) to
-- hold for rows written after this migration.
UPDATE members SET alliance_rank = UPPER(TRIM(alliance_rank, ' ' || char(9) || char(10) || char(13)))
  WHERE alliance_rank IS NOT NULL;
UPDATE members SET alliance_rank = NULL
  WHERE alliance_rank IS NOT NULL AND alliance_rank NOT IN ('R1','R2','R3','R4','R5');

-- One row per member per capture. A member absent from a capture gets NO row: a gap, not a zero.
-- Brand-new table, so the closed set is a CHECK, not just a convention.
CREATE TABLE member_snapshots (
  id             INTEGER PRIMARY KEY,
  member_id      INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  captured_on    TEXT    NOT NULL,          -- YYYY-MM-DD
  alliance_rank  TEXT CHECK (alliance_rank IS NULL OR alliance_rank IN ('R1','R2','R3','R4','R5')),
  power          INTEGER,
  power_position INTEGER,
  UNIQUE (member_id, captured_on)
);

-- Whole-capture reads. Per-member lookups ride the UNIQUE (member_id, captured_on) index.
CREATE INDEX idx_snapshot_date ON member_snapshots(captured_on);
