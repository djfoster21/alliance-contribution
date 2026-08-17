# Overview

The home dashboard — a daily-glance summary of alliance participation, who needs attention, and what was last uploaded.

## How the app fits together

The app tracks recurring in-game activities (things like Bear Trap, Contribution, and Mobilization). Each time you upload a ranking screenshot's data, that becomes an **event**; every governor's row in it becomes a **participation** with a raw name and a value. Each participation is resolved to a **member** (by exact name, or by an alias you've mapped) and scored using that activity's rules; a name that doesn't resolve sits in the **unmapped queue** until an officer maps it. A member's **Participation Score** is the sum of their scored participations, which feeds the weekly and all-time rankings and the attendance figures shown throughout the app.

Three pages cover day-to-day use: this Overview, **Ranking** (weekly and all-time leaderboards), and **Attendance** (event-day coverage per member), plus a **Members** directory where every governor has a profile page with their history. Everything else — uploading events, editing the roster, mapping aliases, tuning scoring, allocating rewards, and backing up the database — lives behind **Admin**.

Access comes from a key with one of three tiers:

- **Viewer** — read-only everywhere. Can see every page, including Admin's contents, but cannot upload, edit, or delete anything.
- **Manager** — read and write. Can upload events, edit the roster, map aliases, and adjust scoring.
- **Admin** — everything a manager can do, plus destructive/high-risk actions such as deleting an event, deleting a roster capture, or restoring a database backup.

The app is unusable without a valid key — the first thing you see on load is a prompt asking for the alliance access key, and nothing else renders until the key is accepted. An unrecognized key re-prompts rather than letting you in with reduced access.

See [Ranking](ranking.md), [Attendance](attendance.md), [Members](members.md), [Events](events.md), [Roster](roster.md), [Aliases](aliases.md), [Scoring](scoring.md), [Rewards](rewards.md), and [Backup](backup.md) for the rest.

## What you see

- A small **"Latest week"** chip in the top-right, when at least one event has been logged.
- Four stat cards across the top:
  - **Active members** — count of members currently on the roster, out of the total ever tracked.
  - **Avg attendance (active)** — average attendance percentage across active members, plus how many are at a perfect 100% and how many are at risk. Shows a dash before any events exist.
  - **Events logged** — total events ingested, and how many distinct event-days that spans.
  - **Unmapped queue** — how many raw names still need a decision, highlighted amber when non-zero.
- **Top of the leaderboard** — the top 5 governors for the current week, with rank badge, alliance rank tag, score bar, and this-week movement (up/down arrow with the number of ranks moved). A link jumps to the full [Ranking](ranking.md) page.
- **Unmapped queue** panel — up to 5 of the unresolved raw names, shown exactly as captured (no truncation — the alliance uses deliberate near-identical decoy names, so every character matters). Manager and admin see a "Resolve in Aliases" link; viewers do not.
- **At-risk attendance** panel — up to 4 active members below 50% attendance, worst first, each with their attendance badge.
- **Recent ingests** table — the 5 newest events (date, activity, instance number, how many rows, how many of those are still unmapped). Manager and admin see a "View all events" link into Admin; viewers do not.

## How to

- **Get a daily read on the alliance** — open the Overview; the four stat cards, leaderboard, and at-risk list together answer "how are we doing" without visiting any other page.
- **Jump to the full leaderboard** — use "View full ranking →" on the leaderboard panel to open [Ranking](ranking.md) with the weekly view already selected.
- **Check whether new screenshots have been processed** — glance at the Recent ingests table; a fresh upload should appear at the top within moments, and its Unmapped column should read 0 once every name in it resolves.
- **Resolve unmapped names** (manager/admin) — click "Resolve in Aliases →" on the Unmapped queue panel to jump straight into the [Aliases](aliases.md) workflow.
- **Open a member's history** — click any governor's name in the leaderboard or the at-risk list to jump to their profile on [Members](members.md).
- **Review or re-upload a specific event** (manager/admin) — click "View all events →" on the Recent ingests panel to jump into the [Events](events.md) admin list.

## How it works

- **Active members** counts everyone currently on the roster (not deactivated/removed), against the total of everyone ever tracked, active or not.
- **Avg attendance (active)** is the mean of each active member's attendance percentage across every event-day so far. Perfect = exactly 100% attendance. At risk = below 50%. Soft-deleted (deactivated) members are excluded from this figure and from the at-risk list — they'd otherwise dominate the "worst attenders" list with stale numbers frozen from before they left. The [Attendance](attendance.md) page, by contrast, shows the whole roster including deactivated members, so its roster-wide average will legitimately differ from this card.
- Before any event has ever been logged, this card shows a dash rather than "0%" — with zero events every member's raw attendance would compute to 0%, which would falsely flag the entire roster as at risk on a brand-new install.
- **Events logged / event-days** counts every event ever uploaded, and separately the number of distinct (activity, date) combinations they span — two Bear Trap uploads on the same day for two separate traps count as two events but can land on the same event-day.
- **Unmapped queue** count is every distinct raw name with no resolved member, alliance-wide — not just the ones shown on this page's list.
- **Latest week** is the most recent ISO calendar week (Monday–Sunday) that has any logged event, shown as a week number.
- **Top of the leaderboard** is this week's ranking, already sorted by score highest-first. The top 3 get gold/silver/bronze treatment; the score bar is scaled against the maximum score possible that week. **Movement** is last week's rank minus this week's rank — positive (green, up arrow) means the governor moved up since last week; a dash means either no prior week to compare against or no change.
- **Recent ingests** are ordered newest first, by date and then by instance number for same-day uploads (so a same-day second Bear Trap upload sorts above the first).
- **At-risk attendance** is sorted worst attendance first; ties break alphabetically by governor name.

## Gotchas

- The at-risk threshold is a hard "below 50%", but the small percentage badge shown elsewhere on this and other pages rounds to the nearest whole percent — a member at 49.6% counts as at risk here even though their badge may round up and display as 50%. This is a display-rounding quirk, not two different rules.
- The unmapped and at-risk panels each show a short slice (5 names and 4 members respectively); the number in each panel's subtitle is always the true full total, even when it's larger than what's listed below it.
- A brand-new alliance member appears in "Active members" the moment they're added to the roster, but won't affect the leaderboard, attendance figures, or event tables until an event with their name has been logged.
- Deactivating a member (rather than deleting them) keeps their historical participation intact everywhere except this dashboard's active-only figures — their score history and profile remain reachable from [Members](members.md).
- Viewers see the same numbers and lists as managers and admins — the only difference is that the "Resolve in Aliases" and "View all events" shortcut links are hidden for viewers, since those destinations require write access.
- If the dashboard ever loads with a message that data came back empty, it usually means a temporary connectivity hiccup — reloading the page is the fix.
