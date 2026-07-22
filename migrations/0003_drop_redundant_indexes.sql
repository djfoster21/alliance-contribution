-- Both indexes duplicated the leftmost prefix of a UNIQUE constraint's implicit index, so each cost one
-- extra index-row write per insert/delete without providing any seek the constraint's index did not
-- already provide. See docs/plans/2026-07-25_d1-write-budget.md.

-- Redundant with UNIQUE (event_id, raw_name) (0001_init.sql:68), which already serves every
-- `WHERE event_id = ?` seek and the events -> participations ON DELETE CASCADE lookup.
DROP INDEX idx_part_event;

-- Redundant with UNIQUE (activity_type_id, date, instance) (0001_init.sql:55), which already serves
-- every `WHERE activity_type_id = ?` seek.
DROP INDEX idx_event_type;
