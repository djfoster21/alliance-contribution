-- Reward allocations (2026-08-07 spec): one hand-out event plus its per-member lines.
-- Lines are a snapshot taken at save time: amount/rank/metric_value never change afterwards;
-- only member merge repoints member_id at the surviving identity.
CREATE TABLE allocations (
  id          INTEGER PRIMARY KEY,
  title       TEXT    NOT NULL,
  quantity    INTEGER NOT NULL,
  metric      TEXT    NOT NULL,            -- 'points' | 'attendance'
  weeks       TEXT    NOT NULL,            -- JSON array of the selected event weeks (auditable)
  strategy    TEXT    NOT NULL,            -- 'top_n' | 'proportional' | 'proportional_top' | 'tiered'
  tiers       TEXT,                        -- JSON TierBand[], NULL unless tiered
  top_count   INTEGER,                     -- NULL unless proportional_top
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Deliberately no UNIQUE (allocation_id, member_id): a member merge can leave two lines for one
-- member inside an old allocation — that records what actually happened.
CREATE TABLE allocation_lines (
  id             INTEGER PRIMARY KEY,
  allocation_id  INTEGER NOT NULL REFERENCES allocations(id) ON DELETE CASCADE,
  member_id      INTEGER NOT NULL REFERENCES members(id),
  amount         INTEGER NOT NULL,
  rank           INTEGER NOT NULL,
  metric_value   REAL    NOT NULL
);

CREATE INDEX idx_alloc_line_alloc  ON allocation_lines(allocation_id);
CREATE INDEX idx_alloc_line_member ON allocation_lines(member_id);
