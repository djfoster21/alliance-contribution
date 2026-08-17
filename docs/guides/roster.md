# Roster

The alliance's member list — who's in, their alliance rank and power, and the history of every
roster screenshot ever imported.

## What you see

- Four stat tiles at the top: **Alliance power** (sum of active members' power), **Δ power** (sum
  of every active member's change since *their own* last update — not one shared date), **Gained /
  dropped** (how many members' power went up vs. down), **At risk** (active members below 50%
  attendance — see [Attendance](attendance.md)).
- A roster-update picker (top right) showing the most recent import by date, with older updates in
  the dropdown, each labeled with its date and member count. Picking an older date switches the
  whole table into a read-only "as of that date" view.
- Tabs **Active / Inactive / All**, each with a count, and a **Sort** control: Power, Rank,
  Biggest movers, Status, or Name. Tabs and filtering are hidden while viewing a past update — a
  past update shows exactly who was observed, with no active/inactive judgment.
- The table: rank position (`#`, the in-game leaderboard place), member name (links to their
  [profile](members.md)), the **R1–R5 rank badge**, **Power**, **Change in power**, **Move**, and
  **Status**. A row for a member currently in the top 10 by power is bolded.
  - The rank badge can carry a small corner chip showing the previous rank with an up/down
    triangle, when a rank change was observed in the latest update.
  - Power shows the raw value plus a bar sized against the strongest member.
  - Change in power shows the signed change plus a bar; an em dash means there's nothing yet to
    compare against (the member's first observation).
  - Move shows places gained or lost on the power leaderboard since the member's last observation
    (an up arrow means they climbed).
  - Status is **Active**, **At risk**, **Inactive**, or an em dash (no attendance data at all yet).
- Row actions (live view only): Edit, Rename, Merge (admin only), and Deactivate/Reactivate.
- A legend at the bottom of the table explaining the status dots and what "Move" means.

## How to

**Add a member** — "Add member" button. Governor name is required and must be unique (and can't
collide with an existing alias); rank, power, and leaderboard position are optional.

**Edit a member** — pencil icon on a row. Changes rank, power, position, and active/inactive.
Does not change the name — use Rename for that.

**Rename a member** — tag icon. Enter the new governor name. "Keep old name as an alias" is
checked by default, which keeps every historical row logged under the old name attached to this
member. Unchecking it warns that those historical rows become unmapped after the recompute that
follows every rename. Use this only when you're sure it's the same person renaming — the alliance
runs deliberate decoy renames (e.g. a new player taking a name like "NotAurora" next to an existing
"Aurora"), and treating a decoy as a rename silently merges two different people's history.

**Deactivate / Reactivate** — person-icon buttons. Deactivating keeps a member's full history
scorable; it does not delete them. A deactivated member keeps whatever power/rank they last showed
forever, until reactivated or observed again in a new roster update.

**Merge two members** (admin only) — merge icon. Pick the survivor from the search box. The
dialog spells out the consequence: the duplicate's name(s) become aliases of the survivor, its
snapshot history and participation history move over, and the duplicate's row is deleted. **This
cannot be undone.** Use it when a rename got mistaken for a new person (a duplicate member row
exists for someone who's actually the same governor as an existing one). The survivor's own rank,
power, and active state are untouched — to keep someone's current in-game name, merge the *old*
record into the *new* one, not the other way around.

**Import a roster update (TSV)** (admin only) — "Import roster (TSV)" button opens a 3-step
wizard driven off a screenshot of the in-game Alliance Ranking (Power) screen:

1. **Paste.** Pick the capture date (defaults to today) and paste tab-separated rows —
   Governor, Rank, Power, Position. A built-in prompt (copy button provided) tells an LLM how to
   turn ranking screenshots into that format, including stripping the alliance tag (e.g.
   `[ABC]Drake` → `Drake`) and de-duplicating the pinned self-row. The preview reports how many
   rows match existing members, how many names are unrecognized, duplicates collapsed, and invalid
   cells. If the chosen date already has an update on file, you must explicitly acknowledge that
   importing replaces it wholesale. A future-dated capture is flagged as likely a mistake (it can't
   be deleted from the picker later without going to Delete update).
2. **Unrecognized names** (only if any). For each name that didn't match an existing member or
   alias, choose **New member**, **Alias of…** an existing member, or **Skip**. Checking "Make
   this the primary name" on an alias decision turns it into a rename (old name kept as alias) —
   leave it unchecked unless you're sure it's not a decoy.
3. **Membership review** (only if something needs deciding, or the capture is backdated). Active
   members missing from the paste are listed as **Absent**, each with an opt-in Deactivate toggle
   (default: stay active) and a "Deactivate all" bulk action; nothing is deactivated automatically.
   Inactive members who did appear in the paste are listed as **Returning**, defaulting to
   Reactivate. If more than a quarter of active members are absent, a warning suggests the
   screenshot may be truncated rather than the alliance shrinking. A **backdated** capture (older
   than the newest one on file) skips membership decisions entirely — see How it works.

Applying writes one snapshot per observed member, applies every decision, runs one score
recompute, and shows a result summary plus the roster delta (see How it works).

**Review / edit / delete a past roster update** — pick a date in the roster-update dropdown to
time-travel: the table shows exactly who was observed that day and their change since their own
prior observation, with actions and filtering hidden. From there (admin only): **Edit update**
reopens the import wizard prefilled with that date's rows (the date itself is locked — you're
correcting that update, not moving it), and **Delete update** removes that date's snapshot rows
only. Deleting an update does **not** roll back members' current rank/power/position — those stay
at whatever the most recent update set them to.

## How it works

- **Change in power / Move** are always computed against each member's *own* last observation, not
  a single shared previous date — someone who missed a few updates is compared against their last
  real one, so a gap never gets misread as "no change."
- **Status**: Inactive members are always Inactive. Active members are **At risk** below 50%
  attendance, **Active** at or above it, or an em dash if there's no attendance data to judge on
  yet (see [Attendance](attendance.md) for how attendance is computed).
- **Rank changes**: a change is only reported when both the old and new rank were actually read —
  an unreadable badge (blank cell) never counts as gaining or losing a rank. A change touching R4
  or R5 on either side is reported as **Leadership** (R5 is the sole alliance leader, R4 are
  admins); other increases are **Promoted**, other decreases **Demoted**.
- **Suspicious power moves.** A matched member whose power jumped by more than 20% per elapsed
  week since their own last observation is flagged for verification in the import result. This
  exists because a decoy who adopts an existing governor's exact name would otherwise silently
  overwrite that member's power and rank — the app can't detect identity swaps by name (never
  fuzzy-matches), so it watches for an implausible jump instead. The threshold scales with the gap
  (a six-week gap allows six times the swing), and members marked Returning are exempt, since
  coming back after time away is expected to look different. A flag means "double-check this
  screenshot row belongs to who it matched," not proof of an error.
- **Backdated captures.** If the date you're importing is older than the newest update on file, it
  is treated purely as *added history*, not as evidence about who's in the alliance today —
  deactivate/reactivate decisions are refused for it, and it never moves anyone's current standing
  backward. Power, rank, and position are still recorded for that date.
- **Snapshots are gaps, not zeros.** A member absent from a given roster update simply has no
  record for that date; their power/rank there is unknown, never assumed to be 0 or unchanged.
- Every rename, merge, and roster import triggers one full recompute of participation scores, since
  identity resolution can change who past events are attributed to. See [Scoring](scoring.md).

## Gotchas

- Merge is irreversible from the UI — recovering means manually re-creating the member and
  removing the alias, then letting history re-resolve.
- Renaming without "keep old name as alias" orphans that member's history logged under the old
  name; it becomes unmapped rather than reassigned. See [Aliases](aliases.md) for how names resolve.
- The app never guesses identity — an unrecognized name in an import always waits for an explicit
  New / Alias / Skip decision, and the "make primary name" checkbox defaults off for the same
  reason.
- Deleting a roster update only removes that date's history record; it does not touch the member's
  current rank/power, and a capture imported on the wrong date can't be moved — check the date
  before applying, since only a full delete-and-reimport fixes it.
- Access: viewers can view the roster, sort/filter it, and time-travel to past updates, but can't
  write anything (attempting to shows a permission error). Managers can add, edit, rename,
  deactivate, and reactivate members. Only admins can import/edit/delete a roster update (TSV) or
  merge two members.
