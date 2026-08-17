# Scoring

Configure what counts as a scored activity, how raw numbers turn into points, and the colour bands used on the leaderboards.

## What you see

A card per activity type, plus a "Ranking bands" card at the bottom.

Each activity card shows:
- **Name badge**, coloured with the activity's assigned colour, and an **Active**/**Disabled** status badge.
- **Unit label** (if set) — what the raw number represents, e.g. "Damage" or "Personal Points".
- **Weight multiplier** — the activity-wide multiplier applied to every scored appearance.
- **Tier bands** — the point value awarded at each threshold of the raw value, read-only on the card (edit them via "Edit bands").
- **Edit** / **Edit bands** buttons, and a **Disable activity** / **Enable activity** toggle.

The **Ranking bands** card holds two numbers — Top band and Second band — that size the colour groups on the Ranking and Attendance boards.

## How to

- **Add an activity**: click "Add activity". Set a unique key (lowercase, underscores — this cannot be changed later), a display name, an optional unit label, the weight, max instance, min value, sort order, and a colour. A brand-new activity has no tiers yet, so it scores 0 for everyone until you add tiers with "Edit bands".
- **Edit an activity's name/label/shape**: click "Edit" on its card. You can change the name, unit label, max instance, min value, sort order, and colour. The key is permanent. Weight and tiers are not edited here — use "Edit bands" for those.
- **Edit weight and tiers**: click "Edit bands". Change the weight field and the tier rows (each row is a minimum value and a points value); each row also shows the "Effective" points (tier points × weight) as you type. Add a row with "Add tier", remove one with the trash icon. Tier minimum values must be distinct and strictly increasing, and every number must be zero or greater. Click "Save scoring" to apply — this immediately re-scores all historical events under the new numbers (see How it works).
- **Disable an activity**: click "Disable activity" on its card and confirm. A disabled activity is removed from the "new event" activity picker on the Events page (an event already logged under it still shows, tagged "inactive"), but its history stays intact and fully scored — nothing is deleted.
- **Re-enable an activity**: click "Enable activity" on a disabled card. It reappears in the event picker immediately.
- **Change colour**: pick a swatch from the colour picker in the Add/Edit dialog. The colour drives that activity's badge everywhere it appears (Events, Ranking breakdowns, member profiles).
- **Change band sizes** (admin only): edit the Top band / Second band numbers on the Ranking bands card and click Save. Non-admin users see these numbers but cannot edit them.

## How it works

**Per-row scoring.** Every logged participation row (one member's raw value for one activity on one date/instance) is scored as:

> points = (points of the highest tier whose minimum value is ≤ the row's raw value) × the activity's weight

If no tier's minimum value is ≤ the raw value (which only happens if every tier's minimum is above the value — normally avoided by having a `0` tier), the row scores 0. An activity with no tiers at all always scores 0.

**Ingest threshold vs. tier zero.** An activity's "min value" (set on the Edit dialog) is a *gate*, separate from tiers: a raw value at or below it is never logged as a participation row in the first place — the member simply doesn't get an entry for that event. A tier whose points are 0 is different: the row *is* logged and counted (e.g. toward attendance), it just contributes 0 points. The seeded defaults use a min value of 0 (any value greater than 0 is logged) combined with a first tier of `0 → 0` points for Contribution and Mobilization, so a small-but-real contribution is recorded but doesn't move the score.

**Seeded defaults** (the values shipped with a fresh install — editable from here on):

| Activity | Weight | Tiers (raw value ≥ → points) | Max instance |
|---|---|---|---|
| Bear Trap | 1 | `0 → 1` (flat — any appearance scores 1) | 2 (two traps per date) |
| Contribution | 1 | `0 → 0`, `20,000 → 1`, `60,000 → 2`, `120,000 → 3` | 1 |
| Alliance Mobilization | 2 | `0 → 0`, `2,000 → 1`, `5,000 → 2`, `10,000 → 3` | 1 |

Because Mobilization's weight is 2, its effective points per appearance are 0/2/4/6 rather than 0/1/2/3 — it's designed to outweigh a single Bear Trap appearance and reward the same tier level as Contribution twice as much.

**Max instance** is how many separate results one activity can have on the same date — Bear Trap has two (Trap 1 and Trap 2 daily), everything else defaults to one. It can only be raised, never lowered below the highest instance number that already has logged events.

**Participation Score** — a member's total is simply the sum of the points from every scored row that's in view (this week, or the whole season) across every activity. See [Ranking](ranking.md) for how that total is displayed, banded, and turned into a "% of possible" bar.

**No effective-dating.** Saving a weight or tier change re-scores every historical event under the new numbers — there is no way to change scoring "from today forward only." If you tighten the Contribution tiers, last month's already-recorded contributions are re-graded under the new tiers too, and every score, ranking, and trend that depends on them updates immediately. There's no undo beyond manually re-entering the old numbers and saving again.

**Rank bands.** The Top/Second numbers on the Ranking bands card control how many members are painted into the "Top" and "Mid" colour groups on the [Ranking](ranking.md) and [Attendance](attendance.md) boards (leadership ranks R4/R5 are always their own group and never count against these numbers; everyone past Top+Second is "Rest"). Changing these numbers is pure display — it doesn't touch any stored score and doesn't trigger a recompute.

**Badge colours.** The colour you pick per activity in this page is used for that activity's badge and chart colour throughout the app. The R1–R5 alliance-rank badges shown elsewhere use a fixed colour scheme tied to the rank bands (R3 echoes Top, R2 echoes Mid, R1 echoes Rest, R4/R5 echo Leadership) and are not configurable from here.

**Worked example.** Say member Aurora ([ABC] Aurora in-game) logs the following in one week:
- Bear Trap, Trap 1: any nonzero damage → flat tier `0 → 1` → 1 point × weight 1 = **1 point**.
- Contribution: raw value 65,000 → highest tier with minimum ≤ 65,000 is `60,000 → 2` → 2 points × weight 1 = **2 points**.
- Alliance Mobilization: raw value 6,500 → highest tier with minimum ≤ 6,500 is `5,000 → 2` → 2 points × weight 2 = **4 points**.

Aurora's Participation Score for that week is 1 + 2 + 4 = **7 points**. If Aurora had only contributed 15,000 (below the first real Contribution tier), that row would still be logged — just at 0 points, since the `0 → 0` tier applies.

## Gotchas

- **Access tiers.** Viewers can see every card and the band sizes but cannot change anything. Managers and admins can add/edit/disable activities, edit weight and tiers, and change colours. Only admins can change the Ranking bands' Top/Second numbers — that one field is stricter than everything else on this page.
- **Weight and tier edits are immediate and global.** There's a warning banner at the top of the page for this reason — before saving, double check the tiers, since the recompute touches every date on record, not just new events.
- **A brand-new activity scores nothing** until you give it at least one tier. Don't forget the second step after "Add activity."
- **The activity key is permanent.** Choose it carefully when adding an activity — it can't be edited afterward, only the display name and everything else.
- **Lowering max instance is blocked** once events already exist at the instance you're trying to remove (e.g. you can't drop Bear Trap back to 1 instance while Trap 2 events are on record).
- **Disabling an activity doesn't touch history.** It only hides the activity from the "log a new event" picker; every past score, ranking, and trend involving it is unchanged.

See also: [Ranking](ranking.md), [Events](events.md), [Attendance](attendance.md).
