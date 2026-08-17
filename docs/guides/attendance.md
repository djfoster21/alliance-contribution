# Attendance

Shows how consistently each member shows up to events, over a season or a single week.

## What you see

- **Scope toggle** — *Overall* (the whole season, all weeks combined) or *This week* (one week
  at a time).
- **Week picker** — only shown in *This week* scope. Defaults to the most recent week that has
  events.
- **Filter by** dropdown — narrow to one activity (Bear Trap, Contribution, Alliance
  Mobilization, or whatever activities are configured) or leave it on "All activities."
- **Hide R4/R5** checkbox — drops leadership ranks from the summary tiles and the table.
- **N event days** — the number of distinct event-days counted in the current scope, shown
  above the table.
- **Summary tiles** (hidden until there's at least one event and one member to show): *Avg
  attendance*, *Perfect (100%)*, *At risk (<50%)*.
- **Colour key**: ≥80% Good (green), 50–79% Watch (amber), <50% At risk (red).
- **Band legend** — the same Leadership / Top N / next band / rest colour strip used on the
  Ranking page, keyed off each member's Alliance Rank standing.
- **Table** — one row per member: Governor (with avatar, links to their member profile),
  Alliance Rank badge, an Attendance progress bar, and a Rate column showing the percentage,
  the raw fraction (e.g. 7/9), and — in weekly scope only — a small change indicator versus the
  prior week.

Anyone with API access — viewer, manager, or admin — can open this page and use every control
on it. There's nothing to save or edit here; it's read-only.

## How to

- **Switch between season and week**: use the scope toggle. Overall shows the whole season at
  once; This week narrows everything to a single week.
- **Pick a different week**: with *This week* selected, use the week dropdown. Weeks are
  listed newest first.
- **Focus on one activity**: use the "Filter by" dropdown. This narrows both the numerator
  (what counts as attending) and the denominator (how many event-days exist) to that activity
  only.
- **Hide leadership**: check "Hide R4/R5" to drop those rows from the table and from the
  summary tiles above it.
- **Jump to a member**: click their name to open their member profile.

## How it works

- **What counts as an appearance**: one event-day, meaning one activity type on one date. A
  Bear Trap day that ran two traps still counts as a single event-day — a member is only
  allowed to log one of the two traps (never both), so showing up to either one counts as
  attending that day.
- **The numerator** is the number of distinct event-days a member appeared in, within the
  current scope. **The denominator** is the total number of distinct event-days that occurred
  in that same scope. Both narrow together:

  | Scope | What's counted |
  |---|---|
  | Overall, all activities | Every event-day, all season |
  | Overall, one activity | Every event-day for that activity, all season |
  | This week | Every event-day in that week |
  | This week + one activity | Every event-day for that activity, in that week |

  A member with no in-scope event-days at all still gets a row, at 0%.
- **Rate** = attended ÷ total event-days in scope, shown as a rounded percentage plus the raw
  fraction. With zero event-days in scope, rate reads 0%.
- **Change indicator (weekly scope only)**: the signed change in percentage points versus the
  previous week that had events in the same scope (same activity filter, if one is set). An
  up arrow means attendance improved week over week, a down arrow means it dropped. It's blank
  (em dash) when there's no change, when the selected week has no events, or when there's no
  earlier week to compare against. It never appears in Overall scope — there's no "previous"
  period for a season total to compare to.
- **Colour thresholds**: the progress bar and percentage are coloured by the rounded rate —
  green at 80% or higher, amber from 50–79%, red under 50%. This is the same threshold used
  everywhere else attendance is shown (Members, Ranking, Rewards).
- **Bands and the Hide R4/R5 checkbox**: rows are grouped into Leadership (R4/R5), Top, Mid,
  and Rest bands the same way the Ranking page does, using each member's attendance count as
  the ranking value. Bands are assigned across the *full* roster first, then leadership rows
  are hidden if the checkbox is checked — so hiding leadership never shifts who counts as Top
  or Mid.
- **Sorting**: highest rate first; ties broken alphabetically by governor name.
- **Deactivated members**: not shown at all, in any scope. Only currently-active members
  appear on this page.
- **Members who joined partway through the season**: attendance doesn't know when someone
  joined. The denominator is every event-day in scope regardless of join date, so a member who
  joined recently will show a lower percentage than a founding member with identical
  attendance since joining — their "missed" days include days before they were even in the
  alliance. This is a known, accepted limitation, not a bug.

## Gotchas

- A one-week view can have very few event-days (sometimes just one or two), so the percentage
  moves in big jumps — missing a single event in a two-event week can swing a member all the
  way from Good to At risk. Treat the weekly colour as "this week," not "chronic," especially
  when the "N event days" count is small.
- The change indicator can be noisy for the same reason: comparing a 1/1 week to a 2/3 week
  produces a large-looking swing that isn't very meaningful. It's a nudge, not a precise trend.
- A member who just joined can show a misleadingly large positive change arrow the first week
  they appear (their prior-week rate reads as 0%, since attendance has no concept of "not a
  member yet").
- If the roster has members but no events fall in the current scope (e.g. an activity filter
  on a week that activity skipped), the table shows an empty state rather than a board of 0%
  rows.

## See also

- [Ranking](ranking.md) — the same event-day and band concepts, applied to the Participation
  Score leaderboard.
- [Members](members.md) — each member's profile page shows their own all-time attendance
  figure.
