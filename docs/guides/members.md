# Members

Browse the roster's Participation Scores and open any member's full activity, attendance, and power history.

## What you see

**Members list** (`/members`)

- Three headline tiles above the list:
  - **Roster** — count of active members currently scored.
  - **Avg Attendance** — the average attendance percentage across everyone shown.
  - **At Risk** — how many members are below 50% attendance.
- A search box that filters by governor name or any known alias as you type, plus a "X of Y shown" counter.
- One card per member, showing:
  - **Score rank** badge (top-left, gold/silver/bronze for #1–#3) — all-time Participation Score rank.
  - **Alliance rank** badge (R1–R5) when recorded, in the top-right.
  - A red dot next to the alliance-rank badge when the member's attendance is below 50%.
  - Avatar, governor name, and how many known aliases the member has.
  - **Score** — the all-time Participation Score.
  - An attendance percentage pill, colored green (≥80%), amber (≥50%), or red (<50%).
- Clicking a card opens that member's profile.

**Member profile** (`/members/:id`)

- A header card with the member's name, alliance rank badge, an "Inactive" badge if they've left the
  roster, and their known aliases.
- Four stat tiles: **Score Rank**, **Total Score**, **Weekly Avg**, and **Attendance** (with an
  attended/total event-days bar).
- **Score composition** — a stacked bar chart of weekly points broken down by activity, one color per
  activity, with a legend.
- **Power & position** — a line chart of the member's power and power-leaderboard position over every
  roster capture on record (only shown once at least one capture exists).
- **Score by activity** — one row per activity type, ordered by points earned (highest first), each
  showing how many times the member appeared, a proportional bar, and total points. Hovering a row
  shows that activity's scoring tiers.

## How to

- **Find a member**: type a name or alias into the search box on the Members list; matching is
  case-insensitive substring matching against the governor name and every alias on file.
- **Open a profile**: click any member card, or navigate directly to a member's profile URL.
- **See scoring detail for an activity**: on a member's profile, hover the row for that activity in
  "Score by activity" — a tooltip lists the activity's weight and its point tiers.
- **Read the power chart**: hover any point on the "Power & position" chart to see the exact power
  figure and leaderboard position for that capture date, or "Not in this capture" if the member was
  absent from that paste.
- **Go back**: use the back link at the top of a profile; it returns to wherever you opened the profile
  from (the Members list, or the admin roster if you came from there).

This is a read-only view for everyone, including the viewer access tier. Editing a member's name,
alliance rank, power, or active status, and managing their aliases, is done from the admin **Roster**
and **Aliases** screens — see [Roster](roster.md) and [Aliases](aliases.md).

## How it works

- **Roster shown here**: the Members list only includes *active* members. A member who has left the
  alliance (deactivated) drops off this list and out of the score ranking entirely, but their profile
  page is still reachable directly (e.g. from a link) and shows an "Inactive" badge.
- **Score** is the all-time Participation Score: the sum of every point the member has ever earned
  across all logged activities, under the alliance's current scoring configuration. See
  [Scoring](scoring.md) for how points are calculated per activity.
- **Score Rank** is the member's 1-based position when every active member is sorted by all-time Score,
  highest first; ties are broken alphabetically by governor name. A member with no score history yet
  can still appear ranked (last, tied at zero).
- **Weekly Avg** is the member's total score divided by the number of weeks that appear in their score
  composition chart — that is, only weeks in which they earned at least one point, not every calendar
  week the alliance has run events.
- **Attendance** (list and profile) is all-time: attended event-days ÷ total event-days the alliance has
  logged, as a percentage. An "event-day" is one calendar date of one activity type (e.g. one Bear Trap
  session). This is the same figure and rule used on the [Attendance](attendance.md) page, just scoped
  to all-time rather than a single week.
- **At Risk** (list tile) counts members whose all-time attendance is below 50% — the same threshold
  that turns the attendance pill red and adds the red risk dot to a card.
- **Score composition** chart: each bar is one week, stacked by activity, showing exactly the points
  reflected in the member's total for that week. Only weeks with at least one scored appearance are
  plotted.
- **Score by activity**: totals cover every activity type the alliance has ever used, including ones
  since deactivated — a deactivated activity still contributes its historical points to the member's
  total, so it stays in this breakdown (marked "inactive").
- **Power & position** chart: plotted against every roster capture on record, not just the ones this
  member appeared in. A capture the member was missing from renders as a gap in the line rather than a
  guessed or zero value — power and position are never interpolated. Position is plotted with #1 at the
  top, matching how the in-game leaderboard reads. This is the member's history of power and
  power-leaderboard rank captured from roster imports; see [Roster](roster.md) for how captures are
  taken.
- **Known aliases** shown on a profile are every alternate name currently mapped to this member — see
  [Aliases](aliases.md) for what an alias is and how identity resolution works.

## Gotchas

- A member missing from the Members list is most often just inactive — check their profile directly, or
  look them up on the admin Roster screen, before assuming they were never tracked.
- "Weekly Avg" is not a rolling average over calendar time; it divides by the count of weeks with
  activity, so a member who joined recently or plays inconsistently can show a higher average than their
  attendance would suggest.
- A gap in the "Power & position" line is a missed capture for that member, not a power loss — the
  alliance did not observe them that day, most commonly a decoy rename or a temporary name mismatch. See
  [Aliases](aliases.md).
- Score rank only ranks active members; a member's rank number can jump when other members are
  deactivated or reactivated, independent of any change in their own score.
