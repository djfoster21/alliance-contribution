# Ranking

The leaderboard: every active member ordered by Participation Score, for the current week or the whole season.

## What you see

- **Scope toggle** — "Overall" (season-to-date, every event ever logged) or "This week" (only the
  currently selected week).
- **Week picker** — only shown in "This week" scope. Lists every week that has at least one logged
  event, newest first, and defaults to the most recent one.
- **Rank by** dropdown — "All activities" or a single activity (e.g. Bear Trap, Contribution,
  Alliance Mobilization). Narrows the whole board to that activity's points only; it is not a
  breakdown overlay, it re-ranks members as if that were the only activity that counted.
- **Hide R4/R5** checkbox — removes Leadership-band rows from the table (does not change anyone's
  score or the top/mid counts, it's purely a display filter).
- **Top-5 podium** — large cards for ranks 1–5, shown only when at least 5 members are visible and
  all 5 have a score above zero. Otherwise the board is table-only.
- **Band legend** — a colour key above the table: Leadership, Top N, next range, and everyone below
  that.
- **Full Standings table**, columns:
  - **Rank** — position on this board (gold/silver/bronze badge for 1st–3rd).
  - **Member** — avatar and name; click any row to open that member's profile.
  - **Alliance Rank** — the member's in-game R1–R5 badge, if recorded. Blank when never recorded.
  - **Score** — the number plus a fill bar showing score as a share of the possible maximum.
  - **Attendance** — attendance percentage in the same week/activity scope as the board (hover the
    column header to see exactly what scope it's measuring).
  - **Move** — "This week" scope only: change in rank versus the prior week that had events.

## How to

- **Switch scope**: click "Overall" or "This week" in the toggle. Switching to "This week" restores
  whatever week was last selected (or the latest one, on first load).
- **Look at a past week**: with "This week" selected, open the week picker and choose from the list.
- **Rank by one activity**: pick it from "Rank by". Scores, the possible-points bar, attendance, and
  bands all recompute for that activity alone.
- **Hide leadership from the table**: tick "Hide R4/R5". The podium and standings both drop those rows.
- **See a member's full history**: click their row (or their name/rank badge) to open their profile.
- **Change how many members count as Top/Mid**: admin-only, done from Settings, not this page — see
  Gotchas below.

## How it works

- **Participation Score** — the sum of points earned across logged events in scope (this week, or
  the whole season), per the weighted scoring rules. See [Scoring](scoring.md) for how points are
  assigned per activity and tier.
- **"% of possible"** (the fill bar behind each score) — the member's score divided by the
  **maximum any member could have scored** in the same scope: for every activity-and-day that had
  an event in scope, take that activity's highest-value scoring tier, multiply by the activity's
  weight, and add them all up. That total is the same number for every member on the board — it's
  the denominator, not a per-member max. If an activity has no scoring tiers configured, its
  contribution to the denominator is zero. The bar is capped at 100%.
- **Rank bands** — the coloured groups (Leadership / Top / Mid / Rest) are assigned from Settings'
  configured sizes (defaults: top 30, mid 20):
  - Any member whose recorded Alliance Rank is R4 or R5 is always **Leadership**, regardless of
    score or position — leadership doesn't compete for the counted slots.
  - Among everyone else, ordered by score (highest first): the first *top*-many are **Top**, the
    next *mid*-many are **Mid**, everyone after that is **Rest**.
  - A member with a score of zero is always **Rest**, even if their position would otherwise fall
    inside the Top or Mid window — every active member appears on the board whether they
    participated or not, so the zero-score tail is never colored as if they'd earned a top slot.
  - A member tied on score with the row above them inherits that row's band, so a tie can never be
    split across a colour boundary.
  - Band colours: Leadership is purple, Top is blue, Mid is teal, Rest is grey.
- **Alliance Rank badge mismatch warning** — each band has an "expected" in-game rank (Top → R3,
  Mid → R2, Rest → R1; Leadership has no expectation). If a member's actual Alliance Rank doesn't
  match their band's expected rank, their badge gets a warning ring and an up/down arrow showing
  which way they're out of line — a quick way to spot who's under- or over-ranked for their
  contribution level.
- **Attendance** — the share of in-scope event-days the member showed up for at least once, in the
  same week/activity scope as the rest of the board. See [Attendance](attendance.md) for the full
  rule.
- **Move** (weekly scope only) — prior week's rank minus this week's rank. Positive (green, up
  arrow) means they climbed; negative (red, down arrow) means they dropped; a dash means there's no
  prior week to compare (first week on record, or the activity filter had no events that week).
- **Season Score vs This-Week Score** — same figure, different scope: cumulative all-time points
  in Overall scope, only that week's points in This-Week scope.
- **Ties** — members with equal scores are ordered alphabetically by name (case-sensitive
  character order) as the tiebreaker. Tied members still get distinct, consecutive rank numbers
  (there's no shared "1st place" for two tied members) — only the colour band can be shared by a
  tie, never the rank number itself.
- **Which week an event falls into** — every logged event has a calendar date; the app converts
  that date into a standard Monday-starting calendar week (labelled like "2026-W33"). Dates right
  at the turn of the year use the week that contains the Thursday of that same week, which is the
  standard rule for deciding which year a border week belongs to. All events sharing that label are
  grouped into the same weekly board.

## Gotchas

- Anyone with a valid access key (viewer, manager, or admin) can view both ranking boards — it's
  entirely read-only here.
- The Top/Mid band sizes are changed in Settings, and that action is admin-only; viewers and
  managers see whatever the admin last configured.
- Switching the "Rank by" filter to a single activity changes attendance, score, and possible-points
  together — a member who never does that activity will show 0% there even if their overall
  attendance is high.
- The podium disappears below 5 qualifying members (e.g. a very early week, or a narrow activity
  filter with few participants) — this is expected, not a bug; the table still shows everyone.
