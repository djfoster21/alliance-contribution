-- (D1 enforces foreign keys by default; no PRAGMA needed.)

-- Activity types are DATA. Add a row to add an activity type.
CREATE TABLE activity_types (
  id            INTEGER PRIMARY KEY,
  key           TEXT    NOT NULL UNIQUE,      -- machine key, e.g. 'bear_trap'
  name          TEXT    NOT NULL,             -- display, e.g. 'Bear Trap'
  unit_label    TEXT,                         -- 'Damage' | 'Contribution' | 'Personal Points'
  weight        REAL    NOT NULL DEFAULT 1,   -- multiplier applied to tier points
  max_instance  INTEGER NOT NULL DEFAULT 1,   -- Bear Trap = 2 (trap 1 & 2); others = 1
  min_value     REAL    NOT NULL DEFAULT 0,   -- participation threshold: log only value > this
  active        INTEGER NOT NULL DEFAULT 1,
  sort          INTEGER NOT NULL DEFAULT 0
);

-- Scoring bands per activity. Largest min_value <= value wins.
CREATE TABLE scoring_tiers (
  id                INTEGER PRIMARY KEY,
  activity_type_id  INTEGER NOT NULL REFERENCES activity_types(id) ON DELETE CASCADE,
  min_value         REAL    NOT NULL,
  points            INTEGER NOT NULL,
  UNIQUE (activity_type_id, min_value)
);

-- Canonical roster. governor = identity used everywhere.
CREATE TABLE members (
  id             INTEGER PRIMARY KEY,
  governor       TEXT    NOT NULL UNIQUE,
  role           TEXT,
  power          INTEGER,
  rank_snapshot  INTEGER,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- alias -> member. One row per alias. HUMAN-VERIFIED ONLY.
CREATE TABLE aliases (
  id          INTEGER PRIMARY KEY,
  alias       TEXT    NOT NULL UNIQUE,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  note        TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One occurrence of an activity. Stable identity = (activity_type_id, date, instance).
CREATE TABLE events (
  id                INTEGER PRIMARY KEY,
  activity_type_id  INTEGER NOT NULL REFERENCES activity_types(id),
  date              TEXT    NOT NULL,          -- 'YYYY-MM-DD'
  week              TEXT    NOT NULL,          -- ISO week 'YYYY-Www' (derived from date)
  instance          INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (activity_type_id, date, instance)
);

-- One appearance in an event.
CREATE TABLE participations (
  id          INTEGER PRIMARY KEY,
  event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  raw_name    TEXT    NOT NULL,                -- as logged (alliance tag stripped)
  member_id   INTEGER REFERENCES members(id),  -- resolved; NULL = unmapped
  value       REAL    NOT NULL,                -- raw metric
  points      REAL    NOT NULL DEFAULT 0,      -- derived (ScoringService); REAL: weight is REAL, so
                                               -- tier.points × weight can be fractional
  notes       TEXT,
  UNIQUE (event_id, raw_name)
);

CREATE INDEX idx_part_member ON participations(member_id);
CREATE INDEX idx_part_event  ON participations(event_id);
CREATE INDEX idx_event_week  ON events(week);
CREATE INDEX idx_event_type  ON events(activity_type_id);
CREATE INDEX idx_alias_member ON aliases(member_id);
