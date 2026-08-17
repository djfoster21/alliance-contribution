# Rewards

Splits a batch of items (chests, speedups, anything countable) across the roster by tracked
participation, and keeps a permanent record of who got what.

## What you see

Rewards lives under **Admin → Rewards**. It has two parts: a form for building a new
allocation on top, and a **History** list of everything saved before, below.

- **New allocation form** — Title, Quantity, Metric, Strategy, a **Weeks** picker, and (for
  some strategies) extra fields, followed by **Preview** and **Save allocation** buttons.
- **Weeks** — one chip per event week that has data, newest first, with a "Select all" /
  "Clear all" toggle and a running "N of M selected" count. The 4 most recent weeks are
  checked by default when the page loads.
- **Strategy extras** — picking *Proportional to top…* adds a **Top count** field; picking
  *Tiered by rank* adds a list of rank bands (From rank, To rank, Each gets), with buttons to
  add or remove bands.
- **Preview table** — appears after clicking Preview: one row per member who would receive
  something, with rank badge, avatar and governor name (plus "aka" if their name has changed
  since), Alliance Rank tag, Power, an **Att.** (attendance) badge, the metric value as a bar
  and number, and an amount badge. Any warnings for the current inputs are listed above the
  table in amber alert boxes. A one-line summary above the table reads "N member(s) receive X
  of Y item(s)."
- **History** — one row per saved allocation: title, save date, and a summary ("400 ×
  Participation score · Top N (1 each) · 4 weeks"). Click a row to expand its saved lines in
  the same table layout (minus the attendance column — that's preview-only). Each row has a
  pencil (rename) and trash (delete) icon.

## How to

- **Build and compare a split**: fill in Title, Quantity, pick a Metric and Strategy, adjust
  the Weeks selection, and (if needed) set Top count or the tier bands. Click **Preview**.
  Nothing is saved by previewing — change any field and preview again as many times as you
  like to compare strategies side by side before committing.
- **Save it**: once a preview looks right and Title is filled in, click **Save allocation**.
  This locks in the exact lines shown and adds the allocation to History. The title field then
  clears so the form is ready for the next batch.
- **Rename a saved allocation**: click the pencil icon on its History row, edit the title, and
  save (or press Enter). Only the title can be changed after saving — the computed lines
  cannot be edited.
- **Delete a saved allocation**: click the trash icon, then confirm in the dialog. This is
  permanent; the dialog warns that the exact amounts can't be recomputed later, since the
  data they were computed from keeps changing.
- **See who got what on an old allocation**: click its History row to expand the lines table.

## How it works

- **Eligibility**: only currently-active members with a metric value greater than 0 across the
  selected weeks are considered. Deactivated members never appear, and a member with zero
  activity in the selected weeks gets nothing.
- **Ranking and ties**: eligible members are ranked by the chosen metric, highest first; ties
  are broken alphabetically by governor name — the same rule used on the ranking and
  attendance boards.
- **Metric choices**:
  - *Participation score* — the same weighted score used on the [Ranking](ranking.md) board,
    summed over the selected weeks only.
  - *Attendance (event-days)* — distinct event-days attended in the selected weeks (the same
    count the [Attendance](attendance.md) page uses).
- **Weeks**: there are no presets or date-range math — you pick the exact weeks from the list
  of weeks that actually have events. Selecting every week is how you cover "all-time."
- **Strategies**:
  - **Top N (1 each)** — the top *Quantity* members get exactly 1 item each.
  - **Proportional to metric** — the full quantity is split across every eligible member in
    proportion to their metric value, rounded so the amounts always add up to exactly the
    quantity (largest remainders get the extra unit first; a tie in remainder goes to the
    higher-ranked member).
  - **Proportional to top…** — the same proportional split, but only among the top *Top
    count* members; everyone below that cutoff gets nothing.
  - **Tiered by rank** — you define rank bands (e.g. ranks 1–5 get 20 each, 6–20 get 5 each);
    each band hands its fixed amount to every member in its rank range. Bands can leave gaps
    between them but cannot overlap.
- **The 100% rule**: whenever at least one member receives something, the saved amounts always
  add up to exactly the quantity entered. If a strategy would naturally hand out less (Top N
  with fewer eligible members than the quantity, or tiered bands whose nominal total falls
  short of the quantity, or a band that runs past the number of eligible members), the leftover
  items are handed out one at a time starting from rank 1, and a warning says so.
- **Amount badge shading**: the darkest badge is the largest amount in the current table,
  fading lighter for smaller amounts — a quick visual read of who got the most, not a fixed
  scale across allocations.
- **Attendance column**: shown only in the preview (never in saved History rows) — it's
  display context for the operator's judgment call, not part of what gets saved.
- **What's saved**: title, quantity, metric, the exact list of weeks picked, the strategy (and
  its band/top-count settings), and one line per receiving member — their rank, metric value,
  and amount at that moment. Saved lines are a permanent snapshot: recomputing later, or a
  member being renamed, never changes a saved amount, rank, or metric value. A member merge is
  the only thing that can move a saved line, and only to point it at the surviving identity —
  the recorded amount doesn't change.
- **Rewards do not affect scoring.** Allocations only read existing participation and
  attendance data to compute a split; nothing about creating, editing, or deleting an
  allocation changes any member's Participation Score, event history, or attendance figures
  anywhere else in the app.

## Gotchas

- **Rewards is admin-only, end to end** — unlike the rest of Admin, where a manager key can
  read and write, every action on this page (including just viewing the saved History list)
  requires the admin-tier key specifically. A manager key is refused here the same as a viewer
  key would be.
- **A preview with zero lines can't be saved.** If nobody is eligible in the selected weeks, or
  every tiered band starts past the last eligible rank, the preview shows an empty result and
  Save is blocked — a hand-out to nobody is never recorded.
- **Preview can drift from what you eventually save.** Save always recomputes from the current
  data rather than trusting what the preview showed. If an event gets ingested or corrected
  between previewing and saving, the saved lines can differ slightly from the last preview you
  looked at.
- **Tiered bands reject on save, not silently**: overlapping bands, a band with `fromRank`
  greater than `toRank`, a non-whole or non-positive amount, or bands whose combined nominal
  total exceeds the quantity all produce a clear error instead of saving something wrong.
- **A tie straddling a cutoff is flagged, not resolved for you.** If two members have the same
  metric value but only one of them fits inside a Top N, Top count, or tiered band boundary,
  the preview calls it out as a warning so you can decide whether to adjust — it does not
  block saving.
- **Editing after save is limited to the title.** If the strategy, quantity, or metric was
  wrong, the fix is to delete the allocation and create a new one — there's no way to recompute
  an old allocation's lines in place.

## See also

- [Ranking](ranking.md) — the Participation Score leaderboard the "Participation score" metric
  is drawn from.
- [Members](members.md) — each member's own profile and history.
