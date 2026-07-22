-- Cosmetic colour tag per activity type (named token from a fixed 8-value palette; see shared/colors.ts).
-- Never triggers recompute.
ALTER TABLE activity_types ADD COLUMN color TEXT NOT NULL DEFAULT 'slate';
UPDATE activity_types SET color = 'blue'   WHERE key = 'bear_trap';
UPDATE activity_types SET color = 'green'  WHERE key = 'contribution';
UPDATE activity_types SET color = 'violet' WHERE key = 'mobilization';
